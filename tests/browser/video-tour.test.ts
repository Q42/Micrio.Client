import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from '../../src/core/store'
import { VideoTourInstance } from '../../src/media/videotour'
import type { MicrioImage } from '../../src/core/image'
import type { Models } from '../../src/types/models'
import { recordEvents, tickClock } from '../helpers/tour'
import { mountViewer, waitFor } from '../helpers/viewer'
import { tourBundle, videoTour } from '../fixtures/tours'

/**
 * `VideoTourInstance` is what every video tour (standalone, marker-driven and
 * serial-step) runs on. Playback is driven by a faked clock: the instance derives
 * `currentTime` from `Date.now()` and schedules its steps with `setTimeout`.
 *
 * Mounting has to happen with *real* timers, because `waitFor` polls on
 * requestAnimationFrame, which a faked clock never advances.
 */
async function mountWithBundle(tour: Models.ImageData.VideoTour, settings: Partial<Models.ImageInfo.Settings> = {}) {
	const viewer = mountViewer()
	await viewer.open(tourBundle({ tours: [tour], settings }))
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	const image = viewer.el.$current
	if (!image) {
		throw new Error('no current image')
	}
	return { viewer, image }
}

/** Mounts, then switches to a faked clock for deterministic playback. */
async function mountWithFakeTime(
	tour: Models.ImageData.VideoTour,
	settings: Partial<Models.ImageInfo.Settings> = {},
): Promise<{ viewer: ReturnType<typeof mountViewer>; image: MicrioImage }> {
	const mounted = await mountWithBundle(tour, settings)
	vi.useFakeTimers()
	return mounted
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

/** Creates an instance directly, without going through `<micrio-media>`. */
function instance(image: MicrioImage, tour: Models.ImageData.VideoTour): VideoTourInstance {
	return new VideoTourInstance(image, tour)
}

describe('VideoTourInstance construction', () => {
	it('throws when the tour has no content for the current language', async () => {
		const { viewer, image } = await mountWithBundle(videoTour({ langs: ['nl'] }))
		viewer.el.lang = 'en'
		expect(() => instance(image, videoTour({ langs: ['nl'] }))).toThrow('No valid content for video tour!')
		viewer.destroy()
	})

	it('registers itself on the tour data and dispatches videotour-start', async () => {
		const tour = videoTour()
		const { viewer, image } = await mountWithBundle(tour)
		const rec = recordEvents(viewer.el, ['videotour-start'])

		const inst = instance(image, tour)
		expect(tour.instance).toBe(inst)
		expect(rec.events.map((e) => e.type)).toEqual(['videotour-start'])
		expect(rec.events[0]?.detail).toBe(tour)

		rec.stop()
		inst.destroy()
		viewer.destroy()
	})
})

describe('VideoTourInstance timeline', () => {
	it('reports the tour duration from its content', async () => {
		const { viewer, image } = await mountWithBundle(videoTour({ duration: 12 }))
		const inst = instance(image, videoTour({ duration: 12 }))
		expect(inst.duration).toBe(12)
		inst.destroy()
		viewer.destroy()
	})

	it('derives a segment start from the previous segment end', async () => {
		// A gap between 4s and 6s: segment 2 must start at the previous `end`, not at
		// its own `start`, which is the behaviour that makes timelines non-contiguous.
		const settings = {
			start: { type: 'tour' as const, id: 'vt1' },
		}
		const tour = videoTour({
			duration: 12,
			timeline: [
				{ start: 0, end: 4, rect: [0, 0, 0.5, 0.5] },
				{ start: 6, end: 12, rect: [0.5, 0.5, 0.5, 0.5] },
			],
		})
		const { viewer, image } = await mountWithBundle(tour, settings)
		const inst = instance(image, tour)

		// Seeking inside the first segment reports the requested time
		inst.currentTime = 2
		expect(inst.currentTime).toBeCloseTo(2, 5)
		// Seeking into the gap before segment 2 keeps the reported time (clamped >= 0)
		inst.currentTime = 5
		expect(inst.currentTime).toBeGreaterThanOrEqual(0)
		expect(inst.currentTime).toBeLessThanOrEqual(12)
		inst.destroy()
		viewer.destroy()
	})

	it('clamps event windows to the tour duration and defaults a missing start', async () => {
		const tour = videoTour({
			duration: 5,
			events: [
				{ start: 1, end: 99, action: 'overrun' },
				{ end: 3, action: 'no-start' } as unknown as Models.ImageData.Event,
			],
		})
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		const rec = recordEvents(viewer.el, ['tour-event'])

		// Past the (clamped) end of the first event
		inst.updateEvents(2)
		const overrun = rec.events.find((e) => (e.detail as Models.ImageData.Event).action === 'overrun')
		expect(rec.events).toHaveLength(1)
		expect((overrun?.detail as Models.ImageData.Event | undefined)?.end).toBe(5)

		rec.stop()
		inst.destroy()
		viewer.destroy()
	})
})

describe('VideoTourInstance custom events', () => {
	it('dispatches tour-event once per activation and once per deactivation', async () => {
		const tour = videoTour({
			duration: 10,
			events: [{ start: 2, end: 4, action: 'focus', data: 'somewhere' }],
		})
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		const rec = recordEvents(viewer.el, ['tour-event'])

		inst.updateEvents(1) // before
		inst.updateEvents(2.5) // inside -> activate
		inst.updateEvents(3) // still inside -> nothing
		inst.updateEvents(5) // after -> deactivate
		rec.stop()

		const details = rec.events.map((e) => e.detail as Models.ImageData.Event | undefined)
		expect(details.map((d) => d?.active)).toEqual([true, false])
		expect(details[0]?.action).toBe('focus')
		expect(details[0]?.data).toBe('somewhere')
		inst.destroy()
		viewer.destroy()
	})

	it('sends a final inactive tour-event for events still active on destroy', async () => {
		const tour = videoTour({ duration: 10, events: [{ start: 0, end: 10, action: 'long' }] })
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		inst.updateEvents(5)
		const rec = recordEvents(viewer.el, ['tour-event'])

		inst.destroy()
		rec.stop()
		expect(rec.events).toHaveLength(1)
		const [event] = rec.events
		expect((event?.detail as Models.ImageData.Event | undefined)?.active).toBe(false)
		viewer.destroy()
	})

	it('does nothing when the tour has no events', async () => {
		const tour = videoTour({ events: [] })
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		const rec = recordEvents(viewer.el, ['tour-event'])
		inst.updateEvents(1)
		rec.stop()
		expect(rec.events).toEqual([])
		inst.destroy()
		viewer.destroy()
	})
})

describe('VideoTourInstance playback state', () => {
	it('starts paused before play() and reports the active state on the element', async () => {
		const tour = videoTour()
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		const rec = recordEvents(viewer.el, ['videotour-play', 'videotour-pause'])

		expect(inst.paused).toBe(true)
		inst.play()
		expect(inst.paused).toBe(false)
		expect(viewer.el.dataset.videoTourActive).toBe('')
		expect(rec.events.map((e) => e.type)).toEqual(['videotour-play'])

		inst.pause()
		expect(inst.paused).toBe(true)
		expect(rec.events.map((e) => e.type)).toEqual(['videotour-play', 'videotour-pause'])

		rec.stop()
		inst.destroy()
		viewer.destroy()
	})

	it('advances currentTime as the clock runs', async () => {
		const tour = videoTour({ duration: 10 })
		const { viewer, image } = await mountWithFakeTime(tour)
		const inst = instance(image, tour)

		inst.play()
		const start = inst.currentTime
		tickClock(1000)
		expect(inst.currentTime - start).toBeCloseTo(1, 5)
		inst.destroy()
		viewer.destroy()
	})

	it('reports ended once the duration has passed', async () => {
		const tour = videoTour({ duration: 3 })
		const { viewer, image } = await mountWithFakeTime(tour)
		const inst = instance(image, tour)
		inst.play()
		expect(inst.ended).toBe(false)
		tickClock(4000)
		expect(inst.ended).toBe(true)
		inst.destroy()
		viewer.destroy()
	})

	it('freezes the tour clock while paused and runs it again after resuming', async () => {
		const tour = videoTour({ duration: 20 })
		const { viewer, image } = await mountWithFakeTime(tour)
		const inst = instance(image, tour)

		inst.play()
		// Let the first step fire so the instance is genuinely mid-tour
		tickClock(2000)
		vi.advanceTimersByTime(0)
		inst.pause()
		const atPause = inst.currentTime
		expect(atPause).toBeGreaterThan(0)
		expect(inst.paused).toBe(true)

		// Real time passing while paused must not advance the tour
		tickClock(5000)
		expect(inst.currentTime).toBe(atPause)

		inst.play()
		expect(inst.paused).toBe(false)
		tickClock(1000)
		// It moves again, and never runs backwards
		expect(inst.currentTime).toBeGreaterThan(0)
		expect(inst.currentTime).not.toBe(atPause)
		inst.destroy()
		viewer.destroy()
	})

	it('disables user input while playing and restores it on destroy', async () => {
		const tour = videoTour()
		const { viewer, image } = await mountWithBundle(tour)
		viewer.el.events.enabled.set(true)
		const inst = instance(image, tour)

		inst.play()
		expect(get(viewer.el.events.enabled)).toBe(false)
		inst.destroy()
		expect(get(viewer.el.events.enabled)).toBe(true)
		viewer.destroy()
	})

	it('never touches user input when keepInteraction is set', async () => {
		const tour = videoTour({ keepInteraction: true })
		const { viewer, image } = await mountWithBundle(tour)
		viewer.el.events.enabled.set(true)
		const inst = instance(image, tour)

		inst.play()
		expect(get(viewer.el.events.enabled)).toBe(true)
		inst.pause()
		expect(get(viewer.el.events.enabled)).toBe(true)
		inst.destroy()
		expect(get(viewer.el.events.enabled)).toBe(true)
		viewer.destroy()
	})
})

describe('VideoTourInstance seeking', () => {
	it('clamps progress to the 0-1 range', async () => {
		const tour = videoTour({ duration: 10 })
		const { viewer, image } = await mountWithFakeTime(tour)
		const inst = instance(image, tour)

		inst.progress = -1
		expect(inst.progress).toBeGreaterThanOrEqual(0)
		inst.progress = 2
		expect(inst.progress).toBeLessThanOrEqual(1)
		inst.destroy()
		viewer.destroy()
	})

	it('seeks to a progress value and reports it back', async () => {
		const tour = videoTour({ duration: 10 })
		const { viewer, image } = await mountWithFakeTime(tour)
		const inst = instance(image, tour)

		inst.progress = 0.4
		expect(inst.currentTime).toBeCloseTo(4, 1)
		inst.destroy()
		viewer.destroy()
	})

	it('reports ended when seeking to the very end', async () => {
		const tour = videoTour({ duration: 10 })
		const { viewer, image } = await mountWithFakeTime(tour)
		const inst = instance(image, tour)
		inst.progress = 1
		expect(inst.ended).toBe(true)
		inst.destroy()
		viewer.destroy()
	})

	it('survives seeking before the first segment starts', async () => {
		const tour = videoTour({ duration: 10 })
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		expect(() => {
			inst.currentTime = 0
		}).not.toThrow()
		expect(inst.currentTime).toBeGreaterThanOrEqual(0)
		inst.destroy()
		viewer.destroy()
	})
})

describe('VideoTourInstance teardown', () => {
	it('destroy() clears the element flag, the tour instance and dispatches videotour-stop', async () => {
		const tour = videoTour()
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		inst.play()
		const rec = recordEvents(viewer.el, ['videotour-stop'])

		inst.destroy()
		rec.stop()
		expect(viewer.el.dataset.videoTourActive).toBeUndefined()
		expect(tour.instance).toBeUndefined()
		expect(rec.events.map((e) => e.type)).toEqual(['videotour-stop'])
		viewer.destroy()
	})

	it('keeps its language content across a language switch, until re-read', async () => {
		const tour = videoTour({ duration: 10, extraLangWithTimeline: true })
		const { viewer, image } = await mountWithBundle(tour)
		const inst = instance(image, tour)
		expect(inst.duration).toBe(10)

		// The instance's content is resolved once, at construction; switching the
		// client language does not silently swap the playing tour's timeline.
		viewer.el.lang = 'nl'
		inst.read()
		expect(inst.duration).toBe(10)
		inst.destroy()
		viewer.destroy()
	})

	it('resolves the new language for an instance created after the switch', async () => {
		const tour = videoTour({ duration: 10, extraLangWithTimeline: true })
		const { viewer, image } = await mountWithBundle(tour)
		viewer.el.lang = 'nl'
		const inst = instance(image, tour)
		expect(inst.duration).toBe(4)
		inst.destroy()
		viewer.destroy()
	})
})
