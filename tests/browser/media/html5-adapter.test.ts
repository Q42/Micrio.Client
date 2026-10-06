import { afterEach, describe, expect, it, vi } from 'vitest'
import { HTML5PlayerAdapter } from '$media/html5-adapter'
import type { PlayerEventCallbacks } from '$types/media'

/**
 * The HTML5 adapter is the reference implementation of `MediaPlayerAdapter`, so it is
 * tested against a real `<video>` element: every callback is mapped to the matching DOM
 * event, and the pass-throughs are asserted on the element itself.
 */
function makeVideo(callbacks: PlayerEventCallbacks = {}) {
	const element = document.createElement('video')
	const adapter = new HTML5PlayerAdapter(element, callbacks)
	return { element, adapter }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('HTML5 adapter event wiring', () => {
	it('maps every described callback to its DOM event', () => {
		const seen: string[] = []
		const { element } = makeVideo({
			onPlay: () => seen.push('play'),
			onPause: () => seen.push('pause'),
			onEnded: () => seen.push('ended'),
			onSeeking: () => seen.push('seeking'),
			onSeeked: () => seen.push('seeked'),
			onTimeUpdate: (t) => seen.push(`time:${t}`),
			onDurationChange: (d) => seen.push(`duration:${d}`),
			onError: (e) => seen.push(`error:${e.message}`),
			onReady: () => seen.push('ready'),
		})

		element.dispatchEvent(new Event('play'))
		element.dispatchEvent(new Event('pause'))
		element.dispatchEvent(new Event('ended'))
		element.dispatchEvent(new Event('seeking'))
		element.dispatchEvent(new Event('seeked'))
		// The adapter reads the element's own values when the event carries none
		Object.defineProperty(element, 'currentTime', { value: 12.5, configurable: true })
		element.dispatchEvent(new Event('timeupdate'))
		Object.defineProperty(element, 'duration', { value: 90, configurable: true })
		element.dispatchEvent(new Event('durationchange'))
		element.dispatchEvent(new Event('error'))
		element.dispatchEvent(new Event('canplay'))

		expect(seen).toEqual([
			'play',
			'pause',
			'ended',
			'seeking',
			'seeked',
			'time:12.5',
			'duration:90',
			'error:Media playback error',
			'ready',
		])
	})

	it('attaches nothing when no callbacks are given', () => {
		const { element } = makeVideo()
		expect(() => {
			for (const type of [
				'play',
				'pause',
				'ended',
				'seeking',
				'seeked',
				'timeupdate',
				'durationchange',
				'error',
				'canplay',
			]) {
				element.dispatchEvent(new Event(type))
			}
		}).not.toThrow()
	})
})

describe('HTML5 adapter playback', () => {
	it('plays through the element', async () => {
		const { element, adapter } = makeVideo()
		const play = vi.spyOn(element, 'play').mockResolvedValue()
		await adapter.play()
		expect(play).toHaveBeenCalledTimes(1)
	})

	it('reports a block when play is rejected for another reason', async () => {
		let blocked = 0
		const { element, adapter } = makeVideo({ onBlocked: () => blocked++ })
		vi.spyOn(element, 'play').mockRejectedValue(new Error('NotAllowedError: play() failed'))
		await expect(adapter.play()).rejects.toThrow('NotAllowedError')
		expect(blocked).toBe(1)
	})

	it('does not report a block when the rejection is a pause interrupt', async () => {
		let blocked = 0
		const { element, adapter } = makeVideo({ onBlocked: () => blocked++ })
		vi.spyOn(element, 'play').mockRejectedValue(new Error('The play() request was interrupted by a call to pause()'))
		await expect(adapter.play()).rejects.toThrow('interrupted')
		expect(blocked).toBe(0)
	})

	it('pauses through the element', () => {
		const { element, adapter } = makeVideo()
		const pause = vi.spyOn(element, 'pause').mockImplementation(() => {})
		adapter.pause()
		expect(pause).toHaveBeenCalledTimes(1)
	})
})

describe('HTML5 adapter state', () => {
	it('reads the current time and duration from the element', async () => {
		const { element, adapter } = makeVideo()
		Object.defineProperty(element, 'currentTime', { value: 3.5, configurable: true })
		Object.defineProperty(element, 'duration', { value: 42, configurable: true })
		await expect(adapter.getCurrentTime()).resolves.toBe(3.5)
		await expect(adapter.getDuration()).resolves.toBe(42)
	})

	it('reports the paused state', async () => {
		const { element, adapter } = makeVideo()
		Object.defineProperty(element, 'paused', { value: true, configurable: true })
		await expect(adapter.isPaused()).resolves.toBe(true)
		Object.defineProperty(element, 'paused', { value: false, configurable: true })
		await expect(adapter.isPaused()).resolves.toBe(false)
	})

	it('sets the current time on the element', () => {
		const { element, adapter } = makeVideo()
		adapter.setCurrentTime(7)
		expect(element.currentTime).toBe(7)
	})

	it('sets muted and clamps the volume', () => {
		const { element, adapter } = makeVideo()
		adapter.setMuted(true)
		expect(element.muted).toBe(true)
		adapter.setMuted(false)
		expect(element.muted).toBe(false)

		adapter.setVolume(0.4)
		expect(element.volume).toBeCloseTo(0.4, 6)
		adapter.setVolume(-1)
		expect(element.volume).toBe(0)
		adapter.setVolume(2)
		expect(element.volume).toBe(1)
	})
})

describe('HTML5 adapter teardown', () => {
	it('detaches every callback it attached', () => {
		// The four value listeners used to be attached as closures and kept firing
		// after teardown; `destroy()` now detaches all nine.
		const seen: string[] = []
		const { element, adapter } = makeVideo({
			onPlay: () => seen.push('play'),
			onPause: () => seen.push('pause'),
			onEnded: () => seen.push('ended'),
			onSeeking: () => seen.push('seeking'),
			onSeeked: () => seen.push('seeked'),
			onTimeUpdate: () => seen.push('time'),
			onDurationChange: () => seen.push('duration'),
			onError: () => seen.push('error'),
			onReady: () => seen.push('ready'),
		})
		adapter.destroy()

		Object.defineProperty(element, 'currentTime', { value: 1, configurable: true })
		Object.defineProperty(element, 'duration', { value: 1, configurable: true })
		for (const type of [
			'play',
			'pause',
			'ended',
			'seeking',
			'seeked',
			'timeupdate',
			'durationchange',
			'error',
			'canplay',
		]) {
			element.dispatchEvent(new Event(type))
		}
		expect(seen).toEqual([])
	})

	it('survives a second destroy', () => {
		const { adapter } = makeVideo({ onPlay: () => {} })
		adapter.destroy()
		expect(() => {
			adapter.destroy()
		}).not.toThrow()
	})
})
