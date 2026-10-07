import { afterEach, describe, expect, it } from 'vitest'
import { VimeoPlayerAdapter } from '$media/vimeo-adapter'
import type { PlayerEventCallbacks } from '$types/media'

/**
 * The Vimeo adapter is driven by the player's event emitter, so the stub records the
 * callbacks registered through `on()` and lets tests fire them by name.
 *
 * `globalThis.Vimeo` is installed before `initialize()`. Unlike the YouTube API, Vimeo's
 * loader is called without a callback name, so a script that fails to load rejects rather
 * than hanging — but there is still no reason to reach the CDN.
 */
interface VimeoPayload {
	duration: number
	seconds: number
	volume: number
}

type VimeoListener = (data?: VimeoPayload) => void

interface VimeoStub {
	calls: string[]
	/** Listeners registered through `on()`, by event name. */
	handlers: Map<string, VimeoListener>
	/** The event names passed to `off()`. */
	removed: string[]
	registered: string[]
	currentTime: number
	duration: number
	paused: boolean
	volume: number
	options: Record<string, unknown>[]
	frames: HTMLIFrameElement[]
	fire: (event: string, data?: VimeoPayload) => void
	restore: () => void
}

let stub: VimeoStub | undefined

/** Installs a scriptable `globalThis.Vimeo`. */
function installVimeo(): VimeoStub {
	const state = {
		calls: [] as string[],
		handlers: new Map<string, VimeoListener>(),
		removed: [] as string[],
		registered: [] as string[],
		currentTime: 12,
		duration: 240,
		paused: false,
		volume: 1,
		options: [] as Record<string, unknown>[],
		frames: [] as HTMLIFrameElement[],
	} as VimeoStub

	const player = {
		on: (event: string, listener: VimeoListener) => {
			state.handlers.set(event, listener)
			state.registered.push(event)
		},
		off: (event: string) => {
			state.removed.push(event)
			state.handlers.delete(event)
		},
		play: () => state.calls.push('play'),
		pause: () => state.calls.push('pause'),
		getDuration: () => Promise.resolve(state.duration),
		getCurrentTime: () => Promise.resolve(state.currentTime),
		setCurrentTime: (seconds: number) => state.calls.push(`setCurrentTime:${seconds}`),
		getPaused: () => Promise.resolve(state.paused),
		getVolume: () => Promise.resolve(state.volume),
		setVolume: (volume: number) => state.calls.push(`setVolume:${volume}`),
		destroy: () => state.calls.push('destroy'),
	}

	// A function constructor, because the adapter calls `new Vimeo['Player'](...)`
	function Player(frame: HTMLIFrameElement, options: Record<string, unknown>) {
		state.frames.push(frame)
		state.options.push(options)
		return player
	}

	// Read the previous value before installing, so `restore` is not a no-op
	const original: unknown = (globalThis as Record<string, unknown>).Vimeo
	;(globalThis as Record<string, unknown>).Vimeo = { Player }
	state.fire = (event, data) => state.handlers.get(event)?.(data)
	state.restore = () => {
		;(globalThis as Record<string, unknown>).Vimeo = original
	}
	return state
}

/** Builds an adapter with a fresh frame and records the callbacks it fires. */
function makeAdapter(callbacks: PlayerEventCallbacks = {}) {
	const frame = document.createElement('iframe')
	const adapter = new VimeoPlayerAdapter(frame, { width: 400, height: 240 }, callbacks)
	return { frame, adapter }
}

/**
 * Starts an adapter against a fresh stub and yields once, so the player has been
 * constructed and its listeners registered before a test fires an event.
 *
 * Without the yield the event is raised before `initialize()` gets past its awaited
 * loader, and because the adapter only resolves from its own handlers nothing would
 * ever settle — the test would sit until the timeout.
 */
async function startAdapter(callbacks: PlayerEventCallbacks = {}) {
	const current = installVimeo()
	stub = current
	const { frame, adapter } = makeAdapter(callbacks)
	const pending = adapter.initialize()
	await Promise.resolve()
	return { current, frame, adapter, pending }
}

afterEach(() => {
	stub?.restore()
	stub = undefined
})

describe('Vimeo adapter initialization', () => {
	it('constructs the player with the frame and documented options', async () => {
		const { current, frame, pending } = await startAdapter()
		current.fire('loaded')
		await pending

		expect(current.frames.at(-1)).toBe(frame)
		const options = current.options.at(-1) ?? {}
		expect(options.width).toBe('400')
		expect(options.height).toBe('240')
		expect(options.title).toBe(false)
		expect(options.autoplay).toBe(false)
	})

	it('resolves readiness only after the volume round-trip', async () => {
		let ready = 0
		const { current, pending } = await startAdapter({ onReady: () => ready++ })
		expect(ready).toBe(0)
		current.fire('loaded')
		await pending
		expect(ready).toBe(1)
	})

	it('rejects and reports an error when the player errors', async () => {
		let errors = 0
		const { current, pending } = await startAdapter({ onError: () => errors++ })
		current.fire('error')
		await expect(pending).rejects.toThrow('Vimeo player error')
		expect(errors).toBe(1)
	})

	it('rejects when destroyed while initializing', async () => {
		const { current, adapter, pending } = await startAdapter()
		// Capture the handler first: `destroy()` unsubscribes every event, and the point
		// of the guard is a `loaded` that arrives *after* the adapter is gone.
		const loaded = current.handlers.get('loaded')
		adapter.destroy()
		loaded?.()
		await expect(pending).rejects.toThrow('destroyed during initialization')
	})

	it('rejects when the API global has no player constructor', async () => {
		// Present but unusable, so the loader settles without a script load. The
		// genuinely-missing-global path (a script that never loads) is covered by
		// `dom.test.ts`, where the deadline can be driven with fake timers.
		stub = installVimeo()
		;(globalThis as Record<string, unknown>).Vimeo = {}
		const { adapter } = makeAdapter()
		await expect(adapter.initialize()).rejects.toThrow()
	})
})

/**
 * Initializes an adapter that records every callback, and returns the recorder.
 *
 * The callbacks fired during initialization are cleared, so a test only sees the event
 * it raises itself.
 */
async function fireEvents() {
	const seen: string[] = []
	const { current, pending } = await startAdapter({
		onPlay: () => seen.push('play'),
		onPause: () => seen.push('pause'),
		onEnded: () => seen.push('ended'),
		onSeeking: () => seen.push('seeking'),
		onSeeked: () => seen.push('seeked'),
		onBuffering: () => seen.push('buffering'),
		onTimeUpdate: (t) => seen.push(`time:${t}`),
		onDurationChange: (d) => seen.push(`duration:${d}`),
	})
	current.fire('loaded')
	await pending

	seen.length = 0
	return { current, seen }
}

describe('Vimeo adapter events', () => {
	it('maps play to play and seeked', async () => {
		const { current, seen } = await fireEvents()
		current.fire('play')
		expect(seen).toEqual(['play', 'seeked'])
	})

	it('maps pause to paused', async () => {
		const { current, seen } = await fireEvents()
		current.fire('pause')
		expect(seen).toEqual(['pause'])
	})

	it('maps ended to ended', async () => {
		const { current, seen } = await fireEvents()
		current.fire('ended')
		expect(seen).toEqual(['ended'])
	})

	it('maps seeked to seeked', async () => {
		const { current, seen } = await fireEvents()
		current.fire('seeked')
		expect(seen).toEqual(['seeked'])
	})

	it('maps bufferstart to buffering and seeking', async () => {
		const { current, seen } = await fireEvents()
		current.fire('bufferstart')
		expect(seen).toEqual(['buffering', 'seeking'])
	})

	it('maps timeupdate to duration and time', async () => {
		const { current, seen } = await fireEvents()
		current.fire('timeupdate', { duration: 300, seconds: 42, volume: 1 })
		expect(seen).toEqual(['duration:300', 'time:42'])
	})

	it('ignores an empty timeupdate payload', async () => {
		const { current, seen } = await fireEvents()
		current.fire('timeupdate')
		expect(seen).toEqual([])
	})

	it('registers every documented listener', async () => {
		const { current } = await fireEvents()
		expect(current.registered).toEqual([
			'error',
			'loaded',
			'play',
			'bufferstart',
			'seeked',
			'pause',
			'timeupdate',
			'ended',
		])
	})
})

describe('Vimeo adapter delegation', () => {
	it('delegates playback and seeks', async () => {
		const { current, adapter, pending } = await startAdapter()
		current.fire('loaded')
		await pending

		await adapter.play()
		adapter.pause()
		adapter.setCurrentTime(33)
		expect(current.calls).toEqual(['play', 'pause', 'setCurrentTime:33'])
	})

	it('reports time, duration and paused state', async () => {
		const { current, adapter, pending } = await startAdapter()
		current.fire('loaded')
		await pending

		await expect(adapter.getCurrentTime()).resolves.toBe(12)
		await expect(adapter.getDuration()).resolves.toBe(240)
		await expect(adapter.isPaused()).resolves.toBe(false)
		current.paused = true
		await expect(adapter.isPaused()).resolves.toBe(true)
	})

	it('falls back to safe values without a player', async () => {
		const { adapter } = makeAdapter()
		await expect(adapter.getCurrentTime()).resolves.toBe(0)
		await expect(adapter.getDuration()).resolves.toBe(0)
		await expect(adapter.isPaused()).resolves.toBe(true)
	})

	it('sets volume, clamped, and mutes through volume 0', async () => {
		const { current, adapter, pending } = await startAdapter()
		current.fire('loaded')
		await pending

		adapter.setVolume(0.4)
		adapter.setVolume(2)
		adapter.setVolume(-1)
		adapter.setMuted(true)
		adapter.setMuted(false)
		expect(current.calls).toEqual(['setVolume:0.4', 'setVolume:1', 'setVolume:0', 'setVolume:0', 'setVolume:1'])
	})

	it('unsubscribes every event and destroys the player', async () => {
		const { current, adapter, pending } = await startAdapter()
		current.fire('loaded')
		await pending

		adapter.destroy()
		expect(current.calls.at(-1)).toBe('destroy')
		expect(current.removed).toEqual([
			'error',
			'loaded',
			'play',
			'bufferstart',
			'seeked',
			'pause',
			'volumechange',
			'timeupdate',
			'ended',
		])
	})
})
