import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { createElement } from '$utils/dom'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, type OpenMarkers } from '../../fixtures/markers'
import { markerTour, videoTour } from '../../fixtures/tours'
import { anyMedia } from '../../helpers/media'
import { settle } from '../../helpers/tour'

/**
 * `<micrio-marker-content>` renders a marker's culture data: title, primary and secondary
 * bodies, audio/video-tour media, an iframe embed and an image gallery.
 *
 * The element is mounted *directly* under the opened viewer (the `helpers/media.ts`
 * pattern) so `noEmbed`/`noImages`/`noGallery`/`onclose` are controllable per case. It
 * resolves its image through `MicrioElement._markerImages`, which is populated by the
 * marker the fixture already rendered — so the marker must have been mounted first.
 */

/** Mounts a `micrio-marker-content` under the viewer. */
function mountContent(opened: OpenMarkers, props: Record<string, unknown>): HTMLElement {
	return createElement('micrio-marker-content', { setProps: props, parent: opened.viewer.el })
}

/** The open marker object for a short fixture id. */
function markerOf(opened: OpenMarkers, short: string): Models.ImageData.Marker {
	const found = opened.image().$data?.markers?.find((m) => m.id === opened.mid(short))
	if (!found) {
		throw new Error(`no marker ${short}`)
	}
	return found
}

/** A gallery asset; `micrioId` drives the IIIF URL, its absence the plain source. */
function asset(micrioId?: string, extra: Partial<Models.Assets.Image> = {}): Models.Assets.Image {
	const name = micrioId ?? 'plain'
	return Object.assign(
		{
			title: `Asset ${name}`,
			src: `https://example.test/${name}.jpg`,
			size: 1,
			uploaded: 0,
			width: 512,
			height: 512,
			i18n: { en: { title: `Title ${name}`, description: `Caption ${name}` } },
		},
		micrioId ? { micrioId } : {},
		extra,
	) as Models.Assets.Image
}

/** An audio asset for the marker's culture data. */
const audioAsset = (): Models.Assets.Audio => ({
	title: 'Audio',
	src: 'https://r2.micr.io/audio/marker.mp3',
	size: 1,
	uploaded: 0,
	duration: 12,
	volume: 1,
})

/** A re-render trigger on the element, which has no public prop setter. */
const reapply = (el: HTMLElement, props: Record<string, unknown>): void =>
	(el as unknown as { _setProps?: (p: unknown) => void })._setProps?.(props)

/** The tag names of an element's direct children, for order assertions. */
const order = (el: HTMLElement) => [...el.children].map((c) => c.tagName.toLowerCase())

/** The fixture the media-end cases share, minus the tour setting. */
const audioFixture = (settings: Partial<Models.ImageInfo.Settings> = {}) =>
	markerBundle({
		markers: [marker('m1', { popupType: 'none', i18n: { en: { title: 'Audio', audio: audioAsset() } } })],
		markerTours: [markerTour({ steps: ['m1'] })],
		settings,
	})

afterEach(() => {
	vi.useRealTimers()
})

describe('marker content text', () => {
	it('renders the title as an h1 and the bodies as articles', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [
					marker('m1', {
						i18n: { en: { title: 'The title', body: '<p>Primary</p>', bodySecondary: '<p>Secondary</p>' } },
					}),
				],
			}),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		expect(el.querySelector('h1')?.textContent).toBe('The title')
		const articles = [...el.querySelectorAll('micrio-article')]
		expect(articles).toHaveLength(2)
		expect(articles[0]?.innerHTML).toContain('Primary')
		expect(articles[1]?.innerHTML).toContain('Secondary')
		opened.viewer.destroy()
	})

	it('puts the body above the media when the image asks for it', async () => {
		const fixture = markerBundle({
			markers: [
				marker('m1', { i18n: { en: { title: 'Order', body: '<p>Body</p>', embedUrl: 'https://example.test/e' } } }),
			],
		})
		const opened = await openMarkers(fixture)

		const normal = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		expect(order(normal)).toEqual(['h1', 'micrio-media', 'micrio-article'])
		normal.remove()

		// Re-open with the setting on: the same fixture cannot carry both orders
		opened.viewer.destroy()
		const fixture2 = markerBundle({
			markers: [
				marker('m1', { i18n: { en: { title: 'Order', body: '<p>Body</p>', embedUrl: 'https://example.test/e' } } }),
			],
			settings: { _markers: { primaryBodyFirst: true } },
		})
		const opened2 = await openMarkers(fixture2)
		const first = mountContent(opened2, { marker: markerOf(opened2, 'm1') })
		await settle(1)
		expect(order(first)).toEqual(['h1', 'micrio-article', 'micrio-media'])
		opened2.viewer.destroy()
	})

	it('renders nothing without culture data for the active language', async () => {
		const bare: Models.ImageData.Marker = { id: 'm1', x: 0.5, y: 0.5, type: 'default', popupType: 'popup' }
		const opened = await openMarkers(markerBundle({ markers: [bare] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		expect(el.childElementCount).toBe(0)
		opened.viewer.destroy()
	})
})

describe('marker content render key', () => {
	it('skips a rebuild when nothing it depends on changed', async () => {
		const opened = await openMarkers(markerBundle())
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		const h1 = el.querySelector('h1')

		reapply(el, { marker: markerOf(opened, 'm1') })
		expect(el.querySelector('h1')).toBe(h1)
		opened.viewer.destroy()
	})

	it('rebuilds when a render prop changes', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { images: [asset('a1')] })] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		const h1 = el.querySelector('h1')
		expect(el.querySelector('section')).not.toBeNull()

		reapply(el, { marker: markerOf(opened, 'm1'), noImages: true })
		expect(el.querySelector('h1')).not.toBe(h1)
		expect(el.querySelector('section')).toBeNull()
		opened.viewer.destroy()
	})
})

describe('marker content images', () => {
	it('renders one asset with a caption and the single-image crop', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { images: [asset('a1')] })] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		const img = el.querySelector<HTMLImageElement>('section button img')
		expect(img?.getAttribute('src')).toBe('https://iiif.micr.io/a1/full/^512,/0/default.webp')
		expect(img?.getAttribute('alt')).toBe('Title a1')
		expect(el.querySelector('section button')?.getAttribute('title')).toBe('Title a1')
		expect(el.querySelector('figcaption')?.textContent).toBe('Caption a1')
		opened.viewer.destroy()
	})

	it('renders multiple assets without a caption and the 320px crop', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { images: [asset('a1'), asset('a2', { width: 800 })] })] }),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		const sources = [...el.querySelectorAll('section button img')].map((i) => i.getAttribute('src'))
		expect(sources).toEqual([
			'https://iiif.micr.io/a1/full/^,320/0/default.webp',
			'https://iiif.micr.io/a2/full/^,320/0/default.webp',
		])
		expect(el.querySelector('figcaption')).toBeNull()
		opened.viewer.destroy()
	})

	it('caps the single-image width at 640', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { images: [asset('wide', { width: 1200 })] })] }),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		expect(el.querySelector('section button img')?.getAttribute('src')).toBe(
			'https://iiif.micr.io/wide/full/^640,/0/default.webp',
		)
		opened.viewer.destroy()
	})

	it('uses the plain source when an asset has no Micrio id', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { images: [asset()] })] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		expect(el.querySelector('section button img')?.getAttribute('src')).toBe('https://example.test/plain.jpg')
		opened.viewer.destroy()
	})

	it('hides the image section with noImages', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { images: [asset('a1')] })] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1'), noImages: true })
		await settle(1)
		expect(el.querySelector('section')).toBeNull()
		expect(el.querySelector('h1')?.textContent).toBeDefined()
		opened.viewer.destroy()
	})

	it('uses the development IIIF host for a dev tile base', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { images: [asset('a1')] })],
				info: { path: 'https://files.micrio.dev/' },
			}),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		expect(el.querySelector('section button img')?.getAttribute('src')).toBe(
			'https://iiif.micrio.dev/a1/full/^512,/0/default.webp',
		)
		opened.viewer.destroy()
	})

	it('opens the gallery with the clicked asset', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { images: [asset('a1'), asset('a2')] })] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		el.querySelectorAll<HTMLButtonElement>('section button')[1]?.click()
		await settle(1)
		const popover = get(opened.viewer.el.state.popover)
		expect(popover?.galleryStart).toBe('a2')
		expect(popover?.gallery).toHaveLength(2)
		expect(popover?.image).toBe(opened.image())
		opened.viewer.destroy()
	})

	it('disables the gallery with noGallery', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { images: [asset('a1')] })] }))
		const el = mountContent(opened, { marker: markerOf(opened, 'm1'), noGallery: true })
		await settle(1)

		expect(el.querySelector<HTMLButtonElement>('section button')?.disabled).toBe(true)
		el.querySelector<HTMLButtonElement>('section button')?.click()
		expect(get(opened.viewer.el.state.popover)).toBeUndefined()
		opened.viewer.destroy()
	})

	it('disables the gallery when the marker prevents opening images', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { images: [asset('a1')], data: { preventImageOpen: true } })] }),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		expect(el.querySelector<HTMLButtonElement>('section button')?.disabled).toBe(true)
		opened.viewer.destroy()
	})
})

describe('marker content embeds', () => {
	it('renders an embed as media with its description', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [
					marker('m1', {
						i18n: { en: { title: 'Embed', embedUrl: 'https://example.test/embed', embedDescription: 'A film' } },
					}),
				],
			}),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		const media = el.querySelector('micrio-media')
		expect(media).not.toBeNull()
		expect(media?.querySelector('iframe')?.getAttribute('src')).toBe('https://example.test/embed')
		expect(media?.querySelector('figcaption')?.textContent).toBe('A film')
		opened.viewer.destroy()
	})

	it('skips the embed with noEmbed', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { i18n: { en: { embedUrl: 'https://example.test/embed' } } })] }),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1'), noEmbed: true })
		await settle(1)
		expect(el.querySelector('micrio-media')).toBeNull()
		opened.viewer.destroy()
	})

	it('adds the video tour’s hidden secondary media next to the embed', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [
					marker('m1', {
						videoTour: videoTour({ id: 'vt-embed' }),
						i18n: { en: { title: 'Both', embedUrl: 'https://example.test/embed' } },
					}),
				],
			}),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		expect(el.querySelectorAll('micrio-media')).toHaveLength(2)
		expect(el.querySelector('micrio-media figure.hidden')).not.toBeNull()
		opened.viewer.destroy()
	})
})

describe('marker content audio', () => {
	it('renders the audio asset as media', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { i18n: { en: { title: 'Audio', audio: audioAsset() } } })] }),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)

		const media = el.querySelector('micrio-media')
		expect(media).not.toBeNull()
		expect(anyMedia(el)?.getAttribute('src')).toBe('https://r2.micr.io/audio/marker.mp3')
		opened.viewer.destroy()
	})

	it('autoplays the audio only when the marker asks for it', async () => {
		const quietBundle = markerBundle({ markers: [marker('m1', { i18n: { en: { audio: audioAsset() } } })] })
		const quiet = await openMarkers(quietBundle)
		const quietEl = mountContent(quiet, { marker: markerOf(quiet, 'm1') })
		await settle(1)
		expect(anyMedia(quietEl)?.hasAttribute('autoplay')).toBe(false)
		quiet.viewer.destroy()

		const loudBundle = markerBundle({
			markers: [marker('m1', { i18n: { en: { audio: audioAsset() } }, audioAutoPlay: true })],
		})
		const loud = await openMarkers(loudBundle)
		const loudEl = mountContent(loud, { marker: markerOf(loud, 'm1') })
		await settle(1)
		expect(anyMedia(loudEl)?.hasAttribute('autoplay')).toBe(true)
		loud.viewer.destroy()
	})

	it('does not autoplay when the image prevents it', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { i18n: { en: { audio: audioAsset() } }, audioAutoPlay: true })],
				settings: { _markers: { preventAutoPlay: true } },
			}),
		)
		const el = mountContent(opened, { marker: markerOf(opened, 'm1') })
		await settle(1)
		expect(anyMedia(el)?.hasAttribute('autoplay')).toBe(false)
		opened.viewer.destroy()
	})
})

describe('marker content media end', () => {
	it('closes when the media ends during an auto-progressing tour', async () => {
		const fixture = audioFixture({ _markers: { tourAutoProgress: true } })
		const opened = await openMarkers(fixture)
		opened.viewer.el.state.tour.set(fixture.markerTours[0])
		await settle(2)

		const onclose = vi.fn()
		const el = mountContent(opened, { marker: markerOf(opened, 'm1'), onclose })
		await settle(1)
		const media = anyMedia(el)
		expect(media).not.toBeNull()

		media?.dispatchEvent(new Event('ended'))
		expect(onclose).toHaveBeenCalledTimes(1)
		opened.viewer.destroy()
	})

	it('stays open when the tour does not auto-progress', async () => {
		const fixture = audioFixture()
		const opened = await openMarkers(fixture)
		opened.viewer.el.state.tour.set(fixture.markerTours[0])
		await settle(2)

		const onclose = vi.fn()
		const el = mountContent(opened, { marker: markerOf(opened, 'm1'), onclose })
		await settle(1)

		anyMedia(el)?.dispatchEvent(new Event('ended'))
		expect(onclose).not.toHaveBeenCalled()
		opened.viewer.destroy()
	})
})
