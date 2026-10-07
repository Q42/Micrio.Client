import { afterEach, describe, expect, it } from 'vitest'
import { HLSPlayerAdapter } from '$media/hls-adapter'

/**
 * The HLS adapter is a thin layer over the HTML5 one: it loads HLS.js, wires the stream
 * into a real `<video>` element, and delegates everything else. `globalThis.Hls` is
 * installed before `initialize()`, so the loader resolves without reaching the CDN.
 */
interface HlsCalls {
	loadSource?: string
	attachMedia?: HTMLMediaElement
	config?: unknown
	destroyed: number
	order: string[]
}

/** Installs a fake `globalThis.Hls` that records its wiring. */
function installHls(): HlsCalls {
	const state: HlsCalls = { destroyed: 0, order: [] }

	function Hls(config?: unknown) {
		state.config = config
		state.order.push('construct')
		return {
			loadSource: (src: string) => {
				state.loadSource = src
				state.order.push('loadSource')
			},
			attachMedia: (el: HTMLMediaElement) => {
				state.attachMedia = el
				state.order.push('attachMedia')
			},
			destroy: () => {
				state.destroyed++
				state.order.push('hls.destroy')
			},
		}
	}

	;(globalThis as Record<string, unknown>).Hls = Hls
	return state
}

/** Builds an adapter around a real video element. */
function makeAdapter(hlsSrc = 'https://videodelivery.net/abc/manifest/video.m3u8') {
	const video = document.createElement('video')
	const seen: string[] = []
	const adapter = new HLSPlayerAdapter(video, hlsSrc, {
		onReady: () => seen.push('ready'),
		onPlay: () => seen.push('play'),
		onPause: () => seen.push('pause'),
		onEnded: () => seen.push('ended'),
	})
	return { video, adapter, seen }
}

afterEach(() => {
	;(globalThis as Record<string, unknown>).Hls = undefined
})

describe('HLS adapter initialization', () => {
	it('attaches the configured HLS instance to the video element', async () => {
		const state = installHls()
		const { video, adapter } = makeAdapter()
		await adapter.initialize()

		expect(state.config).toEqual({ abrEwmaDefaultEstimate: 10_000_000, abrEwmaDefaultEstimateMax: 50_000_000 })
		expect(state.loadSource).toBe('https://videodelivery.net/abc/manifest/video.m3u8')
		expect(state.attachMedia).toBe(video)
		// The source is set before the media is attached, as HLS.js expects
		expect(state.order).toEqual(['construct', 'loadSource', 'attachMedia'])
	})

	it('reports readiness once attached', async () => {
		installHls()
		const { adapter, seen } = makeAdapter()
		await adapter.initialize()
		expect(seen).toEqual(['ready'])
	})

	it('throws when HLS.js is not available', async () => {
		const { adapter } = makeAdapter()
		await expect(adapter.initialize()).rejects.toThrow('HLS.js failed to load')
	})

	it('refuses to initialize after being destroyed', async () => {
		installHls()
		const { adapter } = makeAdapter()
		adapter.destroy()
		await expect(adapter.initialize()).rejects.toThrow('Adapter destroyed during initialization')
	})
})

describe('HLS adapter inheritance', () => {
	it('forwards the HTML5 playback state', async () => {
		installHls()
		const { video, adapter } = makeAdapter()
		await adapter.initialize()

		Object.defineProperty(video, 'currentTime', { value: 5, configurable: true })
		Object.defineProperty(video, 'duration', { value: 60, configurable: true })
		await expect(adapter.getCurrentTime()).resolves.toBe(5)
		await expect(adapter.getDuration()).resolves.toBe(60)

		adapter.setVolume(0.25)
		expect(video.volume).toBeCloseTo(0.25, 6)
		adapter.setMuted(true)
		expect(video.muted).toBe(true)
	})

	it('delivers DOM events through the inherited callbacks', async () => {
		installHls()
		const { video, adapter, seen } = makeAdapter()
		await adapter.initialize()

		video.dispatchEvent(new Event('play'))
		video.dispatchEvent(new Event('pause'))
		video.dispatchEvent(new Event('ended'))
		expect(seen).toEqual(['ready', 'play', 'pause', 'ended'])
	})
})

describe('HLS adapter teardown', () => {
	it('destroys the HLS instance and the inherited listeners', async () => {
		const state = installHls()
		const { video, adapter, seen } = makeAdapter()
		await adapter.initialize()

		adapter.destroy()
		expect(state.destroyed).toBe(1)

		// The base adapter removes its no-argument listeners
		seen.length = 0
		video.dispatchEvent(new Event('play'))
		video.dispatchEvent(new Event('pause'))
		expect(seen).toEqual([])
	})
})
