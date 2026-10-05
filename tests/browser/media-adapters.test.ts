import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountTour, settle } from '../helpers/tour'
import { mountMedia, mediaOf, waitForRender } from '../helpers/media'
import { tourBundle } from '../fixtures/tours'
import { waitFor } from '../helpers/viewer'

/**
 * How `<micrio-media>` wires the player adapters.
 *
 * The adapters have their own suites; this one covers the layer above them — which
 * adapter a source gets, how its callbacks reach the controls, and that a failing player
 * never breaks the element.
 *
 * Both external APIs are stubbed before the element is mounted, which is what stops
 * `loadExternalAPI` from reaching for a CDN script.
 */
const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const VIMEO_URL = 'https://vimeo.com/123456789/abcdef123'
const CFVID_URL = 'cfvid://abcdef123456'

/** Tears down whatever a test installed on the globals. */
let restore: (() => void)[] = []

afterEach(() => {
	for (const fn of restore) {
		fn()
	}
	restore = []
	vi.restoreAllMocks()
})

/** Installs a scriptable `globalThis.YT` and reports the player it hands out. */
function installYouTube() {
	const seen: { calls: string[]; events?: Record<string, unknown>; player?: Record<string, unknown> } = { calls: [] }
	const player = {
		getDuration: () => 90,
		getCurrentTime: () => 10,
		getPlayerState: () => 1,
		playVideo: () => seen.calls.push('playVideo'),
		pauseVideo: () => seen.calls.push('pauseVideo'),
		seekTo: () => {},
		mute: () => seen.calls.push('mute'),
		unMute: () => seen.calls.push('unMute'),
		destroy: () => seen.calls.push('destroy'),
	}
	function Player(_frame: HTMLIFrameElement, options: Record<string, unknown>) {
		seen.events = options.events as Record<string, unknown>
		return player
	}
	const original: unknown = (globalThis as Record<string, unknown>).YT
	;(globalThis as Record<string, unknown>).YT = { Player }
	restore.push(() => {
		;(globalThis as Record<string, unknown>).YT = original
	})
	return seen
}

/** Installs a scriptable `globalThis.Vimeo` and reports the player it hands out. */
function installVimeo() {
	const seen: { handlers: Map<string, (d?: unknown) => void> } = { handlers: new Map() }
	const player = {
		on: (event: string, listener: (d?: unknown) => void) => seen.handlers.set(event, listener),
		off: () => {},
		play: () => {},
		pause: () => {},
		getDuration: () => Promise.resolve(180),
		getCurrentTime: () => Promise.resolve(42),
		setCurrentTime: () => {},
		getPaused: () => Promise.resolve(false),
		getVolume: () => Promise.resolve(1),
		setVolume: () => {},
		destroy: () => {},
	}
	function Player() {
		return player
	}
	const original: unknown = (globalThis as Record<string, unknown>).Vimeo
	;(globalThis as Record<string, unknown>).Vimeo = { Player }
	restore.push(() => {
		;(globalThis as Record<string, unknown>).Vimeo = original
	})
	return seen
}

/** Installs a fake `globalThis.Hls` and reports its wiring. */
function installHls() {
	const seen: { source?: string; attaches: number } = { attaches: 0 }
	function Hls() {
		return {
			loadSource: (src: string) => (seen.source = src),
			attachMedia: () => seen.attaches++,
			destroy: () => {},
		}
	}
	const original: unknown = (globalThis as Record<string, unknown>).Hls
	;(globalThis as Record<string, unknown>).Hls = Hls
	restore.push(() => {
		;(globalThis as Record<string, unknown>).Hls = original
	})
	return seen
}

/** Waits for one of the YouTube callbacks the adapter registered and returns it. */
async function waitForCallback<T>(yt: { events?: Record<string, unknown> }, name: string): Promise<T> {
	await waitFor(() => yt.events?.[name] !== undefined, 4000, `the ${name} callback`)
	return yt.events?.[name] as T
}

/** Waits for and returns the YouTube state-change callback. */
const stateChangeOf = (yt: { events?: Record<string, unknown> }) =>
	waitForCallback<(e: { data: number }) => void>(yt, 'onStateChange')

/** The progress bar's inline width, which tracks currentTime / duration. */
const progress = (el: Element) => el.querySelector<HTMLElement>('[data-part="bar"]')?.style.width

/** The play button's class, which reflects the paused/ended state. */
const playIcon = (el: Element) => el.querySelector('micrio-button.play')?.className

describe('media adapter selection', () => {
	it('builds a YouTube adapter for a YouTube source', async () => {
		const yt = installYouTube()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: YT_URL, width: 640, height: 360 }, viewer)
		await waitForRender(el)

		expect(el.querySelector('iframe')?.src).toContain('youtube-nocookie.com')
		// The adapter was constructed from the iframe the element rendered
		await waitFor(() => yt.events !== undefined, 4000, 'the YouTube adapter to be built')
		expect(yt.events?.onStateChange).toBeTypeOf('function')
		viewer.destroy()
	})

	it('builds a Vimeo adapter for a Vimeo source', async () => {
		const vimeo = installVimeo()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: VIMEO_URL }, viewer)
		await waitForRender(el)

		expect(el.querySelector('iframe')?.src).toContain('player.vimeo.com')
		await waitFor(() => vimeo.handlers.size > 0, 4000, 'the Vimeo adapter to be built')
		expect(vimeo.handlers.has('loaded')).toBe(true)
		viewer.destroy()
	})

	it('builds an HLS adapter for a Cloudflare stream source', async () => {
		const hls = installHls()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: CFVID_URL }, viewer)
		await waitForRender(el)

		const video = mediaOf(el)
		expect(video).toBeInstanceOf(HTMLVideoElement)
		await waitFor(() => hls.source !== undefined, 4000, 'the HLS adapter to attach')
		expect(hls.source).toBe('https://videodelivery.net/abcdef123456/manifest/video.m3u8')
		expect(hls.attaches).toBe(1)
		viewer.destroy()
	})

	it('renders the video element even when MediaSource is unavailable', async () => {
		// The Cloudflare fallback: no HLS adapter without MediaSource support, but the
		// element still renders so the browser can try the manifest itself
		const hls = installHls()
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaSource')
		delete (globalThis as Record<string, unknown>).MediaSource
		delete (globalThis as Record<string, unknown>).ManagedMediaSource
		restore.push(() => {
			if (descriptor) {
				Object.defineProperty(globalThis, 'MediaSource', descriptor)
			}
		})

		try {
			const viewer = await mountTour(tourBundle({}))
			const el = await mountMedia({ src: CFVID_URL }, viewer)
			await waitForRender(el)
			await settle(4)
			expect(mediaOf(el)).toBeInstanceOf(HTMLVideoElement)
			expect(hls.source).toBeUndefined()
			viewer.destroy()
		} finally {
			// restored by afterEach
		}
	})
})

describe('media adapter callbacks', () => {
	it('reflects the YouTube player state on the controls', async () => {
		const yt = installYouTube()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: YT_URL }, viewer)
		await waitForRender(el)
		await waitFor(() => yt.events !== undefined, 4000, 'the adapter')

		// PAUSED (2), then PLAYING (1)
		const stateChange = await stateChangeOf(yt)
		const before = playIcon(el)
		stateChange({ data: 2 })
		await settle(2)
		const paused = playIcon(el)
		stateChange({ data: 1 })
		await settle(2)
		const playing = playIcon(el)

		expect(paused).not.toBe(playing)
		expect(before).not.toBe(playing)
		viewer.destroy()
	})

	it('ticks the progress from the YouTube player while playing', async () => {
		const yt = installYouTube()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: YT_URL }, viewer)
		await waitForRender(el)
		await waitFor(() => yt.events !== undefined, 4000, 'the adapter')

		const stateChange = await stateChangeOf(yt)
		const before = progress(el)
		// The 250ms tick only runs while playing; the stub reports 10s of 90s
		vi.useFakeTimers()
		try {
			stateChange({ data: 1 })
			await vi.advanceTimersByTimeAsync(300)
		} finally {
			vi.useRealTimers()
		}
		await waitFor(() => progress(el) !== before, 4000, 'the progress to move')
		// 10 of 90 seconds, rounded to four decimals by the controls
		expect(Number.parseFloat(progress(el) ?? '0')).toBeCloseTo((10 / 90) * 100, 3)
		viewer.destroy()
	})

	it('reports the end of a YouTube video through the media element', async () => {
		const yt = installYouTube()
		const viewer = await mountTour(tourBundle({}))
		let ended = 0
		const el = await mountMedia({ src: YT_URL, onended: () => ended++ }, viewer)
		await waitForRender(el)
		await waitFor(() => yt.events !== undefined, 4000, 'the adapter')

		// ENDED (0) reports through the element's own `onended`, and the tick stops
		;(await stateChangeOf(yt))({ data: 0 })
		await settle(2)
		expect(ended).toBe(1)
		// The progress snaps back to the start, which is how the element resets an ended
		// player for a replay
		expect(progress(el)).toBe('0%')
		viewer.destroy()
	})

	it('updates the progress from Vimeo timeupdate events', async () => {
		const vimeo = installVimeo()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: VIMEO_URL }, viewer)
		await waitForRender(el)
		await waitFor(() => vimeo.handlers.has('timeupdate'), 4000, 'the Vimeo adapter')

		vimeo.handlers.get('timeupdate')?.({ duration: 200, seconds: 50, volume: 1 })
		await waitFor(() => progress(el) === '25%', 4000, 'the reported progress')
		viewer.destroy()
	})
})

describe('media adapter failures', () => {
	it('keeps the element mounted when the player reports an error', async () => {
		const yt = installYouTube()
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: YT_URL }, viewer)
		await waitForRender(el)
		await waitFor(() => yt.events !== undefined, 4000, 'the adapter')

		// A player error rejects the adapter's initialization, which the element swallows
		const onError = await waitForCallback<() => void>(yt, 'onError')
		expect(() => {
			onError()
		}).not.toThrow()
		await settle(4)
		expect(el.querySelector('figure')).not.toBeNull()
		expect(mediaOf(el) ?? el.querySelector('iframe')).not.toBeNull()
		viewer.destroy()
	})
})
