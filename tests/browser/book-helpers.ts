import { Frame } from '$core/frame'
import { BookViewer, type BookViewerOptions, type DrawnImage } from '$book/main'
import type { Models } from '$types/models'

/**
 * The BookViewer harness.
 *
 * `BookViewer`'s page state is private, so the tests drive it through the public
 * API (`_nextPage`, `goto`, `zoom`, pointer events) and observe it through the
 * callbacks and the small `@internal` readers (`_getCurrentPage`, `_step`).
 *
 * Frames are stepped manually, with a fixed delta, so flips and the physics are
 * deterministic. `goto()`'s cascade re-schedules each flip through `Frame` (the
 * client's single scheduler), which is a module singleton: to step the book the
 * harness runs the book's own frame via `_step` and then runs exactly one
 * `Frame` tick, by handing the scheduler a host whose `requestAnimationFrame`
 * captures `tick` for the harness to invoke. That keeps the singleton's
 * scheduled-frame bookkeeping honest, which a no-op rAF stub does not — a
 * callback it drops leaves `rafId` set and the next cascade waits forever.
 */

/** One image info the layout can size a page with. */
export const bookImage = (id: string, width = 800, height = 600): Models.ImageInfo.ImageInfo =>
	({ id, width, height }) as Models.ImageInfo.ImageInfo

/** The `tick` callback the scheduler handed to the harness, if any. */
let pendingTick: ((now: number) => void) | undefined
let rafHandle = 0
let realRaf: typeof requestAnimationFrame | undefined
let realCancelRaf: typeof cancelAnimationFrame | undefined

/** The host the scheduler is pointed at while the harness is stepping frames. */
const captureWindow = {
	requestAnimationFrame: (cb: FrameRequestCallback) => {
		pendingTick = cb as (now: number) => void
		return ++rafHandle
	},
	cancelAnimationFrame: () => {
		pendingTick = undefined
	},
} as unknown as Window

/** Runs the captured frame, if the scheduler asked for one. */
function runTick(now: number): void {
	const tick = pendingTick
	pendingTick = undefined
	tick?.(now)
}

/** Puts the real rAF back and re-homes the scheduler; call from the suite's `afterEach`. */
export function restoreFrameStub(): void {
	pendingTick = undefined
	Frame._setDisplay(globalThis as unknown as Window)
	if (realRaf !== undefined) {
		globalThis.requestAnimationFrame = realRaf
		realRaf = undefined
	}
	if (realCancelRaf !== undefined) {
		globalThis.cancelAnimationFrame = realCancelRaf
		realCancelRaf = undefined
	}
}

/** One shared WebGL2 context for every mounted book. */
let sharedGl: WebGL2RenderingContext | undefined

/**
 * Chromium keeps only a small number of live WebGL contexts (16 by default) and
 * silently evicts the oldest, after which `getContext` falls back — and a suite
 * that mounts a fresh context per test ends up running its later tests on a
 * lost/software context, where the frame loop crawls and cascades never finish.
 * Every book here draws the same synthetic page, so they share one context by
 * pointing the renderer at a wrapper whose `canvas` is the caller's element.
 */
function sharedContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
	if (sharedGl === undefined) {
		const host = document.createElement('canvas')
		host.width = 800
		host.height = 600
		const gl = host.getContext('webgl2')
		if (gl === null) {
			throw new Error('no WebGL2 context available for the book suite')
		}
		sharedGl = gl
	}
	return new Proxy(sharedGl, {
		get(target, prop, receiver) {
			if (prop === 'canvas') {
				return canvas
			}
			const value = Reflect.get(target, prop, receiver)
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
}

export interface ViewerHarness {
	viewer: BookViewer
	canvas: HTMLCanvasElement
	/** The images the book was built from. */
	images: Models.ImageInfo.ImageInfo[]
	/** Every `_onPageChange` value, in order. */
	pages: number[]
	/** Every `_onDraw` payload, in order. */
	draws: DrawnImage[][]
	/** Every `_onViewChange` payload, in order. */
	views: DrawnImage[][]
	/** Advances one frame at `ms` (default one 60Hz tick); returns whether more are wanted. */
	step: (ms?: number) => boolean
	/** Steps a fixed number of frames. */
	steps: (count: number, ms?: number) => void
	/**
	 * Steps until `predicate` holds, up to a frame budget. Every stepped frame
	 * runs the full XPBD solver, so the budget stays small: a flip is ~36 frames
	 * and a cascade plus its physics settle finishes well inside a few hundred.
	 */
	until: (predicate: () => boolean, budget?: number) => boolean
	/**
	 * Steps frames until `predicate` holds, yielding between steps so promise
	 * callbacks run. An awaited `goto()` only resolves on a frame the harness
	 * drives, so a plain synchronous stepping loop can never observe it.
	 */
	settle: (predicate: () => boolean, budget?: number) => Promise<{ frames: number; settled: boolean }>
	/** The last `_onDraw` payload. */
	lastDraw: () => DrawnImage[]
	destroy: () => void
}

/**
 * Mounts a sized canvas and a `BookViewer` on it, waits for the viewer to finish
 * loading its page textures, and leaves the scheduler pointed at the harness.
 */
export async function mountBook(
	options: Pick<
		BookViewerOptions,
		| '_hardCover'
		| '_seeThroughMargins'
		| '_allowRotation'
		| '_startPageIdx'
		| '_lightingPreset'
		| '_useIndividualAspects'
		| '_iiifBaseUrl'
	> & {
		images?: Models.ImageInfo.ImageInfo[]
		canvas?: HTMLCanvasElement
	} = {},
): Promise<ViewerHarness> {
	const images = options.images ?? [bookImage('p0'), bookImage('p1'), bookImage('p2'), bookImage('p3')]
	const canvas =
		options.canvas ??
		(() => {
			const el = document.createElement('canvas')
			el.style.cssText = 'width: 800px; height: 600px;'
			document.body.append(el)
			return el
		})()

	// The harness owns the frame loop for the whole file: no real rAF, and the
	// scheduler points at the capture host until `restoreFrameStub`.
	realRaf ??= globalThis.requestAnimationFrame
	realCancelRaf ??= globalThis.cancelAnimationFrame
	globalThis.requestAnimationFrame = captureWindow.requestAnimationFrame.bind(captureWindow)
	globalThis.cancelAnimationFrame = captureWindow.cancelAnimationFrame.bind(captureWindow)
	pendingTick = undefined
	Frame._setDisplay(captureWindow)

	const pages: number[] = []
	const draws: DrawnImage[][] = []
	const views: DrawnImage[][] = []

	const realGetContext = canvas.getContext.bind(canvas)
	canvas.getContext = ((id: string, ...rest: unknown[]) =>
		id === 'webgl2' ? sharedContext(canvas) : realGetContext(id, ...rest)) as HTMLCanvasElement['getContext']

	const viewer = new BookViewer({
		_canvas: canvas,
		_images: images,
		_hardCover: options._hardCover,
		_seeThroughMargins: options._seeThroughMargins,
		_allowRotation: options._allowRotation,
		_startPageIdx: options._startPageIdx,
		_lightingPreset: options._lightingPreset,
		_useIndividualAspects: options._useIndividualAspects,
		_iiifBaseUrl: options._iiifBaseUrl,
		_onPageChange: (p) => {
			pages.push(p)
		},
		_onDraw: (d) => {
			draws.push(d)
		},
		_onViewChange: (v) => {
			views.push(v)
		},
	})

	let clock = 0
	const step = (ms = 1000 / 60): boolean => {
		clock += ms
		const more = viewer._step(ms)
		// The scheduler may have asked for a frame before the step ran (a cascade
		// queues its next flip while the book is still moving), so drain it after.
		runTick(clock)
		return more
	}

	const harness: ViewerHarness = {
		viewer,
		canvas,
		images,
		pages,
		draws,
		views,
		step,
		steps(count, ms) {
			for (let i = 0; i < count; i++) {
				step(ms)
			}
		},
		until(predicate, budget = 300) {
			if (predicate()) {
				return true
			}
			for (let i = 0; i < budget; i++) {
				step()
				if (predicate()) {
					return true
				}
			}
			return false
		},
		async settle(predicate, budget = 300) {
			let frames = 0
			let resolved = false
			// One `await` per step, in the promise chain rather than in a loop body:
			// each step must yield, so a promise the run scheduled between steps can
			// run before the next frame is stepped.
			const runStep = async (): Promise<void> => {
				if (resolved || frames >= budget) {
					return
				}
				step()
				frames++
				await Promise.resolve()
				resolved = predicate()
				return runStep()
			}
			await runStep()
			return { frames, settled: predicate() }
		},
		lastDraw() {
			return draws.at(-1) ?? []
		},
		destroy() {
			// The viewer keeps a `Frame` request queued while it animates, and
			// `Frame` is a singleton, so a viewer the test walks away from would keep
			// running its simulation on every later frame of the file
			viewer._stop()
			document.body.replaceChildren()
		},
	}

	await viewer._ready
	// One frame so the first draw callback and the view state are populated
	step()
	return harness
}
