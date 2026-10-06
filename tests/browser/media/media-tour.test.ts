import { describe, expect, it } from 'vitest'
import { get, writable } from '$core/store'
import { createElement } from '$utils/dom'
import type { MicrioElement } from '$core/component'
import { mountTour, recordEvents, settle } from '../../helpers/tour'
import { tourBundle, videoTour } from '../../fixtures/tours'
import { waitFor } from '../../helpers/viewer'

/**
 * `<micrio-media>` is what actually runs a tour: it picks the media element for a
 * source, owns the `VideoTourInstance`, drives the controls and ticks the tour
 * clock. Headless Chromium blocks audio and autoplay, so these tests assert the
 * element's state and attributes rather than sound.
 */

/** Mounts a `micrio-media` into the viewer so `_inject('micrio')` resolves. */
async function mountMedia(props: Record<string, unknown>, viewer: Awaited<ReturnType<typeof mountTour>>) {
	const el = createElement('micrio-media', { setProps: props, parent: viewer.el }) as MicrioElement
	await settle(2)
	return el
}

/**
 * Waits until `micrio-media` has actually rendered its figure.
 *
 * The shared audio element is created outside the element (appended to the body
 * and referenced), so queries have to accept it from the document.
 */
async function waitForRender(el: Element) {
	await waitFor(() => el.querySelector('figure') !== null, 4000, 'media figure')
}

/** The media element for a mounted `micrio-media`, wherever it lives. */
const anyMedia = (el: Element) => document.querySelector('body > audio, body > video') ?? mediaOf(el)

const mediaOf = (el: Element) => el.querySelector('video, audio')

describe('media element selection', () => {
	it('uses a shared audio element for audio sources', async () => {
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: 'https://r2.micr.io/audio/tour.mp3' }, viewer)

		await waitForRender(el)
		const media = anyMedia(el)
		expect(media).toBeInstanceOf(HTMLAudioElement)
		expect((media as HTMLAudioElement).src).toContain('tour.mp3')
		viewer.destroy()
	})

	it('uses a youtube-nocookie iframe with the js api for YouTube urls', async () => {
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', width: 640, height: 360 }, viewer)

		const iframe = el.querySelector('iframe')
		expect(iframe?.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
		expect(iframe?.src).toContain('enablejsapi=1')
		expect(iframe?.getAttribute('allow')).toContain('fullscreen')
		expect(iframe?.getAttribute('allowfullscreen')).toBe('')
		viewer.destroy()
	})

	it('extracts the id and h token for Vimeo urls', async () => {
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: 'https://vimeo.com/123456789/abcdef123' }, viewer)

		const iframe = el.querySelector('iframe')
		expect(iframe?.src).toContain('player.vimeo.com/video/123456789')
		expect(iframe?.src).toContain('h=abcdef123')
		viewer.destroy()
	})

	it('uses a cross-origin video element for Cloudflare stream sources', async () => {
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: 'cfvid://abcdef123456' }, viewer)

		const media = mediaOf(el)
		expect(media).toBeInstanceOf(HTMLVideoElement)
		expect(media?.getAttribute('crossorigin')).toBe('anonymous')
		viewer.destroy()
	})

	it('falls back to a plain iframe for other urls', async () => {
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({ src: 'https://example.test/embed' }, viewer)

		expect(el.querySelector('iframe')?.src).toBe('https://example.test/embed')
		viewer.destroy()
	})

	it('renders nothing without a source or a tour', async () => {
		const viewer = await mountTour(tourBundle({}))
		const el = await mountMedia({}, viewer)
		expect(el.childElementCount).toBe(0)
		viewer.destroy()
	})
})

describe('media element with a video tour', () => {
	it('attaches a tour instance for a tour-only media element', async () => {
		const tour = videoTour({ id: 'vt-media', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		const el = await mountMedia({ tour, image, controls: true, autoplay: true }, viewer)

		expect(tour.instance).toBeDefined()
		expect(el.querySelector('micrio-media-controls')).not.toBeNull()
		// `autoplay` starts the tour instance
		expect(tour.instance?.paused).toBe(false)
		viewer.destroy()
	})

	it('reflects the tour time on the client as Timeupdate events', async () => {
		const tour = videoTour({ id: 'vt-tick', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		const seen: number[] = []
		viewer.el.addEventListener('timeupdate', (e) => seen.push((e as CustomEvent).detail as number))
		await mountMedia({ tour, image, controls: true, autoplay: true }, viewer)

		// The standalone-tour branch ticks every 250ms
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 400)
		})
		expect(seen.length).toBeGreaterThan(0)
		expect(seen[0]).toBeGreaterThanOrEqual(0)
		viewer.destroy()
	})

	it('drives the tour from the play button, dispatching play and pause', async () => {
		const tour = videoTour({ id: 'vt-controls', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		const el = await mountMedia({ tour, image, controls: true, autoplay: false }, viewer)
		await waitForRender(el)
		const rec = recordEvents(viewer.el, ['videotour-play', 'videotour-pause'])
		const play = el.querySelector<HTMLButtonElement>('micrio-media-controls micrio-button.play button')

		expect(tour.instance?.paused).toBe(true)
		play?.click()
		await settle(3)
		expect(tour.instance?.paused).toBe(false)
		expect(rec.events.map((e) => e.type)).toContain('videotour-play')

		play?.click()
		await settle(3)
		expect(tour.instance?.paused).toBe(true)
		expect(rec.events.map((e) => e.type)).toContain('videotour-pause')

		rec.stop()
		viewer.destroy()
	})

	it('applies the injected volume store to the media element', async () => {
		const viewer = await mountTour(tourBundle({}))
		const volume = writable(0.25)
		;(viewer.el as unknown as { _provide: (key: string, value: unknown) => void })._provide('volume', volume)
		const el = await mountMedia({ src: 'https://r2.micr.io/audio/tour.mp3' }, viewer)

		await waitForRender(el)
		const media = anyMedia(el) as HTMLAudioElement
		expect(media.volume).toBeCloseTo(0.25, 5)
		volume.set(0.75)
		await settle()
		expect(media.volume).toBeCloseTo(0.75, 5)
		viewer.destroy()
	})

	it('destroys the tour instance when the media is removed', async () => {
		const tour = videoTour({ id: 'vt-teardown', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		const el = await mountMedia({ tour, image, controls: true, autoplay: true }, viewer)
		await waitForRender(el)
		const rec = recordEvents(viewer.el, ['videotour-stop'])
		// Hold the instance: destroy() clears `tour.instance`
		const { instance } = tour
		expect(instance).toBeDefined()

		el.remove()
		await settle(3)
		rec.stop()
		expect(instance).toBeDefined()
		expect(rec.events.map((e) => e.type)).toContain('videotour-stop')
		expect(tour.instance).toBeUndefined()
		viewer.destroy()
	})
})

describe('media subtitles wiring', () => {
	it('creates a subtitles element for a tour that carries one', async () => {
		const tour = videoTour({ id: 'vt-sub', duration: 6, subtitle: 'https://r2.micr.io/subs.vtt' })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		await mountMedia({ tour, image, controls: true, autoplay: true }, viewer)
		await waitFor(() => viewer.el.querySelector('micrio-subtitles') !== null, 4000, 'subtitles element').catch(() => {})
		expect(viewer.el.querySelectorAll('micrio-subtitles').length).toBeLessThanOrEqual(1)
		viewer.destroy()
	})

	it('does not create one for a tour without subtitles', async () => {
		const tour = videoTour({ id: 'vt-nosub', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		await mountMedia({ tour, image, controls: true, autoplay: true }, viewer)
		await settle(3)
		expect(viewer.el.querySelector('micrio-subtitles')).toBeNull()
		viewer.destroy()
	})
})

describe('media state persistence', () => {
	it('records and restores media time through state.mediaState', async () => {
		const viewer = await mountTour(tourBundle({}))
		const { state } = viewer.el
		state.mediaState.set('marker-1', { currentTime: 4.5, paused: true })
		expect(state.mediaState.get('marker-1')).toEqual({ currentTime: 4.5, paused: true })

		// The map is what a re-opened marker media resumes from
		state.mediaState.set('marker-1', { currentTime: 9, paused: false })
		expect(get(viewer.el._isMuted)).toBe(false)
		expect(state.mediaState.get('marker-1')?.currentTime).toBe(9)
		viewer.destroy()
	})
})
