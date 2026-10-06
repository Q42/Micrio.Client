import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '$types/models'
import { baseInfo } from '../../fixtures/bundles'
import { MockAudioContext, latestAudioContext } from '../audio-context'
import { mockJson } from '../../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'
import { settle } from '../../helpers/tour'
import { get } from '$core/store'

/**
 * `MicrioAudioController` is built by the layout only for an image whose data carries
 * `music` or a marker with `positionalAudio` — a plain marker is not enough. These tests
 * mount a real viewer and use the controller the client itself created, so each one has
 * to include at least one of those two.
 *
 * Two things shape the suite:
 *
 * - `_ctx`, `mainGain` and the `interacted` store live at module level and are
 *   initialised at most once per file. Parameters are therefore not isolated: the
 *   context is created by whichever test triggers `interacted` first, and later tests
 *   reuse it. The order below is deliberate.
 * - Audio is blocked in headless Chromium, which is exactly the "autoplay blocked" path
 *   the controller is built around, so nothing here relies on playback succeeding.
 */

/**
 * A bundle whose image carries a music playlist and/or positional audio markers.
 *
 * The id is fresh per call: `dataLoader` caches image data by id for the whole file, so
 * a reused id would serve the first test's (data-less) image to every later one.
 */
let run = 0
function audioBundle(opts: {
	music?: NonNullable<Models.ImageData.ImageData['music']>
	positional?: boolean
	is360?: boolean
}): Models.ImageBundle.BundleImage {
	const id = `aud${++run}`

	const marker: Models.ImageData.Marker = {
		id: 'm1',
		x: 0.5,
		y: 0.5,
		tags: [],
		data: {},
		...(opts.positional
			? {
					positionalAudio: {
						title: 'Ambience',
						src: 'https://example.test/ambience.mp3',
						size: 1,
						uploaded: 0,
						duration: 3,
						volume: 0.5,
						alwaysPlay: true,
						loop: true,
						repeatAfter: 0,
						noMobile: false,
						radius: 5,
					},
				}
			: {}),
	}
	return {
		id,
		info: baseInfo(id, { is360: opts.is360 ?? false }),
		settings: {},
		data: { markers: [marker], ...(opts.music ? { music: opts.music } : {}) },
	}
}

/**
 * Mounts a viewer on the given bundle and waits until the image data is present.
 *
 * Waiting on `_loading` alone is not enough: it clears before the data is applied, and
 * the audio controller reads the data once, when the layout builds it.
 */
async function mountAudio(bundle: Models.ImageBundle.BundleImage): Promise<Viewer> {
	mockJson(/bundle\.json/, { images: [bundle] })
	const viewer = mountViewer()
	await viewer.open(bundle.id)
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	await waitFor(() => viewer.el.$current?.$data !== undefined, 4000, 'image data')
	if (bundle.data?.music) {
		await waitFor(() => (viewer.el.$current?.$data?.music?.items.length ?? 0) > 0, 4000, 'music data')
	}
	// The controller is built by the layout after the data lands; waiting for its probe
	// element is the reliable signal that it exists
	await waitForController()
	return viewer
}

/** A single-track playlist, for tests that need the controller to exist. */
const someMusic = (loop = true): NonNullable<Models.ImageData.ImageData['music']> => ({
	items: [
		{
			title: 'track',
			src: 'https://example.test/some.mp3',
			size: 1,
			uploaded: 0,
			duration: 3,
			volume: 1,
		},
	],
	loop,
})

/** The `<audio>` element the controller appends for its autoplay probe. */
const probeAudio = () => document.body.querySelector('audio')

/** The real `Audio`, captured once so spying cannot stack across tests. */
const RealAudio = globalThis.Audio

/** Waits until the controller has built its autoplay probe. */
const waitForController = () => waitFor(() => probeAudio() !== null, 4000, 'the audio controller')

afterEach(() => {
	vi.restoreAllMocks()
})

describe('audio controller context', () => {
	it('creates the context and master gain once a user gesture arrives', async () => {
		const viewer = await mountAudio(audioBundle({ positional: true }))
		expect(probeAudio()).not.toBeNull()

		// The autoplay probe is blocked in headless Chromium, which arms a one-shot
		// pointer listener; that is what marks the session as interacted
		globalThis.dispatchEvent(new PointerEvent('pointerup'))
		await waitFor(() => latestAudioContext() !== undefined, 4000, 'the context to be created')

		const ctx = latestAudioContext()
		expect(ctx).toBeInstanceOf(MockAudioContext)
		// One master gain, wired to the destination
		expect(ctx?.gains.length).toBeGreaterThanOrEqual(1)
		const main = ctx?.gains[0]
		expect(main?.connections).toContain(ctx?.destination)
		// The listener is oriented with up = +Y
		expect(ctx?.listener.upY.value).toBe(1)

		viewer.destroy()
	})

	it('sets up no audio graph when the Web Audio API is unavailable', async () => {
		const original = globalThis.AudioContext
		const contextsBefore = latestAudioContext()
		;(globalThis as Record<string, unknown>).AudioContext = undefined
		try {
			// Music would normally bring the controller up. Note the probe element is
			// created before the AudioContext check, so its presence proves nothing —
			// what matters is that no context (and so no graph) is built.
			const viewer = await mountAudio(audioBundle({ music: someMusic() }))
			globalThis.dispatchEvent(new PointerEvent('pointerup'))
			await settle(4)
			expect(latestAudioContext()).toBe(contextsBefore)
			expect(viewer.el.$current?.$data?.music?.items.length).toBe(1)
			viewer.destroy()
		} finally {
			;(globalThis as Record<string, unknown>).AudioContext = original
		}
	})
})

/** Tracks every `<audio>` the controller creates, so the playlist is observable. */
function spyAudio() {
	const created: HTMLAudioElement[] = []
	function TrackingAudio(this: HTMLAudioElement, src?: string) {
		const el = new RealAudio(src)
		created.push(el)
		return el
	}
	TrackingAudio.prototype = RealAudio.prototype
	;(globalThis as Record<string, unknown>).Audio = TrackingAudio
	return {
		created,
		restore: () => {
			;(globalThis as Record<string, unknown>).Audio = RealAudio
		},
	}
}

/** One playlist entry. */
const track = (src: string, volume = 1): Models.Assets.Audio => ({
	title: src,
	src,
	size: 1,
	uploaded: 0,
	duration: 3,
	volume,
})

describe('audio controller playlist', () => {
	it('starts on the first track and advances when one ends', async () => {
		const tracked = spyAudio()
		try {
			const viewer = await mountAudio(
				audioBundle({
					music: { items: [track('https://example.test/one.mp3'), track('https://example.test/two.mp3')], loop: true },
				}),
			)
			const playlist = tracked.created.at(-1)
			expect(playlist?.src).toContain('one.mp3')

			// The playlist advances on `ended`, whatever the element does with playback
			playlist?.dispatchEvent(new Event('ended'))
			expect(playlist?.src).toContain('two.mp3')
			viewer.destroy()
		} finally {
			tracked.restore()
		}
	})

	it('wraps back to the first track when looping', async () => {
		const tracked = spyAudio()
		try {
			const viewer = await mountAudio(
				audioBundle({
					music: { items: [track('https://example.test/a.mp3'), track('https://example.test/b.mp3')], loop: true },
				}),
			)
			const playlist = tracked.created.at(-1)
			playlist?.dispatchEvent(new Event('ended'))
			playlist?.dispatchEvent(new Event('ended'))
			expect(playlist?.src).toContain('a.mp3')
			viewer.destroy()
		} finally {
			tracked.restore()
		}
	})

	it('stops on the last track when not looping', async () => {
		const tracked = spyAudio()
		try {
			const viewer = await mountAudio(
				audioBundle({
					music: { items: [track('https://example.test/x.mp3'), track('https://example.test/y.mp3')], loop: false },
				}),
			)
			const playlist = tracked.created.at(-1)
			playlist?.dispatchEvent(new Event('ended'))
			const last = playlist?.src
			// No further advance: a second end must leave the source untouched
			playlist?.dispatchEvent(new Event('ended'))
			expect(playlist?.src).toBe(last)
			expect(last).toContain('y.mp3')
			viewer.destroy()
		} finally {
			tracked.restore()
		}
	})

	it('scales the playlist volume by the music volume and the mute state', async () => {
		const tracked = spyAudio()
		try {
			const viewer = await mountAudio(
				audioBundle({ music: { items: [track('https://example.test/quiet.mp3')], loop: true, volume: 0.5 } }),
			)
			const playlist = tracked.created.at(-1)
			expect(playlist?.volume).toBeCloseTo(0.5, 6)
			viewer.destroy()
		} finally {
			tracked.restore()
		}
	})

	it('creates no playlist when the image has no music', async () => {
		const tracked = spyAudio()
		try {
			// Positional audio brings the controller up but contributes no playlist
			const viewer = await mountAudio(audioBundle({ positional: true }))
			expect(tracked.created).toHaveLength(1)
			viewer.destroy()
		} finally {
			tracked.restore()
		}
	})

	it('builds the playlist at the muted volume when the client starts muted', async () => {
		const tracked = spyAudio()
		const bundle = audioBundle({ music: { items: [track('https://example.test/m.mp3')], loop: true, volume: 1 } })
		// `mutedVolume: 0` already exists in the bundle settings after the default merge,
		// but `deepCopy(..., noOverwrite)` leaves a value set beforehand alone.
		bundle.settings = { mutedVolume: 0.25 }
		const viewer = mountViewer()
		// `_isMuted` is module-level: start muted for this mount, restore afterwards
		viewer.el._isMuted.set(true)
		try {
			mockJson(/bundle\.json/, { images: [bundle] })
			await viewer.open(bundle.id)
			await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish')
			await waitForController()

			const playlist = tracked.created.at(-1)
			// 0.25 (mutedVolume) * 1 (the track's own volume)
			expect(playlist?.volume).toBeCloseTo(0.25, 6)
		} finally {
			viewer.destroy()
			tracked.restore()
			viewer.el._isMuted.set(false)
		}
	})
})

describe('audio controller autoplay probe', () => {
	// The probe is only built for an image with audio to play — the same condition the
	// layout uses to build the controller, so a no-audio case cannot reach this class.
	it('removes its probe element with the controller', async () => {
		const viewer = await mountAudio(audioBundle({ positional: true }))
		expect(probeAudio()).not.toBeNull()
		viewer.destroy()
		await waitFor(() => probeAudio() === null, 4000, 'the probe to be removed')
	})
})

describe('audio controller mute', () => {
	it('drives the master gain from the element mute state', async () => {
		const viewer = await mountAudio(audioBundle({ music: someMusic() }))
		const ctx = latestAudioContext()
		const main = ctx?.gains[0]
		expect(main).toBeDefined()
		if (!main) {
			throw new Error('no master gain')
		}

		viewer.el._isMuted.set(true)
		await waitFor(() => main.gain.value === 0, 4000, 'the gain to be muted')
		viewer.el._isMuted.set(false)
		await waitFor(() => main.gain.value === 1, 4000, 'the gain to be unmuted')
		viewer.destroy()
	})

	it('mutes to the configured mutedVolume instead of silence', async () => {
		const viewer = await mountAudio(audioBundle({ music: someMusic() }))
		const ctx = latestAudioContext()
		const main = ctx?.gains[0]
		expect(main).toBeDefined()
		if (!main) {
			throw new Error('no master gain')
		}

		// The setting lives in the image's settings store, which the bundle fills
		viewer.el.$current?._settings.update((s) => ({ ...s, mutedVolume: 0.25 }))
		viewer.el._isMuted.set(true)
		await waitFor(() => main.gain.value === 0.25, 4000, 'the gain to be muted at mutedVolume')
		viewer.el._isMuted.set(false)
		await waitFor(() => main.gain.value === 1, 4000, 'the gain to be unmuted')
		viewer.destroy()
	})

	it('clamps a mutedVolume outside 0-1', async () => {
		const viewer = await mountAudio(audioBundle({ music: someMusic() }))
		const main = latestAudioContext()?.gains[0]
		if (!main) {
			throw new Error('no master gain')
		}

		viewer.el.$current?._settings.update((s) => ({ ...s, mutedVolume: 4 }))
		viewer.el._isMuted.set(true)
		await waitFor(() => main.gain.value === 1, 4000, 'the gain to be clamped')
		viewer.el._isMuted.set(false)
		await waitFor(() => main.gain.value === 1, 4000, 'the gain to be unmuted')
		viewer.destroy()
	})

	it('dispatches the mute events as the state flips', async () => {
		const viewer = await mountAudio(audioBundle({ music: someMusic() }))
		const seen: string[] = []
		viewer.el.addEventListener('audio-mute', () => seen.push('mute'))
		viewer.el.addEventListener('audio-unmute', () => seen.push('unmute'))

		viewer.el._isMuted.set(true)
		await waitFor(() => seen.includes('mute'), 4000, 'the mute event')
		viewer.el._isMuted.set(false)
		await waitFor(() => seen.includes('unmute'), 4000, 'the unmute event')
		expect(seen).toEqual(['mute', 'unmute'])
		viewer.destroy()
	})
})

describe('audio controller positional audio', () => {
	it('builds one location per marker with positional audio', async () => {
		const viewer = await mountAudio(audioBundle({ positional: true }))
		const ctx = latestAudioContext()
		expect(ctx).toBeDefined()

		// Locations are (re)built when the current image changes, which has already
		// happened; a second change exercises the rebuild path
		await viewer.open(viewer.el.$current?.id ?? '')
		await waitFor(() => (ctx?.panners.length ?? 0) > 0, 4000, 'a panner for the marker')

		const panner = ctx?.panners.at(-1)
		expect(panner).toBeDefined()
		// 2D branch: linear model and the documented reference distances
		expect(panner?.distanceModel).toBe('linear')
		expect(panner?.rolloffFactor).toBe(2)
		expect(panner?.refDistance).toBeCloseTo(5 * 5 * 10, 6)
		expect(panner?.maxDistance).toBeCloseTo(5 * 5, 6)
		viewer.destroy()
	})

	it('positions the listener as the view moves', async () => {
		const viewer = await mountAudio(audioBundle({ positional: true }))
		const ctx = latestAudioContext()
		const before = ctx?.listener.positions.length ?? 0

		viewer.el.$current?.camera.setCoo(0.7, 0.3)
		// The view subscription is async through the state store
		await waitFor(() => (ctx?.listener.positions.length ?? 0) > before, 4000, 'the listener to move')

		const last = ctx?.listener.positions.at(-1)
		expect(last?.every(Number.isFinite)).toBe(true)
		viewer.destroy()
	})

	it('destroys its locations with the controller', async () => {
		const viewer = await mountAudio(audioBundle({ positional: true }))
		await viewer.open(viewer.el.$current?.id ?? '')
		const ctx = latestAudioContext()
		const panners = ctx?.panners.length ?? 0
		expect(panners).toBeGreaterThan(0)

		viewer.destroy()
		// Every panner built for this image was disconnected on teardown
		expect(ctx?.panners.some((p) => p.disconnects.length > 0)).toBe(true)
	})
})
