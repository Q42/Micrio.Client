import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '../../src/types/models'
import { get } from '../../src/core/store'
import {
	imageAsset,
	markerTour,
	openUi,
	pageButton,
	uiBundle,
	uiMarker,
	uiPage,
	videoTourFixture,
} from '../fixtures/ui'
import { settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/**
 * `<micrio-popover>` is the client's one modal surface, and it is modular: the same element
 * renders a content page (article, media-only or page image), a swipe gallery, or a marker's
 * rich content — with a close/next aside, custom action buttons and a welcome-screen entry
 * point. These tests cover each mode and the seams between them.
 *
 * Two things shape the suite. The element is created by the layout when `state.popover`
 * becomes set, so tests drive the *state* (and, for the toolbar path, a real menu click).
 * And the dialog is a real `<dialog>`: `showModal()` gives it `.open`, and its `close` event
 * is what clears the state again.
 */

const dialogOf = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) =>
	viewer.el.querySelector<HTMLDialogElement>('micrio-popover dialog')

/** A child of the dialog, matched shallowly so nested media cannot satisfy the query. */
const inDialog = (viewer: Awaited<ReturnType<typeof openUi>>['viewer'], selector: string) =>
	dialogOf(viewer)?.querySelector(`:scope > ${selector}`) ?? null

/** Sets the popover state and waits for the dialog to be open. */
async function openPopover(viewer: Awaited<ReturnType<typeof openUi>>['viewer'], popover: Models.State.PopoverType) {
	viewer.el.state.popover.set(popover)
	await waitFor(() => dialogOf(viewer)?.open === true, 4000, 'the popover dialog')
	return dialogOf(viewer)
}

/** The aside's button, which the popover uses for either closing or stepping. */
const asideButton = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) =>
	dialogOf(viewer)?.querySelector<HTMLElement>(':scope > aside > micrio-button')

afterEach(() => {
	vi.useRealTimers()
})

describe('popover content pages', () => {
	it('renders a title-only page as an article with a close button', async () => {
		const page = uiPage('about', 'About')
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		expect(dialog?.classList.contains('page')).toBe(true)
		expect(dialog?.classList.contains('article')).toBe(true)
		// A title-only page carries no media, so the dialog is not in media mode
		expect(dialog?.classList.contains('has-media')).toBe(false)
		expect(inDialog(viewer, 'article h2')?.textContent).toBe('About')
		// The default page offers only the popover's close button
		expect(asideButton(viewer)?.classList.contains('close')).toBe(true)
		viewer.destroy()
	})

	it('renders the page HTML content', async () => {
		const page = uiPage('about', 'About', { content: '<p>Hello <em>there</em></p>' })
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		expect(dialog?.querySelector(':scope > article p em')?.textContent).toBe('there')
		viewer.destroy()
	})

	it('treats a short embed page with no content as media-only', async () => {
		const page = uiPage('video', 'Video', { embed: 'https://example.test/embed', content: 'short' })
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		// `isVideoPage`: embed + short content + no image + no buttons
		expect(dialog?.classList.contains('page')).toBe(true)
		expect(dialog?.classList.contains('article')).toBe(false)
		expect(dialog?.classList.contains('has-media')).toBe(true)
		expect(inDialog(viewer, 'micrio-media')).not.toBeNull()
		viewer.destroy()
	})

	it('keeps a long-content embed page as an article with the embed inside', async () => {
		const longContent = `<p>${'A long editorial body. '.repeat(20)}</p>`
		const page = uiPage('story', 'Story', { embed: 'https://example.test/embed', content: longContent })
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		// Over the 250-character threshold the page renders as an article instead
		expect(dialog?.classList.contains('article')).toBe(true)
		expect(dialog?.classList.contains('has-media')).toBe(true)
		expect(dialog?.querySelector(':scope > article > micrio-media')).not.toBeNull()
		viewer.destroy()
	})

	it('renders a page image from an asset and from a plain source', async () => {
		const asset = imageAsset('https://example.test/page.jpg')
		const first = uiPage('asset', 'Asset', { image: asset })
		const opened = await openUi(uiBundle({ pages: [first] }))
		await openPopover(opened.viewer, { contentPage: first })
		expect(dialogOf(opened.viewer)?.querySelector(':scope > article img')?.getAttribute('src')).toBe(asset.src)
		opened.viewer.destroy()

		const second = uiPage('string', 'String image', { image: 'https://example.test/plain.jpg' })
		const other = await openUi(uiBundle({ pages: [second] }))
		await openPopover(other.viewer, { contentPage: second })
		expect(dialogOf(other.viewer)?.querySelector(':scope > article img')?.getAttribute('src')).toBe(
			'https://example.test/plain.jpg',
		)
		other.viewer.destroy()
	})

	it('replaces the content when the state changes while the popover is open', async () => {
		// The layout reuses the connected popover element, so the new state has to reach it
		const about = uiPage('about', 'About', { content: '<p>About</p>' })
		const contact = uiPage('contact', 'Contact', { content: '<p>Contact</p>' })
		const { viewer } = await openUi(uiBundle({ pages: [about, contact] }))

		await openPopover(viewer, { contentPage: about })
		expect(dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent).toBe('About')

		viewer.el.state.popover.set({ contentPage: contact })
		await waitFor(
			() => dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent === 'Contact',
			4000,
			'the second page',
		)
		expect(dialogOf(viewer)?.querySelector(':scope > article p')?.textContent).toBe('Contact')
		viewer.destroy()
	})

	it('re-renders the titles when the language changes', async () => {
		const page = uiPage('about', 'About', { content: '<p>Body</p>' })
		page.i18n = { en: { title: 'About', content: '<p>Body</p>' }, nl: { title: 'Over ons', content: '<p>Body</p>' } }
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		await openPopover(viewer, { contentPage: page })
		expect(dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent).toBe('About')

		viewer.el.lang = 'nl'
		await waitFor(
			() => dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent === 'Over ons',
			4000,
			'the Dutch title',
		)
		viewer.destroy()
	})
})

describe('popover aside and closing', () => {
	it('closes on its own button and clears the popover state', async () => {
		const page = uiPage('about', 'About')
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		await openPopover(viewer, { contentPage: page })

		asideButton(viewer)?.querySelector('button')?.click()
		await waitFor(() => get(viewer.el.state.popover) === undefined, 4000, 'the state to clear')
		// Closing the dialog removes its popover element with it
		await waitFor(() => viewer.el.querySelector('micrio-popover') === null, 4000, 'the popover to go')
		viewer.destroy()
	})

	it('omits the aside entirely when the page carries its own close button', async () => {
		// "Free exploration": the page closes itself, so the popover adds no aside
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [pageButton('close', undefined, { label: 'Free exploration' })],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		expect(dialog?.querySelector(':scope > aside')).toBeNull()
		// The custom button still renders
		expect(dialog?.querySelector(':scope > menu.right micrio-button')?.textContent).toBe('Free exploration')
		viewer.destroy()
	})

	it('keeps the aside for a tour step of a page that closes itself', async () => {
		// Tour navigation is still needed, so the aside survives the page's own close button
		const tour = markerTour(['m1', 'm2'])
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [pageButton('close')],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page], markerTours: [tour] }))
		const dialog = await openPopover(viewer, { contentPage: page, marker: uiMarker('m1'), markerTour: tour })

		expect(dialog?.querySelector(':scope > aside')).not.toBeNull()
		viewer.destroy()
	})

	it('clears the marker state when a marker popover closes', async () => {
		const m = uiMarker('m1', { body: '<p>Marker body</p>', popupType: 'popover' })
		const { viewer } = await openUi(uiBundle({ markers: [m] }))
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 4000, 'the marker layer')

		viewer.el.$current?.state.marker.set('m1')
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'm1', 4000, 'the marker to open')
		await waitFor(() => dialogOf(viewer)?.open === true, 4000, 'the popover dialog')

		// The dialog's own `close` event is what resets the marker and the popover state
		dialogOf(viewer)?.close()
		await waitFor(() => get(viewer.el.state.popover) === undefined, 4000, 'the state to clear')
		await waitFor(() => viewer.el.$current?.state.$marker === undefined, 4000, 'the marker to clear')
		viewer.destroy()
	})

	it('does not close when the dialog backdrop is clicked', async () => {
		const page = uiPage('about', 'About')
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		// There is deliberately no click handler on the dialog (6 parity)
		dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		await settle(3)
		expect(dialog?.open).toBe(true)
		viewer.destroy()
	})

	it('closes the dialog when the viewer is destroyed', async () => {
		const page = uiPage('about', 'About')
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		viewer.destroy()
		expect(dialog?.open).toBe(false)
	})
})

describe('popover tour navigation', () => {
	it('offers next on a step that is not the last, and closes the tour on the last', async () => {
		const tour = markerTour(['m1', 'm2'])
		const { viewer } = await openUi(uiBundle({ markers: [uiMarker('m1'), uiMarker('m2')], markerTours: [tour] }))
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 4000, 'the marker layer')
		const m1 = viewer.el.$current?.$data?.markers?.[0]
		const m2 = viewer.el.$current?.$data?.markers?.[1]
		if (!m1 || !m2) {
			throw new Error('missing markers')
		}

		// Not on the last step: the aside button advances instead of closing
		tour.currentStep = 0
		await openPopover(viewer, { marker: m1, image: viewer.el.$current, markerTour: tour })
		const first = asideButton(viewer)
		expect(first?.classList.contains('next')).toBe(true)
		expect(first?.querySelector('button')?.getAttribute('title')).toBe('Next step')

		const next = vi.fn()
		tour.next = next
		first?.querySelector('button')?.click()
		expect(next).toHaveBeenCalledTimes(1)

		// On the last step the same button closes the tour and the dialog
		tour.currentStep = tour.steps.length - 1
		viewer.el.state.popover.set(undefined)
		await settle(2)
		viewer.el.state.tour.set(tour)
		await openPopover(viewer, { marker: m2, image: viewer.el.$current, markerTour: tour })
		const last = asideButton(viewer)
		expect(last?.classList.contains('close')).toBe(true)
		last?.querySelector('button')?.click()
		await waitFor(() => get(viewer.el.state.tour) === undefined, 4000, 'the tour to stop')
		viewer.destroy()
	})
})

describe('popover custom page buttons', () => {
	it('renders each button with its localised title, right-aligned', async () => {
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [
				pageButton('close', undefined, { label: 'Free exploration' }),
				pageButton('link', 'https://example.test/more', { label: 'More' }),
			],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		const menu = dialog?.querySelector(':scope > menu.right')
		expect(menu).not.toBeNull()
		const labels = Array.from(menu?.querySelectorAll('micrio-button') ?? []).map((b) => b.textContent?.trim())
		expect(labels).toEqual(['Free exploration', 'More'])
		viewer.destroy()
	})

	it('gives a link button an anchor with the target it was configured with', async () => {
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [pageButton('link', 'https://example.test/more', { label: 'More', blankTarget: true })],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		const dialog = await openPopover(viewer, { contentPage: page })

		// `<micrio-button>` renders an <a> for an href, with target for blankTarget
		const anchor = dialog?.querySelector<HTMLAnchorElement>(':scope > menu.right micrio-button a')
		expect(anchor?.getAttribute('href')).toBe('https://example.test/more')
		expect(anchor?.getAttribute('target')).toBe('_blank')
		viewer.destroy()
	})

	it('closes the popover for a close button without running another action', async () => {
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [pageButton('close', undefined, { label: 'Free exploration' })],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		await openPopover(viewer, { contentPage: page })

		dialogOf(viewer)?.querySelector<HTMLButtonElement>(':scope > menu.right micrio-button button')?.click()
		await waitFor(() => viewer.el.querySelector('micrio-popover') === null, 4000, 'the popover to go')
		expect(get(viewer.el.state.popover)).toBeUndefined()
		viewer.destroy()
	})

	it('opens a marker after the close delay', async () => {
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [pageButton('marker', 'mlink', { label: 'Go to marker' })],
		})
		const target = uiMarker('mlink', { body: '<p>Linked</p>' })
		const { viewer } = await openUi(uiBundle({ pages: [page], markers: [target] }))
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 4000, 'the marker layer')
		await openPopover(viewer, { contentPage: page })

		// Scoped to the action menu: the aside's own close button is a `micrio-button` too
		const btn = dialogOf(viewer)?.querySelector<HTMLButtonElement>(':scope > menu.right micrio-button button')
		btn?.click()
		await waitFor(() => viewer.el.querySelector('micrio-popover') === null, 4000, 'the popover to go')
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'mlink', 4000, 'the linked marker')
		viewer.destroy()
	})

	it('starts a marker tour and a video tour from their buttons', async () => {
		const mtour = markerTour(['m1', 'm2'], 'mt1', 'Markers')
		const vtour = videoTourFixture('vt1')
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [
				pageButton('mtour', 'mt1', { label: 'Marker tour' }),
				pageButton('vtour', 'vt1', { label: 'Video tour' }),
			],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page], markerTours: [mtour], tours: [vtour] }))
		await openPopover(viewer, { contentPage: page })

		// Scope to the action menu: the aside's own close button is also a micrio-button
		const buttons = dialogOf(viewer)?.querySelectorAll<HTMLButtonElement>(':scope > menu.right micrio-button button')
		buttons?.[0]?.click()
		await waitFor(() => get(viewer.el.state.tour) === mtour, 4000, 'the marker tour')

		viewer.el.state.tour.set(undefined)
		viewer.el.state.popover.set(undefined)
		await settle(2)
		await openPopover(viewer, { contentPage: page })
		dialogOf(viewer)?.querySelectorAll<HTMLButtonElement>(':scope > menu.right micrio-button button')[1]?.click()
		await waitFor(() => get(viewer.el.state.tour) === vtour, 4000, 'the video tour')
		viewer.destroy()
	})

	it('does nothing for a button whose action is missing', async () => {
		const page = uiPage('about', 'About', {
			content: '<p>Body</p>',
			buttons: [pageButton('mtour', 'nope', { label: 'Missing tour' })],
		})
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		await openPopover(viewer, { contentPage: page })

		dialogOf(viewer)?.querySelector<HTMLButtonElement>('micrio-button button')?.click()
		await settle(6)
		expect(get(viewer.el.state.tour)).toBeUndefined()
		viewer.destroy()
	})
})

describe('popover gallery mode', () => {
	it('renders a swipe gallery for the gallery state', async () => {
		const gallery = [
			imageAsset('https://example.test/a.jpg', { id: 'a' }),
			imageAsset('https://example.test/b.jpg', { id: 'b' }),
		]
		const { viewer } = await openUi(uiBundle())
		const dialog = await openPopover(viewer, { gallery, galleryStart: 'b' })

		expect(dialog?.classList.contains('gallery')).toBe(true)
		expect(inDialog(viewer, 'micrio-swipe-gallery')).not.toBeNull()
		viewer.destroy()
	})

	it('renders nothing for an empty gallery', async () => {
		const { viewer } = await openUi(uiBundle())
		const dialog = await openPopover(viewer, { gallery: [] })

		expect(dialog?.classList.contains('gallery')).toBe(false)
		expect(inDialog(viewer, 'micrio-swipe-gallery')).toBeNull()
		viewer.destroy()
	})

	it('swaps an open page for a gallery, and clears it again', async () => {
		// The marker content opens its images by replacing `state.popover`, so the open
		// page has to give way to the gallery in place
		const page = uiPage('about', 'About', { content: '<p>Body</p>' })
		const gallery = [imageAsset('https://example.test/a.jpg', { id: 'a' })]
		const { viewer } = await openUi(uiBundle({ pages: [page] }))

		await openPopover(viewer, { contentPage: page })
		expect(inDialog(viewer, 'article')).not.toBeNull()

		viewer.el.state.popover.set({ gallery, galleryStart: 'a' })
		await waitFor(() => dialogOf(viewer)?.classList.contains('gallery') === true, 4000, 'the gallery mode')
		const dialog = dialogOf(viewer)
		expect(dialog?.classList.contains('page')).toBe(false)
		expect(inDialog(viewer, 'article')).toBeNull()
		expect(inDialog(viewer, 'micrio-swipe-gallery')).not.toBeNull()

		// An empty gallery takes the mode away again rather than leaving a stale one
		viewer.el.state.popover.set({ gallery: [] })
		await waitFor(() => dialogOf(viewer)?.classList.contains('gallery') === false, 4000, 'the gallery to clear')
		expect(inDialog(viewer, 'micrio-swipe-gallery')).toBeNull()
		viewer.destroy()
	})
})

describe('popover marker mode', () => {
	it('renders a marker body through micrio-marker-content', async () => {
		const m = uiMarker('m1', { body: '<p>Marker body</p>', title: 'Marker one', popupType: 'popover' })
		const { viewer } = await openUi(uiBundle({ markers: [m] }))
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 4000, 'the marker layer')

		await openPopover(viewer, { marker: m, image: viewer.el.$current })
		const content = inDialog(viewer, 'micrio-marker-content')
		expect(content).not.toBeNull()
		expect(content?.querySelector('h1')?.textContent).toBe('Marker one')
		viewer.destroy()
	})

	it('renders a marker embed as media, and its images as a gallery', async () => {
		const embedded = uiMarker('m1', { embedUrl: 'https://example.test/embed', embedAutoPlay: true })
		const withImages = uiMarker('m2', {
			body: '<p>Images</p>',
			images: [imageAsset('https://example.test/a.jpg', { id: 'a' })],
		})
		const { viewer } = await openUi(uiBundle({ markers: [embedded, withImages] }))
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 4000, 'the marker layer')

		await openPopover(viewer, { marker: embedded, image: viewer.el.$current })
		expect(inDialog(viewer, 'micrio-media')).not.toBeNull()

		viewer.el.state.popover.set(undefined)
		await settle(2)
		await openPopover(viewer, { marker: withImages, image: viewer.el.$current })
		expect(inDialog(viewer, 'micrio-swipe-gallery')).not.toBeNull()
		viewer.destroy()
	})

	it('renders an aside even when the marker has no content to show', async () => {
		// A marker without culture data leaves the content element empty; the aside stays
		const bare: Models.ImageData.Marker = { id: 'bare', x: 0.5, y: 0.5, data: {}, popupType: 'popover' }
		const { viewer } = await openUi(uiBundle({ markers: [bare] }))
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 4000, 'the marker layer')

		const dialog = await openPopover(viewer, { marker: bare, image: viewer.el.$current })
		expect(dialog?.querySelector(':scope > aside')).not.toBeNull()
		viewer.destroy()
	})
})

describe('popover as a welcome screen', () => {
	it('opens the page an image starts with', async () => {
		const welcome = uiPage('welcome', 'Welcome', { content: '<p>Hello</p>' })
		const { viewer } = await openUi(
			uiBundle({ pages: [welcome], settings: { start: { type: 'page', id: 'welcome' } } }),
		)

		await waitFor(() => dialogOf(viewer)?.open === true, 6000, 'the welcome popover')
		expect(dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent).toBe('Welcome')
		// The state carries the language-select flag for the welcome layout
		expect(get(viewer.el.state.popover)?.showLangSelect).toBe(true)
		viewer.destroy()
	})

	it('finds a nested start page by id', async () => {
		const nested = uiPage('deep', 'Deep page', { content: '<p>Nested</p>' })
		const parent = uiPage('parent', 'Parent', { children: [nested] })
		const { viewer } = await openUi(uiBundle({ pages: [parent], settings: { start: { type: 'page', id: 'deep' } } }))

		await waitFor(() => dialogOf(viewer)?.open === true, 6000, 'the nested welcome popover')
		expect(dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent).toBe('Deep page')
		viewer.destroy()
	})

	it('does not start when nothing matches, or when something is already open', async () => {
		// A missing page id is a no-op
		const missing = await openUi(
			uiBundle({ pages: [uiPage('about', 'About')], settings: { start: { type: 'page', id: 'nope' } } }),
		)
		await settle(8)
		expect(dialogOf(missing.viewer)).toBeNull()
		missing.viewer.destroy()

		// A popover that is already open wins over the start setting
		const page = uiPage('about', 'About', { content: '<p>Body</p>' })
		const started = await openUi(uiBundle({ pages: [page], settings: { start: { type: 'page', id: 'about' } } }))
		started.viewer.el.state.popover.set({ contentPage: page })
		await settle(8)
		// The start path bails out when something is already open: one state, one element
		expect(get(started.viewer.el.state.popover)?.contentPage?.id).toBe('about')
		expect(started.viewer.el.querySelectorAll('micrio-popover')).toHaveLength(1)
		started.viewer.destroy()
	})
})

describe('popover entered from the toolbar', () => {
	it('opens the page a toolbar entry points at', async () => {
		// The integration path: the toolbar's menu dispatches `page-open` and sets the state
		const page = uiPage('about', 'About', { content: '<p>From the toolbar</p>' })
		const { viewer } = await openUi(uiBundle({ pages: [page] }))
		await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu > micrio-menu') !== null, 4000, 'the toolbar')

		const entry = viewer.el.querySelector<HTMLElement>('micrio-toolbar > menu > micrio-menu > button')
		entry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		await waitFor(() => dialogOf(viewer)?.open === true, 4000, 'the popover dialog')
		expect(dialogOf(viewer)?.querySelector(':scope > article h2')?.textContent).toBe('About')
		viewer.destroy()
	})
})
