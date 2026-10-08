import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { Models } from '$types/models'
import {
	STEP_TONE_SECONDS,
	STEP_TONE_URI,
	crossImageMarkerTour,
	markerTour,
	serialStoryBundle,
	tourBundle,
	tourSeriesBundle,
} from '../../fixtures/tours'
import { mountTour, settle } from '../../helpers/tour'
import { mockFetch } from '../../helpers/network'
import { mountViewer, waitFor } from '../../helpers/viewer'
import { anyMedia } from '../../helpers/media'

/** A serial tour with step markers that carry video tours, as published tours have. */
const serialTour = (opts: Parameters<typeof markerTour>[0] = {}) =>
	markerTour({ steps: ['m1', 'm2'], isSerialTour: true, ...opts })

/**
 * The layout picks `<micrio-serial-tour>` for a serial tour and `<micrio-tour>` otherwise.
 */
async function startSerial(tour: Models.ImageData.MarkerTour) {
	const viewer = await mountTour(tourBundle({ markerTours: [tour], markersWithVideo: tour.steps }))
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial tour element')
	await settle(4)
	return viewer
}

/**
 * Mounts a story-shaped serial tour through `bundle.json`, the path the client takes
 * in production. It matters here: the serial element resolves every step's marker
 * through `DataLoader._getStepMarker`, which only sees the bundle cache the fetch fills.
 */
async function startStorySerial(
	opts: {
		steps?: number
		printChapters?: boolean
		stepVideoTours?: boolean
		stepDuration?: number
		is360?: boolean
		stepMedia?: boolean
		markerAudio?: boolean
		audioSrc?: string
		audioDuration?: number
	} = {},
) {
	const { images, ids, serialTour: buildTour } = serialStoryBundle(`ser${String(++serialIds)}`, opts)
	if (opts.is360 && images[0]) {
		images[0].info = { ...images[0].info, is360: true }
	}
	mockFetch([{ match: /bundle\.json/, json: { images } }])
	const viewer = mountViewer()
	await viewer.open(ids[0])
	await waitFor(() => viewer.el.$current?.id === ids[0], 4000, 'first story image')

	const tour = buildTour()
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial tour element')
	await settle(4)
	return { viewer, tour, ids }
}

/** Unique per call: `DataLoader` caches bundles by id for the whole file. */
let serialIds = 0

describe('serial tour element', () => {
	it('is used by the layout for a serial marker tour', async () => {
		const viewer = await startSerial(serialTour())
		expect(viewer.el.querySelector('micrio-serial-tour')).not.toBeNull()
		viewer.destroy()
	})

	it('is not used for a plain marker tour', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle(4)
		expect(viewer.el.querySelector('micrio-serial-tour')).toBeNull()
		expect(viewer.el.querySelector('micrio-tour')).not.toBeNull()
		viewer.destroy()
	})

	it('marks the client as having an active marker tour', async () => {
		const viewer = await startSerial(serialTour())
		expect(viewer.el.dataset.markerTourActive).toBeDefined()
		viewer.el.state.tour.set(undefined)
		await settle(3)
		expect(viewer.el.dataset.markerTourActive).toBeUndefined()
		viewer.destroy()
	})
})

describe('serial tour steps across images', () => {
	it('moves the viewer to the step image when the step lives elsewhere', async () => {
		const { images, ids } = tourSeriesBundle('serial1')
		mockFetch([{ match: /bundle\.json/, json: { images } }])
		const viewer = mountViewer()
		await viewer.open(ids[0])
		await waitFor(() => viewer.el.$current?.id === ids[0], 4000, 'first image')
		await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish')

		const tour = crossImageMarkerTour(ids[0], ids[1])
		tour.isSerialTour = true
		viewer.el.state.tour.set(tour)
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial element')
		await settle(4)
		expect(viewer.el.$current?.id).toBe(ids[0])

		// The second step lives on the second image: advancing switches the viewer
		tour.next?.()
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'second image')
		expect(viewer.el.$current?.id).toBe(ids[1])
		viewer.destroy()
	})
})

describe('serial tour controls', () => {
	it('renders a media element and one progress bar per step', async () => {
		const { viewer } = await startStorySerial({ steps: 2 })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')

		await waitFor(() => serialEl?.querySelector('micrio-media') !== null, 4000, 'step media element')
		const bars = serialEl?.querySelectorAll('micrio-media-controls [data-part="bars"] > [data-part="bar"]')
		expect(bars).toHaveLength(2)
		expect(bars?.[0]?.classList.contains('active')).toBe(true)
		expect(bars?.[1]?.classList.contains('active')).toBe(false)
		expect(bars?.[0]?.getAttribute('title')).toBe('Chapter 1')
		viewer.destroy()
	})

	it('moves the active bar to the step the tour advances to', async () => {
		// The bars only exist on a step that builds a media element, and the step is released
		// by that media's own `ended` — so advance the way playback does
		const { viewer, ids } = await startStorySerial({ steps: 2 })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')
		await waitFor(
			() => viewer.el.querySelectorAll('micrio-serial-tour [data-part="bars"] > [data-part="bar"]').length === 2,
			4000,
			'progress bars',
		)
		viewer.el.querySelector('micrio-serial-tour micrio-media')?.dispatchEvent(new CustomEvent('ended'))
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'second story image')
		await waitFor(
			() => serialEl?.querySelector('[data-part="bar"][data-idx="1"]')?.classList.contains('active') === true,
			4000,
			'second bar active',
		)
		viewer.destroy()
	})

	it('renders the chapter list with printChapters', async () => {
		const { viewer, ids } = await startStorySerial({ steps: 2, printChapters: true, stepVideoTours: false })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')
		await waitFor(() => serialEl?.querySelector('ol') !== null, 4000, 'chapter list')

		const buttons = serialEl?.querySelectorAll('ol li button')
		expect(buttons).toHaveLength(2)
		expect(buttons?.[0]?.textContent).toBe('Chapter 1')
		expect(serialEl?.querySelector('ol li')?.classList.contains('active')).toBe(true)

		// The chapter buttons jump between steps
		const second = buttons?.[1]
		if (second instanceof HTMLButtonElement) {
			second.click()
		}
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'chapter jump')
		await waitFor(
			() => serialEl?.querySelectorAll('ol li')[1]?.classList.contains('active') === true,
			4000,
			'second chapter active',
		)
		viewer.destroy()
	})
})

describe('serial tour without step video tours', () => {
	it('still builds the time bar UI for steps that carry no video tour', async () => {
		const { viewer } = await startStorySerial({ steps: 2, stepVideoTours: false })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')
		await waitFor(
			() => serialEl?.querySelectorAll('micrio-media-controls [data-part="bars"] > [data-part="bar"]').length === 2,
			4000,
			'one progress bar per step',
		)
		viewer.destroy()
	})

	it('advances a step that has no video after its step duration', async () => {
		const { viewer, ids } = await startStorySerial({ steps: 2, stepVideoTours: false })
		// The fixture's steps are 6s each; the serial tour is what has to move on
		await waitFor(() => viewer.el.$current?.id === ids[1], 12000, 'the tour to advance by itself')
		expect(viewer.el.$current?.id).toBe(ids[1])
		viewer.destroy()
	})
})

describe('serial tour steps that carry their own media', () => {
	it('does not cut a step off while its audio is still playing', async () => {
		// Real, decodable audio (0.4s) on a step authored as 3s: the audio finishes long
		// before the step does, so the clock — not the audio — is what has to release it
		const { viewer, ids } = await startStorySerial({
			steps: 2,
			stepDuration: 3,
			stepMedia: true,
			markerAudio: true,
			audioSrc: STEP_TONE_URI,
			audioDuration: STEP_TONE_SECONDS,
		})
		// `media.ts` appends its element to the body, not to the figure it renders
		await waitFor(() => anyMedia(viewer.el) !== null, 4000, 'the step audio')
		expect(anyMedia(viewer.el)).toBeInstanceOf(HTMLAudioElement)
		// Well past the audio's own 0.4s, still the first step: the authored duration rules
		await settle(20)
		expect(viewer.el.$current?.id).toBe(ids[0])
		viewer.destroy()
	})

	it('advances the moment the step media ends', async () => {
		// A real, loadable source: a fake URL 404s, which is itself an error that breaks the
		// tour (see the failure test below), so this case needs media that really loads
		const { viewer, ids } = await startStorySerial({
			steps: 2,
			stepDuration: 30,
			stepMedia: true,
			markerAudio: true,
			audioSrc: STEP_TONE_URI,
			audioDuration: STEP_TONE_SECONDS,
		})
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour micrio-media') !== null, 4000, 'the media')
		await settle(4)
		viewer.el.querySelector('micrio-serial-tour micrio-media')?.dispatchEvent(new CustomEvent('ended'))
		// Long before the 30s authored duration: the media end is what releases the step
		await waitFor(() => viewer.el.$current?.id === ids[1], 4000, 'the tour to move on at the media end')
		viewer.destroy()
	})

	it('holds a blocked step, paused, instead of skipping over it', async () => {
		// Autoplay-blocked media has to stay: the step is playable by hand, and its clock
		// must not run, so nothing is skipped over while the user has not heard it
		const { viewer, ids } = await startStorySerial({ steps: 2, stepDuration: 1, stepMedia: true, markerAudio: true })
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour micrio-media') !== null, 4000, 'the media')
		viewer.el.querySelector('micrio-serial-tour micrio-media')?.dispatchEvent(new CustomEvent('blocked'))
		await settle(40)
		expect(viewer.el.$current?.id).toBe(ids[0])
		viewer.destroy()
	})

	it('stops the tour and reports it when the step media fails', async () => {
		// A source that cannot play is a real failure: the tour breaks and says why, instead
		// of being papered over. `media.ts` listens for the element's own `error` event, so
		// that is what the browser (or a 404, a timeout, a decode failure) delivers -- and
		// dispatching it here is the deterministic way to reach that path
		const { viewer, ids } = await startStorySerial({ steps: 2, stepDuration: 1, stepMedia: true, markerAudio: true })
		const errors: CustomEvent[] = []
		const onError = (e: Event) => errors.push(e as CustomEvent)
		viewer.el.addEventListener('media-error', onError)
		// The media element has to be *connected* when the error is reported, not merely
		// present: `#fail()` drops a failure from a disconnected element on purpose (tearing a
		// player down mid-load is cancellation, not failure). An existence check lets the test
		// grab the audio during the gap between steps, and the report is then suppressed —
		// which is how this failed under load while passing in isolation.
		await waitFor(
			() => {
				const media = anyMedia(viewer.el)
				return media != null && media.isConnected
			},
			4000,
			'the connected step media',
		)
		const audio = anyMedia(viewer.el)
		audio?.dispatchEvent(new Event('error'))
		// The tour is gone: stopped on the failing step, not advanced past it
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour') === null, 4000, 'the tour to break')
		expect(get(viewer.el.state.tour)).toBeUndefined()
		expect(viewer.el.$current?.id).toBe(ids[0])
		const detail = errors[0]?.detail as { reason?: string } | undefined
		expect(detail?.reason).toContain('step 1/2')
		viewer.el.removeEventListener('media-error', onError)
		viewer.destroy()
	})

	it('shows the tour time in the control bar before any playback event', async () => {
		// The readout is the media controls' own span, fed by the tour's `getTimeDisplay`.
		// It has to be filled when the bar is built: waiting for the first `timeupdate` or
		// `loadedmetadata` leaves it empty, and an empty span collapses -- its space is then
		// taken by the time bar, which is the jump this pins.
		const { viewer } = await startStorySerial({ steps: 2 })
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour micrio-media') !== null, 4000, 'the step media')
		const readout = () =>
			viewer.el.querySelector<HTMLElement>('micrio-serial-tour micrio-media-controls aside > div > span')
		expect(readout()).not.toBeNull()
		expect(readout()?.textContent ?? '').toMatch(/^\d+:\d\d \/ \d+:\d\d$/)
		// No playback event yet, so the text cannot have come from one
		const media = viewer.el.querySelector('micrio-serial-tour micrio-media')
		let timeUpdates = 0
		const onTime = () => {
			timeUpdates++
		}
		media?.addEventListener('timeupdate', onTime)
		await settle(2)
		expect(timeUpdates).toBe(0)
		expect(readout()?.textContent ?? '').toMatch(/^\d+:\d\d \/ \d+:\d\d$/)
		media?.removeEventListener('timeupdate', onTime)
		viewer.destroy()
	})

	it('keeps the readout filled across a step change', async () => {
		// The step change rebuilds the media element and its controls; the readout must not
		// go blank in between, and keeps following the tour
		const { viewer, ids } = await startStorySerial({ steps: 2, stepDuration: 4 })
		const readout = () =>
			viewer.el.querySelector<HTMLElement>('micrio-serial-tour micrio-media-controls aside > div > span')
		await waitFor(() => (readout()?.textContent ?? '') !== '', 4000, 'the readout text')
		viewer.el.querySelector('micrio-serial-tour micrio-media')?.dispatchEvent(new CustomEvent('ended'))
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'the second step')
		expect(readout()?.textContent ?? '').toMatch(/^\d+:\d\d \/ \d+:\d\d$/)
		viewer.destroy()
	})

	it('renders the readout once, inside the control bar', async () => {
		// A span of the tour's own was a mistake: the bar's readout is the only one
		const { viewer } = await startStorySerial({ steps: 2 })
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'the serial element')
		await settle(4)
		expect(viewer.el.querySelector('micrio-serial-tour > span')).toBeNull()
		expect(viewer.el.querySelectorAll('micrio-serial-tour micrio-media-controls aside > div > span')).toHaveLength(1)
		viewer.destroy()
	})
})

describe('serial tour over a 360 step', () => {
	it('does not advance past a 360 step whose media never plays', async () => {
		// A 360 step's embed is HTML and headless Chromium blocks autoplay, so nothing plays.
		// The step must WAIT (paused) instead of being timed out and skipped: skipping would
		// silently drop content the viewer never saw or heard.
		const { viewer, ids } = await startStorySerial({ steps: 2, stepDuration: 1, is360: true })
		expect(viewer.el.$current?.id).toBe(ids[0])
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour micrio-media') !== null, 4000, 'the step media')
		// Well past the authored duration: still on step one
		await settle(40)
		expect(viewer.el.$current?.id).toBe(ids[0])
		viewer.destroy()
	})
})

describe('serial tour chapters', () => {
	it('prints no chapter list unless the tour asks for it', async () => {
		// Chapters are opt-in (`printChapters === true`), so a tour whose steps carry
		// titles still shows no list
		const { viewer } = await startStorySerial({ steps: 2 })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')
		await waitFor(() => serialEl?.querySelector('[data-part="bars"]') !== null, 4000, 'the time bar')
		expect(serialEl?.querySelector('ol.chapters')).toBeNull()
		viewer.destroy()
	})
})

describe('serial tour state bookkeeping', () => {
	it('exposes next/prev hooks on the tour data once it is mounted', async () => {
		const tour = serialTour()
		const viewer = await startSerial(tour)
		expect(typeof tour.next).toBe('function')
		expect(typeof tour.prev).toBe('function')
		viewer.destroy()
	})

	it('stopping the tour clears the store and the active marker tour flag', async () => {
		const tour = serialTour()
		const viewer = await startSerial(tour)
		viewer.el.state.tour.set(undefined)
		await settle(4)
		expect(get(viewer.el.state.tour)).toBeUndefined()
		expect(viewer.el.dataset.markerTourActive).toBeUndefined()
		viewer.destroy()
	})
})
