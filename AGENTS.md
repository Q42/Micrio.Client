# Notes for future agents

- **Prefer the simplest fix that works.** Reach for the smallest code change
  first; escalate to new dependencies, new files, or test harnesses only when
  the simple fix is proven insufficient — and ask before adding dependencies.
  - Real example: the PDF preview iframe failed under cross-origin isolation
    ("localhost refused to connect"). The correct fix was a ~25-line change:
    fetch the bytes (SW/OPFS path), render the iframe from a
    `URL.createObjectURL(blob)` instead of the raw media URL. Not PDF.js, not
    a renderer, not a test rig.
- **Do not overengineer.** Make clean, concise code. Minimal to make it work.
  Don't write code for the sake of writing code-- write it with the target in
  sight. I expect as minimal as possible git commits.
- **Match the user's scope.** "Fix the iframe issue" means fix the iframe, not
  redesign the preview. A blob-URL iframe keeps the popover preview and the
  user can verify it themselves.
- **Never run a headless browser or create stand-alone tests/experiments
  without first asking the user.** No Chrome/CDP harnesses, no throwaway test
  pages or scripts — even in scratch directories. Investigate with code reads
  and ask before any empirical side quest.
- **Git commits only after an approved plan from plan mode.** When working
  from plan mode and the user has approved a plan, commit the work as
  meaningful per-checklist item commits, keeping the description under 255
  characters. Do NOT create git commits by default outside of that flow —
  leave the working tree to the user.
- **Keep the number of live WebGL contexts tiny — Chromium silently falls back
  to software rendering.** A test (or any page) that creates a context per
  mount exhausts the browser's small budget, and the oldest contexts are
  evicted: later frames then crawl, animations never finish, and it looks like
  a logic bug. In the book suites every viewer shares one context
  (`tests/browser/book/helpers.ts`). Prefer one context reused for the whole
  file over one per fixture.
- **`Frame` is a module singleton with no reset API.** Anything that drives
  frames by hand (stubbing `requestAnimationFrame`, stepping a viewer) must keep
  its scheduled-frame id honest: a callback left pending leaves `rafId` set, and
  every later `Frame.request` then waits on a frame that never comes. Point it
  at a capture host (`Frame._setDisplay`) and run one tick per step, as
  `tests/browser/book/helpers.ts` does.
