/**
 * Timer-based waiting, for the times a test must wait on the real clock.
 *
 * `waitFor` in `./viewer` polls on `requestAnimationFrame`, which is the right clock for
 * waiting on the client's frame loop — but it is also the first thing Chromium throttles when
 * several suites run at once. A wait with a deadline then misses it even though the work
 * lands, which is how a handful of suites came to fail only under load (while passing in
 * isolation, and passing on an idle machine for three full runs in a row).
 *
 * `pollUntil` wakes on a timer instead, so a frame-starved browser cannot stretch it.
 */

/** One timer turn. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms)
	})

/**
 * Resolves once `predicate` is true, polling on a timer; rejects after `timeout` ms.
 *
 * **Not for faked clocks.** A test that runs under `vi.useFakeTimers()` must keep using
 * `waitFor`, which a faked clock deliberately never advances; `pollUntil` would advance it.
 * This is for a real-clock deadline: a camera animation, a state publish, a class the grid
 * writes in response to focus.
 */
export function pollUntil(predicate: () => boolean, timeout = 4000, label = 'condition'): Promise<void> {
	const start = performance.now()
	const check = async (): Promise<void> => {
		if (predicate()) {
			return
		}
		if (performance.now() - start > timeout) {
			throw new Error(`Timed out waiting for ${label}`)
		}
		await sleep(16)
		return check()
	}
	return check()
}
