import { afterEach, describe, expect, it, vi } from 'vitest'
import { Frame } from '$core/frame'

/**
 * A manually driven rAF host: callbacks are queued and only run when
 * {@link FakeDisplay.runFrame} is called, which makes frame ordering and
 * re-scheduling fully deterministic.
 */
class FakeDisplay {
	#next = 1
	#queue = new Map<number, FrameRequestCallback>()
	requestAnimationFrame(cb: FrameRequestCallback): number {
		const id = this.#next++
		this.#queue.set(id, cb)
		return id
	}
	cancelAnimationFrame(id: number): void {
		this.#queue.delete(id)
	}
	get pending(): number {
		return this.#queue.size
	}
	/** Runs every currently queued callback once, like a browser frame. */
	runFrame(time = 0): void {
		const queued = [...this.#queue.entries()]
		this.#queue.clear()
		for (const [, cb] of queued) {
			cb(time)
		}
	}
}

const isWindowLike = (display: FakeDisplay) => display as unknown as Window

describe('Frame scheduler', () => {
	const displays: FakeDisplay[] = []

	const install = () => {
		const display = new FakeDisplay()
		displays.push(display)
		Frame._setDisplay(isWindowLike(display))
		return display
	}

	afterEach(() => {
		Frame._setDisplay(globalThis as unknown as Window)
		displays.length = 0
		vi.restoreAllMocks()
	})

	it('runs every callback requested for a frame, in request order', () => {
		const display = install()
		const order: string[] = []
		Frame.request(() => order.push('a'))
		Frame.request(() => order.push('b'))
		expect(display.pending).toBe(1)
		display.runFrame()
		expect(order).toEqual(['a', 'b'])
	})

	it('schedules at most one rAF no matter how many callbacks are queued', () => {
		const display = install()
		for (let i = 0; i < 10; i++) {
			Frame.request(() => {})
		}
		expect(display.pending).toBe(1)
	})

	it('de-duplicates the same callback identity within a frame', () => {
		const display = install()
		const cb = vi.fn()
		Frame.request(cb)
		Frame.request(cb)
		display.runFrame()
		expect(cb).toHaveBeenCalledTimes(1)
	})

	it('runs a callback requested during a frame on the *next* frame', () => {
		const display = install()
		const order: string[] = []
		Frame.request(() => {
			order.push('first')
			Frame.request(() => order.push('second'))
		})
		display.runFrame()
		expect(order).toEqual(['first'])
		expect(display.pending).toBe(1)
		display.runFrame()
		expect(order).toEqual(['first', 'second'])
	})

	it('cancel() removes a pending callback', () => {
		const display = install()
		const cb = vi.fn()
		Frame.request(cb)
		Frame.cancel(cb)
		display.runFrame()
		expect(cb).not.toHaveBeenCalled()
	})

	it('cancel() of the last callback also cancels the scheduled frame', () => {
		const display = install()
		const cb = vi.fn()
		Frame.request(cb)
		expect(display.pending).toBe(1)
		Frame.cancel(cb)
		expect(display.pending).toBe(0)
	})

	it('cancel() of an unknown callback is a no-op', () => {
		const display = install()
		const cb = vi.fn()
		Frame.request(cb)
		expect(() => {
			Frame.cancel(() => {})
		}).not.toThrow()
		// The scheduled frame survives and still runs the real callback
		expect(display.pending).toBe(1)
		display.runFrame()
		expect(cb).toHaveBeenCalledTimes(1)
	})

	it('increments id once per processed frame', () => {
		const display = install()
		const before = Frame.id
		Frame.request(() => {})
		display.runFrame()
		expect(Frame.id).toBe(before + 1)
		display.runFrame()
		expect(Frame.id).toBe(before + 1)
	})

	it('isolates a throwing callback and keeps the loop alive', () => {
		const display = install()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const after = vi.fn()
		Frame.request(() => {
			throw new Error('boom')
		})
		Frame.request(after)
		display.runFrame()
		expect(after).toHaveBeenCalledTimes(1)
		expect(errorSpy).toHaveBeenCalledWith('[Micrio] frame callback error', expect.anything())
	})

	it('after() resolves on the next frame', async () => {
		const display = install()
		let resolved = false
		const p = Frame.after().then(() => {
			resolved = true
		})
		await Promise.resolve()
		expect(resolved).toBe(false)
		display.runFrame()
		await p
		expect(resolved).toBe(true)
	})

	it('afterPaint() needs two frames', async () => {
		const display = install()
		let resolved = false
		const p = Frame.afterPaint().then(() => {
			resolved = true
		})
		display.runFrame()
		await Promise.resolve()
		expect(resolved).toBe(false)
		display.runFrame()
		await p
		expect(resolved).toBe(true)
	})

	it('_setDisplay re-homes a pending frame onto the new display', () => {
		const first = install()
		const cb = vi.fn()
		Frame.request(cb)
		expect(first.pending).toBe(1)

		const second = new FakeDisplay()
		displays.push(second)
		Frame._setDisplay(isWindowLike(second))
		expect(first.pending).toBe(0)
		expect(second.pending).toBe(1)
		second.runFrame()
		expect(cb).toHaveBeenCalledTimes(1)
	})
})
