import { afterEach, describe, expect, it } from 'vitest'
import { openUi, uiBundle } from '../fixtures/ui'
import { settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/**
 * The toolbar's mobile layout. The component measures `window.innerWidth <= 500` on mount
 * and on every resize, so the suite pins that width and dispatches a `resize` — the real
 * iframe stays at the project's 1024x768, which keeps the CSS-only parts of the layout
 * (the bottom sheet) out of scope and the assertions on the component's own state.
 *
 * Every test sets the narrow width; the suite removes the stub afterwards.
 *
 * What differs from desktop: a toggle button replaces the always-open menu, the tree is a
 * bottom sheet that slides in (`menu.shown`) behind a backdrop, and any entry that acts
 * closes the sheet again.
 */
const DESKTOP = { width: 1024, height: 768 }
const MOBILE = { width: 400, height: 800 }

const setWidth = (width: number) => {
	Object.defineProperty(globalThis, 'innerWidth', { value: width, configurable: true })
	globalThis.dispatchEvent(new Event('resize'))
}

afterEach(() => {
	delete (globalThis as unknown as { innerWidth?: number }).innerWidth
})

/** Mounts a UI viewer at the mobile viewport, with the toolbar rendered. */
async function openMobile(ui: ReturnType<typeof uiBundle>) {
	setWidth(MOBILE.width)
	const opened = await openUi(ui)
	await waitFor(() => opened.viewer.el.querySelector('micrio-toolbar > menu') !== null, 4000, 'the toolbar menu')
	return opened
}

const sheet = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) => viewer.el.querySelector('micrio-toolbar > menu')

/** The mobile toggle, which is the toolbar's only `micrio-button`. */
const toggle = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) =>
	viewer.el.querySelector<HTMLElement>('micrio-toolbar > micrio-button')

const backdrop = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) =>
	viewer.el.querySelector('micrio-toolbar > div.backdrop')

const titles = (viewer: Awaited<ReturnType<typeof openUi>>['viewer']) =>
	Array.from(viewer.el.querySelectorAll('micrio-toolbar > menu > micrio-menu')).map(
		(m) => m.querySelector('strong')?.textContent?.trim() ?? '',
	)

/** Clicks the toggle and waits for the sheet to settle. */
async function tapToggle(viewer: Awaited<ReturnType<typeof openUi>>['viewer']) {
	toggle(viewer)?.querySelector('button')?.click()
	await settle(2)
}

describe('mobile toolbar sheet', () => {
	it('starts collapsed, with no backdrop', async () => {
		const { viewer } = await openMobile(uiBundle())

		expect(sheet(viewer)).not.toBeNull()
		expect(sheet(viewer)?.classList.contains('shown')).toBe(false)
		expect(backdrop(viewer)).toBeNull()
		// The toggle offers to open the menu
		expect(toggle(viewer)?.querySelector('button')?.getAttribute('title')).toBe('Toggle menu')
		expect(toggle(viewer)?.classList.contains('ellipsisVertical')).toBe(true)
		viewer.destroy()
	})

	it('opens the sheet with a backdrop, and closes it again', async () => {
		const { viewer } = await openMobile(uiBundle())

		await tapToggle(viewer)
		expect(sheet(viewer)?.classList.contains('shown')).toBe(true)
		expect(backdrop(viewer)).not.toBeNull()
		// The same button now closes the sheet
		expect(toggle(viewer)?.classList.contains('close')).toBe(true)

		await tapToggle(viewer)
		expect(sheet(viewer)?.classList.contains('shown')).toBe(false)
		expect(backdrop(viewer)).toBeNull()
		viewer.destroy()
	})

	it('closes the sheet when the backdrop is clicked', async () => {
		const { viewer } = await openMobile(uiBundle())

		await tapToggle(viewer)
		await waitFor(() => backdrop(viewer) !== null, 4000, 'the backdrop')
		backdrop(viewer)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		await waitFor(() => sheet(viewer)?.classList.contains('shown') === false, 4000, 'the sheet to close')
		expect(backdrop(viewer)).toBeNull()
		viewer.destroy()
	})

	it('closes the sheet when an entry that acts is picked', async () => {
		// An entry with a marker id acts on click, which is what closes the sheet
		const { viewer } = await openMobile(uiBundle({ withMarkerId: 'm1' }))

		await tapToggle(viewer)
		await waitFor(() => sheet(viewer)?.classList.contains('shown') === true, 4000, 'the sheet to open')

		const about = sheet(viewer)?.querySelector('micrio-menu > button')
		about?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		await waitFor(() => sheet(viewer)?.classList.contains('shown') === false, 4000, 'the sheet to close')
		expect(backdrop(viewer)).toBeNull()
		viewer.destroy()
	})

	it('offers the same entries as desktop', async () => {
		const { viewer } = await openMobile(uiBundle({ withSystemEntry: true }))
		expect(titles(viewer)).toEqual(['About', 'Contact', 'System'])
		viewer.destroy()
	})
})

describe('mobile toolbar indent and resizing', () => {
	it('indents the toggle for the logo, and not when there is no logo', async () => {
		// The indent is what keeps the toggle clear of the logo it sits next to
		// `<micrio-button>`'s `className` lands on the inner <button>, which is what the
		// toolbar CSS positions beside the logo
		const first = await openMobile(uiBundle())
		expect(toggle(first.viewer)?.querySelector('button')?.classList.contains('indent')).toBe(true)
		first.viewer.destroy()

		const second = await openMobile(uiBundle({ settings: { noLogo: true } }))
		expect(toggle(second.viewer)?.querySelector('button')?.classList.contains('indent')).toBe(false)
		second.viewer.destroy()
	})

	it('grows into the desktop layout when the viewport widens', async () => {
		const { viewer } = await openMobile(uiBundle())
		await tapToggle(viewer)
		expect(backdrop(viewer)).not.toBeNull()

		setWidth(DESKTOP.width)

		// Desktop has no toggle and no sheet, and widening also drops the mobile state
		await waitFor(() => toggle(viewer) === null, 4000, 'the toggle to go')
		expect(backdrop(viewer)).toBeNull()
		expect(sheet(viewer)?.classList.contains('shown')).toBe(false)
		viewer.destroy()
	})

	it('switches the entries to the new language while the sheet is open', async () => {
		const { viewer } = await openMobile(uiBundle())
		await tapToggle(viewer)
		expect(titles(viewer)[0]).toBe('About')

		viewer.el.lang = 'nl'
		await waitFor(() => titles(viewer)[0] === 'Over ons', 4000, 'the Dutch entries')
		// The sheet stays open across the language change
		expect(sheet(viewer)?.classList.contains('shown')).toBe(true)
		viewer.destroy()
	})
})
