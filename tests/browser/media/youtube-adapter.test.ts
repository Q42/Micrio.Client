import { afterEach, describe, expect, it } from 'vitest'
import { YouTubePlayerAdapter } from '$media/youtube-adapter'
import type { PlayerEventCallbacks } from '$types/media'

/**
 * The YouTube adapter is driven entirely by the IFrame API's `events` object, so the
 * stub captures the options handed to `new YT.Player(...)` and lets tests raise
 * readiness, errors and state changes by hand.
 *
 * `loadExternalAPI` is never given a real script to load: the tests stub the API at the
 * global it is read from (`globalThis.YT`), and it only appends a `<script>` tag when that
 * key is missing from `globalThis`. A real script tag would not go through the suite's
 * `fetch` interception, so the CDN path stays out of the offline run entirely.
 */
interface YtEvents {
	onReady?: () => void
	onError?: () => void
	onStateChange?: (e: { data: number }) => void
}

/** The state constants, as the adapter maps them. */
const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }

interface YtStub {
	calls: string[]
	events: YtEvents
	duration: number
	currentTime: number
	playerState: number
	options: Record<string, unknown>[]
	frames: HTMLIFrameElement[]
}

let stub: YtStub | undefined

/** Installs a scriptable `globalThis.YT`. */
function installYouTube(): YtStub {
	const state: YtStub = {
		calls: [],
		events: {},
		duration: 120,
		currentTime: 30,
		playerState: STATE.PLAYING,
		options: [],
		frames: [],
	}

	const player = {
		getDuration: () => state.duration,
		getCurrentTime: () => state.currentTime,
		getPlayerState: () => state.playerState,
		playVideo: () => state.calls.push('playVideo'),
		pauseVideo: () => state.calls.push('pauseVideo'),
		seekTo: (t: number) => state.calls.push(`seekTo:${t}`),
		mute: () => state.calls.push('mute'),
		unMute: () => state.calls.push('unMute'),
		destroy: () => state.calls.push('destroy'),
	}

	// A function constructor, because the adapter calls `new YT['Player'](...)`. It
	// returns the scriptable player, which is what the real API does as well.
	function Player(frame: HTMLIFrameElement, options: Record<string, unknown>) {
		state.frames.push(frame)
		state.options.push(options)
		state.events = options.events as YtEvents
		return player
	}

	;(globalThis as Record<string, unknown>).YT = { Player }
	return state
}

/** Builds an adapter with a fresh frame and records the callbacks it fires. */
function makeAdapter(callbacks: PlayerEventCallbacks = {}) {
	const frame = document.createElement('iframe')
	const adapter = new YouTubePlayerAdapter(frame, { width: 400, height: 240 }, callbacks)
	return { frame, adapter }
}

/**
 * Initializes an adapter, raising readiness as soon as the player has been constructed.
 *
 * `initialize()` awaits the loader and only then constructs the player, so readiness
 * cannot be raised before that happens; the promise executor calls `onReady` for exactly
 * this reason.
 */
async function initialize(adapter: YouTubePlayerAdapter, current = stub) {
	const pending = adapter.initialize()
	await Promise.resolve()
	current?.events.onReady?.()
	await pending
}

afterEach(() => {
	// Assigning rather than deleting: `YT` is a `Window` own property and `delete`
	// throws on it. `installYouTube` reads the key with `in`, so it is gone either way.
	;(globalThis as Record<string, unknown>).YT = undefined
	stub = undefined
})

describe('YouTube adapter initialization', () => {
	it('constructs the player with the frame and documented options', async () => {
		stub = installYouTube()
		const { frame, adapter } = makeAdapter()
		await initialize(adapter)

		expect(stub.frames.at(-1)).toBe(frame)
		const options = stub.options.at(-1) ?? {}
		expect(options.host).toBe('https://www.youtube-nocookie.com')
		expect(options.width).toBe('400')
		expect(options.height).toBe('240')
		expect(options.playerVars).toEqual({ controls: 0 })
	})

	it('reports duration and readiness on ready', async () => {
		stub = installYouTube()
		let readyCount = 0
		let duration = 0
		const { adapter } = makeAdapter({ onReady: () => readyCount++, onDurationChange: (d) => (duration = d) })
		const pending = adapter.initialize()
		await Promise.resolve()
		stub.events.onReady?.()
		await pending

		expect(readyCount).toBe(1)
		expect(duration).toBe(120)
	})

	it('rejects and reports an error when the player errors', async () => {
		stub = installYouTube()
		let errors = 0
		const { adapter } = makeAdapter({ onError: () => errors++ })
		const pending = adapter.initialize()
		await Promise.resolve()
		stub.events.onError?.()
		await expect(pending).rejects.toThrow('YouTube player error')
		expect(errors).toBe(1)
	})

	it('rejects when destroyed while initializing', async () => {
		stub = installYouTube()
		const { adapter } = makeAdapter()
		const pending = adapter.initialize()
		await Promise.resolve()
		adapter.destroy()
		stub.events.onReady?.()
		await expect(pending).rejects.toThrow('destroyed during initialization')
	})

	it('rejects when the loader did not expose the API', async () => {
		// No stub is installed. `afterEach` assigns `globalThis.YT = undefined` rather than
		// deleting the key, so `loadExternalAPI` skips the script tag and reports the missing
		// global: the loader settles without defining the API, which is what a cached or
		// blocked script looks like. The script-*error* path (a callback name plus an `error`
		// event, which `loadScript` settles on) is covered in `tests/browser/utils/dom.test.ts`.
		const { adapter } = makeAdapter()
		await expect(adapter.initialize()).rejects.toThrow('load')
	})
})

/** Fires one state change and reports which callbacks it hit. */
async function fire(state: number) {
	const current = installYouTube()
	stub = current
	const seen: string[] = []
	const { adapter } = makeAdapter({
		onPlay: () => seen.push('play'),
		onPause: () => seen.push('pause'),
		onEnded: () => seen.push('ended'),
		onSeeking: () => seen.push('seeking'),
		onSeeked: () => seen.push('seeked'),
		onBuffering: () => seen.push('buffering'),
		onBlocked: () => seen.push('blocked'),
	})
	await initialize(adapter, current)
	current.events.onStateChange?.({ data: state })
	return seen
}

describe('YouTube adapter state mapping', () => {
	it('maps UNSTARTED to blocked and paused', async () => {
		expect(await fire(STATE.UNSTARTED)).toEqual(['blocked', 'pause'])
	})

	it('maps ENDED to ended', async () => {
		expect(await fire(STATE.ENDED)).toEqual(['ended'])
	})

	it('maps PLAYING to play and seeked', async () => {
		expect(await fire(STATE.PLAYING)).toEqual(['play', 'seeked'])
	})

	it('maps PAUSED to paused', async () => {
		expect(await fire(STATE.PAUSED)).toEqual(['pause'])
	})

	it('maps BUFFERING to buffering and seeking', async () => {
		expect(await fire(STATE.BUFFERING)).toEqual(['buffering', 'seeking'])
	})

	it('ignores an unknown state', async () => {
		expect(await fire(42)).toEqual([])
	})
})

describe('YouTube adapter delegation', () => {
	it('delegates playback to the player', async () => {
		stub = installYouTube()
		const { adapter } = makeAdapter()
		await initialize(adapter)

		await adapter.play()
		adapter.pause()
		adapter.setCurrentTime(11)
		adapter.setMuted(true)
		adapter.setMuted(false)
		// YouTube only exposes mute/unmute, so volume is a documented no-op
		adapter.setVolume(0.3)
		expect(stub.calls).toEqual(['playVideo', 'pauseVideo', 'seekTo:11', 'mute', 'unMute'])
	})

	it('reports time and duration from the player', async () => {
		stub = installYouTube()
		const { adapter } = makeAdapter()
		await initialize(adapter)
		await expect(adapter.getCurrentTime()).resolves.toBe(30)
		await expect(adapter.getDuration()).resolves.toBe(120)
	})

	it('reports seeking before a seek', async () => {
		stub = installYouTube()
		let seeking = 0
		const { adapter } = makeAdapter({ onSeeking: () => seeking++ })
		await initialize(adapter)
		adapter.setCurrentTime(5)
		expect(seeking).toBe(1)
	})

	it('treats unstarted, ended, paused and cued as paused', async () => {
		const current = installYouTube()
		stub = current
		const { adapter } = makeAdapter()
		await initialize(adapter)

		// `isPaused` reads the state synchronously and resolves, so the loop collects
		// the results rather than awaiting each one in turn
		const pausedStates = [STATE.UNSTARTED, STATE.ENDED, STATE.PAUSED, STATE.CUED]
		const results = await Promise.all(
			pausedStates.map((state) => {
				current.playerState = state
				return adapter.isPaused()
			}),
		)
		expect(results).toEqual([true, true, true, true])

		current.playerState = STATE.PLAYING
		await expect(adapter.isPaused()).resolves.toBe(false)
	})

	it('reports paused with empty values before the player exists', async () => {
		const { adapter } = makeAdapter()
		await expect(adapter.isPaused()).resolves.toBe(true)
		await expect(adapter.getCurrentTime()).resolves.toBe(0)
		await expect(adapter.getDuration()).resolves.toBe(0)
	})

	it('stops pausing after destroy and destroys the player', async () => {
		stub = installYouTube()
		const { adapter } = makeAdapter()
		await initialize(adapter)

		adapter.destroy()
		adapter.pause()
		expect(stub.calls).toEqual(['destroy'])
	})
})
