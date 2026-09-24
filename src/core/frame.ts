/**
 * Central frame scheduler.
 *
 * This module is the **only** place in the client that calls
 * `requestAnimationFrame`. Everything that needs a frame — the WebGL engine's
 * render loop, the book3d render loop, gallery animations, one-shot deferrals
 * and `afterFrame()` helpers — routes through {@link Frame}.
 *
 * Using a single loop guarantees:
 * - at most one rAF is in flight at any time, no matter how many engines,
 *   viewers or components are active;
 * - all frame work happens in a well-defined order inside the same frame;
 * - the loop stops completely when nothing requests a frame.
 *
 * @author Marcel Duin <marcel@micr.io>
 */

/** A callback invoked once per scheduled frame with the rAF timestamp. @internal */
export type FrameCallback = (now: number) => void;

/** The window-like object providing rAF; overridable for non-window contexts. @internal */
let display: Window = self;

/** Handle of the currently scheduled rAF, or 0 when none is scheduled. @internal */
let rafId: number = 0;

/** Monotonically increasing frame counter, incremented once per processed frame. @internal */
let frameId: number = 0;

/** Callbacks requested for the next frame (identity-deduplicated). @internal */
const pending: Set<FrameCallback> = new Set();

/** Requests the next frame if one is not already scheduled. @internal */
function schedule(): void {
	if (rafId) return;
	rafId = display.requestAnimationFrame(tick);
}

/** Processes one frame: snapshots the pending callbacks and reschedules if more arrive. @internal */
function tick(now: number): void {
	rafId = 0;
	frameId++;

	// Snapshot + clear: anything requested *during* this frame runs on the next one.
	const callbacks = [...pending];
	pending.clear();

	for (let i = 0; i < callbacks.length; i++) {
		try {
			callbacks[i](now);
		} catch (e) {
			console.error('[Micrio] frame callback error', e);
		}
	}

	if (pending.size) schedule();
}

/**
 * The single frame scheduler. All animation loops and frame deferrals go through
 * {@link Frame.request}; direct `requestAnimationFrame` calls are not allowed
 * anywhere else in the client.
 * @internal
 */
export const Frame = {
	/** The number of the frame currently being processed. @internal */
	get id(): number { return frameId; },

	/**
	 * Queues a callback for the next frame.
	 * Requesting the same callback again before it runs is a no-op.
	 * @internal
	 */
	request(cb: FrameCallback): void {
		pending.add(cb);
		schedule();
	},

	/** Removes a pending callback. A no-op if it is not queued. @internal */
	cancel(cb: FrameCallback): void {
		pending.delete(cb);
		if (!pending.size && rafId) {
			display.cancelAnimationFrame(rafId);
			rafId = 0;
		}
	},

	/** Resolves after the next frame. @internal */
	after(): Promise<void> {
		return new Promise<void>(ok => Frame.request(() => ok()));
	},

	/** Resolves after the next paint (two frames), matching the old `afterFrame()`. @internal */
	afterPaint(): Promise<void> {
		return new Promise<void>(ok => Frame.request(() => Frame.request(() => ok())));
	},

	/**
	 * Overrides the rAF source. Used by the WebGL controller to preserve its
	 * `_display` seam (defaults to `self`).
	 * @internal
	 */
	_setDisplay(win: Window): void {
		if (display !== win) {
			// Re-home a scheduled frame so the previous display doesn't fire it.
			if (rafId) display.cancelAnimationFrame(rafId);
			display = win;
			rafId = 0;
			if (pending.size) schedule();
		}
	}
};
