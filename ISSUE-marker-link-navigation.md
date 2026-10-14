# ISSUE: marker-link navigation fails only on CI

**Status:** open. CI-only failure, mitigated by a skip; the underlying defect is not fixed.
**Temporary file:** delete this once the test runs unsuppressed and green on CI.

The test in question:

```
tests/browser/markers/marker-actions.test.ts
  > marker links to another image
    > keeps a link marker's popup in the linked image, and returns to the original when it is closed
```

Currently held back with `it.skipIf(__MICRIO_CI__)` — it still runs and passes **locally**, and is
skipped **only** when `CI` is set (`vitest.config.ts` defines `__MICRIO_CI__` for this, because the
tests run in the browser page where `process.env` does not exist). Removing the `skipIf` is the
definition of done.

---

## 1. The symptom

On a GitHub-hosted 4-vCPU runner, and **only** there:

1. The link is followed and the linked image opens correctly.
2. The popup for the original marker is displayed on the linked image.
3. Clicking its close button does **not** navigate back to the original image.
4. The test times out on the final wait.

Locally (16 vCPU, same SwiftShader software renderer) the whole round trip lands in **16 ms**, every
time, including under deliberate CPU starvation. That asymmetry is the whole difficulty: there is
no local reproduction.

## 2. What the diagnostics actually said

The test now reports the state it saw when the final wait times out
(`tests/browser/markers/marker-actions.test.ts`, the `back.catch(...)` block). One real CI run
produced:

```
Timed out waiting for the original image — state.$marker=undefined (expected 31g4s-m1),
$current=mk32x78img (expected mk31g4simg), popups=close
```

Reading that carefully:

- `popups=close` — a **live**, connected close button was found and clicked, so this is not a
  stale-element problem.
- `$current` is the **linked** image — the return navigation never happened.
- `$marker` is `undefined`.

**Important caveat:** `$marker` is read _after_ the click. The close handler itself clears the
marker, so `undefined` there does not prove the marker was already gone when the click landed. It
is consistent with two different stories and must not be over-read. What _is_ solid from this
message is: the click reached a live button, and the view stayed put.

## 3. The two-store model (get this right before changing anything)

- `micrio.state.marker` — the **main/global** store: "the marker object currently opened in the
  main active image" (`src/core/state.ts:41`).
- `micrio.state.popup` — the **main/global** store naming "the marker object whose **popup is
  currently displayed**" (`src/core/state.ts:55`). `src/layout/main.ts:330` mounts the
  `<micrio-marker-popup>` element for exactly this value.
- Each `State.Image` has its **own** `marker` store, and its subscriber mirrors local → global
  (`src/core/state.ts:227-253`). A local clear propagates to the global when
  `m.state.$marker === curr`.

The popup reads the **global** value, which is the coupling that makes this fragile: the popup of
the image being _left_ keeps rendering while the navigation is in flight.

## 4. The relevant production code

`src/markers/marker.ts` — the link path that clears the local marker on purpose, so returning to
the image does not follow the same link again (this is what prevents a two-image bounce):

```ts
// marker.ts:370-381
const linkId = data.micrioLink?.id
if (linkId && !restored) {
    void tick().then(() => {
        if (noPopup && marker.popupType !== 'popover') {
            image.state.marker.set(undefined)
        }
        void micrio.open(linkId, { vector: ... })
    })
}
```

`src/markers/marker-popup.ts` — the close button's three branches (`:187-207`). The one that
matters:

```ts
} else if ($current && $current.id !== image.id && data.micrioLink?.id === $current.id) {
    void micrio.open(image.id)
    micrio.state.popup.set(undefined)
    image.state.marker.set(undefined)
} else {
    image.state.marker.set(undefined)     // plain close: closes the marker, navigates nowhere
}
```

`open()` is `async` (`src/core/element.ts:792`) and is deliberately not awaited here.

## 5. What has been ruled out, with the measurement

**Do not re-try these; each was measured and failed.**

| Hypothesis                                         | Result                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rAF-throttled `waitFor` deadline                   | Real but **not sufficient**: swapping the two state waits to `pollUntil` fixed one test and not this one (commit `b397730`).                                                                                                                 |
| Stale/detached popup close button                  | **Disproved.** A live connected button is found; the helper would throw otherwise (`ad47dde`).                                                                                                                                               |
| The popup has no close button at click time        | **Disproved.** `popups=close`, and `button.ts` builds its inner `<button>` synchronously in `connectedCallback`.                                                                                                                             |
| A mid-flight race in the close handler's condition | **Disproved.** A probe ran 100 open→link→click→return cycles, including mixed with the real suite and under 12–16 CPU hogs, recording `$current.id`, the button class and marker state at click time: **100/100 returned**, zero mismatches. |
| Global marker cleared _before_ the click           | Not established. See the caveat in §2 — the diagnostic is post-click.                                                                                                                                                                        |
| `m.$current === image` as a guard in `state.ts`    | **Wrong, and it broke `core`.** On both the link path and a plain close this is `true`. Commit `adf3cc1` broke `tests/core/core/state.test.ts`; reverted in `7e7bcec`.                                                                       |
| `m.state.$popup !== curr` as a guard               | **Wrong.** Measured on both paths: `$popup === curr` in _both_ the link case and a plain close.                                                                                                                                              |

The last two share a root error worth remembering: **at the moment of the local clear, the link
path and the plain-close path are indistinguishable** in every field a `State.Image` subscriber
can see (owner-current, popup contents, and even the resulting values). Any fix that tries to
infer "this clear is a navigation" from the subscriber is guessing, and both guesses were wrong.

## 6. Related environment findings (they cost hours; don't rediscover them)

- **Vitest must be invoked via `npm run` / `pnpm run`.** Using `./node_modules/.bin/oxlint` or
  `./node_modules/.bin/tsc` directly in a sandboxed shell produced **45 phantom lint errors** and
  bogus tsc results. Only package-manager invocations are trustworthy.
- **`--exclude` needs the full glob**: `--exclude '**/marker-actions.test.ts'` (a bare filename
  silently excludes nothing).
- **Artifact uploads silently uploaded nothing** for several runs: `upload-artifact@v4.4+` skips
  hidden files, and `.vitest/` is hidden. Fixed with `include-hidden-files: true` (`24fc71b`).
  Artifacts appear on the **run summary page**, not the job page.
- **The runner is heavily starved**: `browser` reported 145–263 s at **96–99% worker / 1–4%
  tests**. Two mitigations are in place — `maxWorkers: 1` on CI only, and the jobs serialised
  `core → browser → css → coverage` (`ff7837c`, `c68f1f7`). Neither fixed this test.
- **Never verify a `src/core/` change with browser suites alone.** That is exactly how `adf3cc1`
  broke `core` while browser suites were green. Run `pnpm run test:core`.

## 7. What to do next (ordered by value)

1. **Get the pre-click value.** The current diagnostic reads state _after_ the click. Add a
   `micrio.state.marker.subscribe(...)` recorder in the test that pushes every emission, then
   print the recorded sequence on failure. This settles the one open question: was the global
   cleared _before_ the click, or only by the click itself? Everything else follows from that.
   Also log which branch the handler takes (temporarily instrument `marker-popup.ts`'s `close`).
2. **If the global is cleared before the click**, find the writer that survives CI but not a fast
   machine. The candidates are `marker.ts`'s `activated()` guard at `:218-221`
   (`if (this.#opened) { if (!get(micrio.state.popup)) image.state.marker.set(undefined) }`) and
   the link clear at `:370-381`. The stack-capture probe used during this investigation
   (`new Error().stack` filtered to `/src/`) is the fastest way to name the caller again.
3. **If the global is _not_ cleared before the click**, then `micrio.open(image.id)` is the
   suspect: it is fire-and-forget, and under starvation it may reject or never complete. Check for
   a swallowed rejection and consider whether the popup should await it before clearing state.
4. **Build a real reproduction rather than patching blind.** Every attempt so far that lacked one
   was wrong. The cheapest faithful reproduction is a browser test that stubs the global marker
   clear mid-navigation — i.e. clears `micrio.state.marker` right after the link is followed,
   before the close click — and asserts the return still works. If the popup cannot survive losing
   the global marker, that is the defect independently of _why_ CI loses it, and it becomes
   fixable and testable locally.
5. **Only then** consider raising `testTimeout` on CI for the browser project. That is a budget
   change, not a fix, and it should be recorded as such if taken.

## 8. Commit trail

| commit                                     | what it did                                                  | outcome                                 |
| ------------------------------------------ | ------------------------------------------------------------ | --------------------------------------- |
| `ad47dde`                                  | target a connected close button                              | kept; real hardening, not the cause     |
| `8647292`                                  | report state on timeout                                      | **kept; this is what produced §2**      |
| `adf3cc1`                                  | global-marker guard in `state.ts`                            | **reverted** (`7e7bcec`) — broke `core` |
| `7e7bcec`                                  | revert of the above                                          | —                                       |
| `ee78697`                                  | popup dismissed before the marker it names                   | kept; correct ordering, unproven for CI |
| `b397730`, `ff7837c`, `c68f1f7`, `24fc71b` | rAF→timer waits, worker cap, job serialisation, artifact fix | kept; none fixed this test              |

Commit hashes are from the `feature/ci-testing` branch and may drift when it is merged.
