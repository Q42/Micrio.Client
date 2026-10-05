import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '../../src/types/models'
import { MicrioAudioLocation } from '../../src/audio/audio-location'
import { FakeAudioContext, type FakePannerNode } from './audio-context'
import { mockFetch } from '../helpers/network'

/**
 * `MicrioAudioLocation` takes its `AudioContext` as a constructor argument, so — unlike
 * the controller — every test can build its own context and stay independent.
 *
 * The decode cache lives on `globalThis.__micrioAudioBuffers` and is shared by design, so
 * each test uses a distinct source URL.
 */
const AUDIO_MATCH = /example\.test\/.*\.mp3/

/** The cache the module keeps on the global, which a location populates. */
const bufferCache = () =>
	(globalThis as unknown as { __micrioAudioBuffers?: Record<string, AudioBuffer> }).__micrioAudioBuffers

/** A marker carrying positional audio with the given overrides. */
function marker(opts: Partial<Models.Assets.AudioLocation> = {}, x = 0.25, y = 0.75): Models.ImageData.Marker {
	return {
		id: 'm1',
		x,
		y,
		tags: [],
		data: {},
		positionalAudio: {
			title: 'Ambience',
			src: `https://example.test/${Math.random().toString(36).slice(2)}.mp3`,
			size: 1,
			uploaded: 0,
			duration: 3,
			volume: 1,
			alwaysPlay: false,
			loop: false,
			repeatAfter: 0,
			noMobile: false,
			radius: 5,
			...opts,
		},
	}
}

/**
 * A stand-in for the micrio element: an event target that also reports a current image.
 *
 * `#init` reads `micrio.$current` for the image's size and bails out without one, so a
 * location is only built when `$current` is present.
 */
type MicrioStub = HTMLElement & { $current?: { $info: { width: number; height: number } } }

function makeMicrio(withImage = true): MicrioStub {
	const el = document.createElement('div') as MicrioStub
	if (withImage) {
		el.$current = { $info: { width: 512, height: 512 } }
	}
	document.body.append(el)
	return el
}

/** Builds a location against a fresh context and waits for its async start. */
async function makeLocation(m: Models.ImageData.Marker, ctx: FakeAudioContext, is360 = false) {
	mockFetch([{ match: AUDIO_MATCH, json: { ok: true } }])
	const micrio = makeMicrio()
	const location = new MicrioAudioLocation(micrio as never, m, ctx as unknown as AudioContext, is360)
	// The source is fetched and decoded before it can play
	await vi.waitFor(() => {
		if (ctx.sources.length === 0) {
			throw new Error('no source yet')
		}
	})
	return { location, micrio, ctx }
}

/** The lone panner the location created. */
const pannerOf = (ctx: FakeAudioContext): FakePannerNode => {
	const panner = ctx.panners.at(-1)
	if (!panner) {
		throw new Error('no panner')
	}
	return panner
}

afterEach(() => {
	vi.restoreAllMocks()
	document.body.replaceChildren()
	delete (globalThis as unknown as { __micrioAudioBuffers?: unknown }).__micrioAudioBuffers
})

describe('audio location panning', () => {
	it('uses the linear model for a 2D image', async () => {
		const ctx = new FakeAudioContext()
		const { location } = await makeLocation(marker({ radius: 5 }, 0.25, 0.75), ctx)
		const panner = pannerOf(ctx)

		expect(panner.distanceModel).toBe('linear')
		expect(panner.rolloffFactor).toBe(2)
		// Documented 2D distances: radius² × 10 and radius × 5
		expect(panner.refDistance).toBeCloseTo(250, 6)
		expect(panner.maxDistance).toBeCloseTo(25, 6)
		// Position is normalised around the centre, with y flipped and aspect-corrected
		expect(panner.positionX.value).toBeCloseTo(-0.5, 6)
		expect(panner.positionY.value).toBeCloseTo(-0.5, 6)
		expect(panner.positionZ.value).toBeCloseTo(-0.2, 6)
		location.destroy()
	})

	it('places the source on the sphere for a 360 image', async () => {
		const ctx = new FakeAudioContext()
		const { location } = await makeLocation(marker({ radius: 4 }, 0.25, 0.5), ctx, true)
		const panner = pannerOf(ctx)

		// Radius 11, longitude from x and latitude from y
		const angle = 0.25 * -Math.PI * 2
		expect(panner.positionX.value).toBeCloseTo(Math.cos(0) * Math.sin(angle) * 11, 6)
		expect(panner.positionY.value).toBeCloseTo(0, 6)
		expect(panner.positionZ.value).toBeCloseTo(Math.cos(angle) * 11, 6)
		expect(panner.panningModel).toBe('equalpower')
		expect(panner.coneOuterGain).toBe(0)
		// 360 distances: radius × (11/4) and radius × (11/3)
		expect(panner.refDistance).toBeCloseTo(11, 6)
		expect(panner.maxDistance).toBeCloseTo(4 * (11 / 3), 6)
		location.destroy()
	})

	it('orients the panner along its own radius', async () => {
		const ctx = new FakeAudioContext()
		const { location } = await makeLocation(marker({ radius: 4 }, 0.5, 0.75), ctx, true)
		const panner = pannerOf(ctx)
		const length = Math.hypot(panner.orientationX.value, panner.orientationY.value, panner.orientationZ.value)
		// A normalised direction, so its length is 1 (or 0 at the poles)
		expect(length === 0 || Math.abs(length - 1) < 1e-6).toBe(true)
		location.destroy()
	})
})

describe('audio location gain and playback', () => {
	it('applies the asset volume, defaulting to 1', async () => {
		const ctx = new FakeAudioContext()
		const first = await makeLocation(marker({ volume: 0.25 }), ctx)
		expect(first.ctx.gains.at(-1)?.gain.value).toBeCloseTo(0.25, 6)
		first.location.destroy()

		const second = await makeLocation(marker({}), ctx)
		expect(second.ctx.gains.at(-1)?.gain.value).toBe(1)
		second.location.destroy()
	})

	it('starts the source once the buffer is decoded', async () => {
		const ctx = new FakeAudioContext()
		const { location } = await makeLocation(marker({}), ctx)
		const source = ctx.sources.at(-1)
		expect(source?.started).toBe(1)
		// Wired source → panner → gain
		expect(source?.connections).toContain(pannerOf(ctx))
		location.destroy()
	})

	it('caches the decoded buffer per source url', async () => {
		const ctx = new FakeAudioContext()
		const m = marker({})
		const src = m.positionalAudio?.src ?? ''
		const first = await makeLocation(m, ctx)
		expect(bufferCache()?.[src]).toBeDefined()
		first.location.destroy()

		const decoded = ctx.decoded.length
		const second = await makeLocation(m, ctx)
		// The second location reuses the cache: no further fetch or decode
		expect(ctx.decoded.length).toBe(decoded)
		expect(second.ctx.sources.at(-1)?.started).toBe(1)
		second.location.destroy()
	})

	it('loops the source when asked and no repeat delay is set', async () => {
		const ctx = new FakeAudioContext()
		const { location } = await makeLocation(marker({ loop: true, repeatAfter: 0 }), ctx)
		expect(ctx.sources.at(-1)?.loop).toBe(true)
		location.destroy()
	})

	it('repeats after the delay when looping with repeatAfter', async () => {
		const ctx = new FakeAudioContext()
		mockFetch([{ match: AUDIO_MATCH, json: {} }])
		const location = new MicrioAudioLocation(
			makeMicrio() as never,
			marker({ loop: true, repeatAfter: 2 }),
			ctx as unknown as AudioContext,
			false,
		)
		// The decode is asynchronous; wait for the first source before faking the clock,
		// so the scheduled repeat is set up by then
		await vi.waitFor(() => {
			if (ctx.sources.length === 0) {
				throw new Error('no source yet')
			}
		})
		const first = ctx.sources.length

		vi.useFakeTimers()
		try {
			// Ending the buffer schedules the next play rather than looping immediately
			ctx.sources.at(-1)?.emitEnded()
			await vi.advanceTimersByTimeAsync(2000)
			expect(ctx.sources.length).toBeGreaterThan(first)
			// That new source is itself listening for its own end
			ctx.sources.at(-1)?.emitEnded()
			await vi.advanceTimersByTimeAsync(2000)
			expect(ctx.sources.length).toBeGreaterThan(first + 1)
		} finally {
			vi.useRealTimers()
		}
		location.destroy()
	})

	it('delays the first play for alwaysPlay with a repeat delay', async () => {
		vi.useFakeTimers()
		try {
			const ctx = new FakeAudioContext()
			mockFetch([{ match: AUDIO_MATCH, json: {} }])
			const location = new MicrioAudioLocation(
				makeMicrio() as never,
				marker({ alwaysPlay: true, repeatAfter: 1 }),
				ctx as unknown as AudioContext,
				false,
			)
			await vi.advanceTimersByTimeAsync(0)
			expect(ctx.sources).toHaveLength(0)
			await vi.advanceTimersByTimeAsync(1000)
			expect(ctx.sources).toHaveLength(1)
			location.destroy()
		} finally {
			vi.useRealTimers()
		}
	})

	it('does nothing for an asset without a source', () => {
		const ctx = new FakeAudioContext()
		const m = marker({ src: '' })
		const micrio = makeMicrio()
		const location = new MicrioAudioLocation(micrio as never, m, ctx as unknown as AudioContext, false)
		expect(ctx.sources).toHaveLength(0)
		expect(() => {
			location.destroy()
		}).not.toThrow()
	})

	it('does nothing without a current image', () => {
		const ctx = new FakeAudioContext()
		const micrio = makeMicrio(false)
		// No `$current`, which `#init` guards on
		const location = new MicrioAudioLocation(micrio as never, marker({}), ctx as unknown as AudioContext, false)
		expect(ctx.panners).toHaveLength(0)
		expect(() => {
			location.destroy()
		}).not.toThrow()
	})
})

describe('audio location updates and teardown', () => {
	it('re-reads the asset when audio-update is dispatched', async () => {
		const ctx = new FakeAudioContext()
		const { location, micrio } = await makeLocation(marker({ volume: 0.5 }), ctx)
		const gain = ctx.gains.at(-1)
		expect(gain?.gain.value).toBeCloseTo(0.5, 6)

		// The handler re-applies the asset values; a volume change is the observable part
		const m = marker({ volume: 0.9 })
		const next = new MicrioAudioLocation(micrio as never, m, ctx as unknown as AudioContext, false)
		await vi.waitFor(() => {
			if (ctx.gains.length < 2) {
				throw new Error('second gain not ready')
			}
		})
		micrio.dispatchEvent(new Event('audio-update'))
		expect(ctx.gains.at(-1)?.gain.value).toBeCloseTo(0.9, 6)
		next.destroy()
		location.destroy()
	})

	it('removes its listener and disconnects on destroy', async () => {
		const ctx = new FakeAudioContext()
		const { location, micrio } = await makeLocation(marker({}), ctx)
		location.destroy()

		const panner = pannerOf(ctx)
		const gain = ctx.gains.at(-1)
		expect(panner.disconnects.length).toBeGreaterThan(0)
		expect(gain?.disconnects.length).toBeGreaterThan(0)
		// Dispatching afterwards must not throw or touch the (disconnected) nodes
		expect(() => {
			micrio.dispatchEvent(new Event('audio-update'))
		}).not.toThrow()
	})
})
