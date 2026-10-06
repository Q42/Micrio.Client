import { describe, expect, it } from 'vitest'
import type { Models } from '../../src/types/models'
import { get } from '../../src/core/store'
import { openUi, uiBundle, markerTour, videoTourFixture } from '../fixtures/ui'
import { settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/**
 * `<micrio-toolbar>` decides **what** the top bar offers: the content pages (in page order,
 * with the `_`-prefixed system entries last), the marker and video tours, and nothing at all
 * while a tour, marker or popover is open. The mobile sheet is the separate
 * `toolbar-mobile` suite; every test here runs at the desktop viewport from
 * `vitest.config.ts`.
 *
 * The toolbar renders from the image *data*, which lands a frame after the image itself, so
 * every test waits for the menu nodes rather than only for the element. Both suites share
 * `uiBundle`, whose ids are unique per call because the client's bundle cache is
 * module-level.
 */

/** The toolbar's menu nodes, in render order. */
const menus = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) =>
	Array.from(viewer.el.querySelectorAll<HTMLElement>('micrio-toolbar > menu > micrio-menu'))

/** A menu node's localised title, which the menu also mirrors into `dataset.title`. */
const label = (el: Element) => el.querySelector('strong')?.textContent?.trim() ?? ''

/** The toolbar element itself, or null when it is not mounted. */
const toolbar = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) => viewer.el.querySelector('micrio-toolbar')

/** Waits until the toolbar has rendered its menu nodes. */
async function waitForMenus(viewer: Awaited<ReturnType<typeof openUi>>['viewer'], count = 1) {
	await waitFor(() => menus(viewer).length === count, 4000, `${count} toolbar menus`)
}

/** Every title the toolbar currently offers. */
const titles = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) => menus(viewer).map(label)

/**
 * Clicks a menu node's button, the way a user picks an entry.
 */
async function pick(menuEl: Element) {
	menuEl.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle(2)
}

describe('toolbar page entries', () => {
	it('renders one menu node per content page, in page order', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 2)

		expect(titles(viewer)).toEqual(['About', 'Contact'])
		// The menu mirrors its title into `dataset.title`, lowercased
		expect(menus(viewer)[0]?.dataset.title).toBe('about')
		viewer.destroy()
	})

	it('keeps the `_`-prefixed system entries, after the normal pages', async () => {
		const ui = uiBundle({ withSystemEntry: true })
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 3)

		// The underscore marks a system entry; the toolbar must not filter it out, and it
		// is re-appended after the pages the editor ordered
		expect(titles(viewer)).toEqual(['About', 'Contact', 'System'])
		viewer.destroy()
	})

	it('drops entries with no culture data for the active language', async () => {
		const ui = uiBundle()
		// The second page is localised in `de` only, so it is invisible to `en`
		const contact = ui.pages[1]
		if (!contact) {
			throw new Error('missing Contact page')
		}
		contact.i18n = { de: { title: 'Kontakt' } }

		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 1)
		expect(titles(viewer)).toEqual(['About'])
		viewer.destroy()
	})

	it('re-renders the entries in the language the element switches to', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 2)
		expect(titles(viewer)).toEqual(['About', 'Contact'])

		viewer.el.lang = 'nl'
		await waitFor(() => titles(viewer)[0] === 'Over ons', 4000, 'the Dutch entries')
		expect(titles(viewer)).toEqual(['Over ons', 'Contact'])
		viewer.destroy()
	})

	it('renders no menu when there are neither pages nor tours', async () => {
		const ui = uiBundle()
		ui.bundle.data = { i18n: ui.bundle.data?.i18n, markers: ui.bundle.data?.markers }
		const { viewer } = await openUi(ui)
		await settle(4)

		expect(toolbar(viewer)).not.toBeNull()
		expect(viewer.el.querySelector('micrio-toolbar > menu')).toBeNull()
		viewer.destroy()
	})

	it('renders no toolbar at all when the image disables it', async () => {
		const ui = uiBundle({ settings: { noToolbar: true } })
		const { viewer } = await openUi(ui)
		await settle(4)

		expect(toolbar(viewer)).toBeNull()
		viewer.destroy()
	})
})

describe('toolbar tour entries', () => {
	it('titles the tour menu generically when only one kind exists', async () => {
		const ui = uiBundle({ markerTours: [markerTour(['m1', 'm2'])] })
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 3)

		expect(titles(viewer)).toEqual(['About', 'Contact', 'Tours'])
		viewer.destroy()
	})

	it('offers a marker and a video tours menu when both exist', async () => {
		const ui = uiBundle({
			markerTours: [markerTour(['m1', 'm2'])],
			tours: [videoTourFixture('vt1')],
		})
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 4)

		expect(titles(viewer)).toEqual(['About', 'Contact', 'Marker tours', 'Video tours'])
		viewer.destroy()
	})

	it('lists each tour by its localised title and starts it when picked', async () => {
		const ui = uiBundle({ markerTours: [markerTour(['m1', 'm2'], 'mt1', 'Markers')] })
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 3)

		const tourMenu = menus(viewer)[2]
		await pick(tourMenu?.querySelector('button') ?? viewer.el)
		// The tour menu is a branch: its entries live one level down
		const entries = Array.from(tourMenu?.querySelectorAll('micrio-menu > button') ?? [])
		expect(entries.map((b) => b.querySelector('strong')?.textContent?.trim())).toContain('Markers')

		const entry = entries.find((b) => b.querySelector('strong')?.textContent?.trim() === 'Markers')
		await pick(entry?.closest('micrio-menu') ?? viewer.el)
		await waitFor(() => get(viewer.el.state.tour) !== undefined, 4000, 'the tour to start')
		// Starting a tour always restarts it at the first step
		const started = get(viewer.el.state.tour)
		expect(started && 'initialStep' in started ? started.initialStep : undefined).toBe(0)
		viewer.destroy()
	})
})

describe('toolbar visibility while something is open', () => {
	it('empties itself while a tour, marker or popover is open, and comes back', async () => {
		const tour = markerTour(['m1', 'm2'])
		const ui = uiBundle({ markerTours: [tour] })
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 3)

		// A tour hides the bar
		viewer.el.state.tour.set(tour)
		await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') === null, 4000, 'the toolbar to hide')
		viewer.el.state.tour.set(undefined)
		await settle(4)
		await waitForMenus(viewer, 3)

		// So does an open marker
		viewer.el.$current?.state.marker.set('m1')
		await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') === null, 4000, 'the toolbar to hide')
		viewer.el.$current?.state.marker.set(undefined)
		await waitForMenus(viewer, 3)

		// And an open popover
		viewer.el.state.popover.set({ contentPage: ui.pages[0] as Models.ImageData.Menu })
		await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') === null, 4000, 'the toolbar to hide')
		viewer.el.state.popover.set(undefined)
		await waitForMenus(viewer, 3)
		viewer.destroy()
	})

	it('never stays hidden once the popover is gone', async () => {
		// The render key includes the hidden state, so a stale key would leave the bar
		// empty forever
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 2)

		viewer.el.state.popover.set({ contentPage: ui.pages[0] as Models.ImageData.Menu })
		await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') === null, 4000, 'the toolbar to hide')
		viewer.el.state.popover.set(undefined)
		await waitFor(() => menus(viewer).length === 2, 4000, 'the toolbar to return')
		expect(titles(viewer)).toEqual(['About', 'Contact'])
		viewer.destroy()
	})
})

describe('toolbar indent', () => {
	it('indents the menu for the logo, and not when there is no logo', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		await waitForMenus(viewer, 2)

		// A logo shifts the menu right, so the class is on by default
		expect(viewer.el.querySelector('micrio-toolbar > menu')?.classList.contains('indent')).toBe(true)
		viewer.destroy()

		// `noLogo` in the image settings means the menu starts at the edge
		const noLogoUi = uiBundle({ settings: { noLogo: true } })
		const second = await openUi(noLogoUi)
		await waitForMenus(second.viewer, 2)
		expect(second.viewer.el.querySelector('micrio-toolbar > menu')?.classList.contains('indent')).toBe(false)
		second.viewer.destroy()
	})
})
