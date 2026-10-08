import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { uiBundle } from '../../fixtures/ui'
import { waitFor } from '../../helpers/viewer'
import {
	box,
	expectFillsViewport,
	hitsAt,
	intersectsViewport,
	mountUi,
	rendered,
	style,
	toolbarMenu,
	waitForStyle,
	waitForTransform,
} from './helpers'
import { MOBILE, useViewport } from './setup'

/**
 * The toolbar's responsive layout: `src/layout/toolbar.css`, `src/layout/menu.css` and
 * `src/ui/button-group.css` at the 500/501 breakpoint.
 *
 * `toolbar-mobile.test.ts` already pins what the toolbar *offers* when the component
 * measures a narrow `window.innerWidth`; this file pins where those nodes end up and what
 * the user can actually touch. The distinction matters: the state test stubs `innerWidth`
 * and says so in its own header, keeping "the CSS-only parts of the layout (the bottom
 * sheet) out of scope" — the sheet's position, its backdrop and its slide-in transform are
 * exactly what is asserted here, on a real 400px viewport.
 *
 * `micrio-toolbar` reads `window.innerWidth` on mount and on `window` resize, so the
 * viewport has to be the real one (`setup.ts`), not a stub; the resize listener is why
 * `useViewport` waits for the frame after `page.viewport`.
 */

/** The mobile toggle, the toolbar's only `micrio-button`. */
const toggle = (viewer: Awaited<ReturnType<typeof mountUi>>) =>
	viewer.el.querySelector<HTMLElement>('micrio-toolbar > micrio-button')

/** The sheet's backdrop, which exists only while the mobile sheet is open. */
const backdrop = (viewer: Awaited<ReturnType<typeof mountUi>>) =>
	viewer.el.querySelector<HTMLElement>('micrio-toolbar > div.backdrop')

/** Opens a mobile viewer with the toolbar rendered. */
async function openMobile() {
	await useViewport(MOBILE)
	const viewer = await mountUi(uiBundle())
	await waitFor(() => toolbarMenu(viewer) !== null, 4000, 'the toolbar menu')
	expectFillsViewport(viewer.el)
	return viewer
}

/** Clicks the toggle and waits out the 0.3s sheet transform. */
async function openSheet(viewer: Awaited<ReturnType<typeof mountUi>>) {
	toggle(viewer)?.querySelector('button')?.click()
	await waitFor(() => toolbarMenu(viewer)?.classList.contains('shown') === true, 4000, 'the sheet to open')
	await waitForTransform(toolbarMenu(viewer) as HTMLElement)
}

describe('toolbar on the desktop viewport', () => {
	it('keeps the menu on the bar, without the mobile toggle or backdrop', async () => {
		const viewer = await mountUi(uiBundle())
		await waitFor(() => toolbarMenu(viewer) !== null, 4000, 'the toolbar menu')

		const menu = toolbarMenu(viewer) as HTMLElement
		expect(style(menu, 'position')).toBe('absolute')
		expect(toggle(viewer)).toBeNull()
		expect(backdrop(viewer)).toBeNull()

		// The bar sits at the top-left border margin, inside the viewport — the rule the
		// mobile branch below moves to the bottom edge.
		expect(intersectsViewport(menu)).toBe(true)
		expect(box(menu).top).toBeLessThan(window.innerHeight / 2)
		viewer.destroy()
	})

	it('raises a menu entry to the panel treatment on hover', async () => {
		const viewer = await mountUi(uiBundle())
		await waitFor(() => toolbarMenu(viewer) !== null, 4000, 'the toolbar menu')
		const entry = toolbarMenu(viewer)?.querySelector<HTMLElement>(':scope > micrio-menu') as HTMLElement

		// menu.css `min-width: 501px`: `micrio-menu:is(:hover, :focus-within)` gets the glass
		// background and the button shadow, and each entry carries the border radius. This is
		// the one place a real `:hover` can be driven (Playwright's own hover, through the
		// provider), so it is also the suite's check that hover is reachable at all.
		expect(style(entry, 'background-color')).toBe('rgba(0, 0, 0, 0)')
		expect(style(entry, 'border-radius')).toBe('4px')

		await page.elementLocator(entry).hover()
		await waitForStyle(entry, 'background-color', 'rgba(41, 41, 41, 0.75)')
		expect(style(entry, 'box-shadow')).not.toBe('none')
		viewer.destroy()
	})
})

describe('the mobile sheet', () => {
	it('puts the menu below the viewport until it opens', async () => {
		const viewer = await openMobile()
		const menu = toolbarMenu(viewer) as HTMLElement

		expect(toggle(viewer)).not.toBeNull()
		expect(backdrop(viewer)).toBeNull()
		// toolbar.css: fixed, full width, anchored to the bottom, translated 100% down.
		expect(style(menu, 'position')).toBe('fixed')
		expect(Math.round(box(menu).width)).toBe(window.innerWidth)
		expect(rendered(menu)).toBe(true)
		expect(intersectsViewport(menu)).toBe(false)
		expect(box(menu).top).toBeGreaterThanOrEqual(window.innerHeight)
		viewer.destroy()
	})

	it('slides the sheet in above a backdrop that swallows a tap', async () => {
		const viewer = await openMobile()
		await openSheet(viewer)

		const menu = toolbarMenu(viewer) as HTMLElement
		const shade = backdrop(viewer) as HTMLElement
		expect(shade).not.toBeNull()

		// The sheet is on screen now, and the backdrop covers the whole viewport below it.
		expect(intersectsViewport(menu)).toBe(true)
		expect(box(menu).bottom).toBeLessThanOrEqual(window.innerHeight + 1)
		const shadeBox = box(shade)
		expect(style(shade, 'position')).toBe('fixed')
		expect(Math.round(shadeBox.width)).toBe(window.innerWidth)
		expect(Math.round(shadeBox.height)).toBe(window.innerHeight)

		// z-index 50 above the canvas, below the sheet's 100: the canvas is no longer the
		// element a tap at the toolbar's own position reaches.
		const tapY = Math.round(shadeBox.height / 2)
		expect(viewer.el.querySelector('canvas.micrio')?.contains(document.elementFromPoint(4, tapY))).toBe(false)
		expect(hitsAt(shade, { x: 4 - box(shade).left, y: 0 })).toBe(true)
		viewer.destroy()
	})

	it('closes the sheet when its backdrop is clicked', async () => {
		const viewer = await openMobile()
		await openSheet(viewer)

		backdrop(viewer)?.click()
		await waitFor(() => toolbarMenu(viewer)?.classList.contains('shown') !== true, 4000, 'the sheet to close')
		// The sheet slides back out over 0.3s; the assertion is about where it ends up.
		await waitFor(
			() => !intersectsViewport(toolbarMenu(viewer) as HTMLElement),
			4000,
			'the sheet to leave the viewport',
		)
		expect(backdrop(viewer)).toBeNull()
		viewer.destroy()
	})

	it('closes the sheet when an entry acts', async () => {
		const viewer = await openMobile()
		await openSheet(viewer)

		toolbarMenu(viewer)?.querySelector<HTMLButtonElement>('micrio-menu button')?.click()
		// The entry's own action runs too (this one opens a content page), which takes the
		// whole toolbar out of the layout; either way the sheet is gone and no menu is left
		// inside the viewport.
		await waitFor(
			() => {
				const menu = toolbarMenu(viewer)
				return backdrop(viewer) === null && (menu === null || !intersectsViewport(menu))
			},
			6000,
			'the sheet to close behind the action',
		)
		expect(backdrop(viewer)).toBeNull()
		viewer.destroy()
	})
})

describe('the 500px breakpoint', () => {
	it('uses the sheet at 500 and the bar at 501', async () => {
		await useViewport({ width: 500, height: 800 })
		const at500 = await mountUi(uiBundle())
		await waitFor(() => toolbarMenu(at500) !== null, 4000, 'the menu at 500')
		expect(toggle(at500)).not.toBeNull()
		expect(style(toolbarMenu(at500) as HTMLElement, 'position')).toBe('fixed')
		at500.destroy()

		await useViewport({ width: 501, height: 800 })
		const at501 = await mountUi(uiBundle())
		await waitFor(() => toolbarMenu(at501) !== null, 4000, 'the menu at 501')
		expect(toggle(at501)).toBeNull()
		expect(style(toolbarMenu(at501) as HTMLElement, 'position')).toBe('absolute')
		at501.destroy()
	})
})
