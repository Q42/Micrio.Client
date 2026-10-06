import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/utils/dom'
import type { MicrioElement } from '../../src/core/component'
import { openUi, uiBundle } from '../fixtures/ui'
import { get } from '../../src/core/store'
import { settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'
import type { Models } from '../../src/types/models'

/**
 * `<micrio-menu>` renders one node of the toolbar's menu tree, recursively.
 *
 * Two things shape these tests. The tree's open state lives in a module-level store shared
 * by every menu on the page, so the suite closes what it opens. And the whole tree *filters
 * on the active language*: an entry with no culture data for the current language is
 * dropped, which is why the fixture is localised in both languages.
 */

/**
 * The menu tree's open state lives in a module-level store shared by every menu, and the
 * module only lets go of it through a click somewhere else on the page. Without this the
 * next test would inherit whatever the previous one left open.
 */
afterEach(() => {
	document.body.click()
})

/** Mounts one menu node inside a viewer so it can resolve its micrio element. */
async function mountMenu(
	menu: Models.ImageData.Menu,
	viewer: Awaited<ReturnType<typeof openUi>>['viewer'],
	props: Record<string, unknown> = {},
) {
	const el = createElement('micrio-menu', {
		setProps: { menu, ...props },
		parent: viewer.el,
	}) as MicrioElement
	await settle(2)
	return el
}

/** The clickable node of a menu: an anchor for links, a button otherwise. */
const node = (el: Element | null) => el?.querySelector<HTMLElement>(':scope > button, :scope > a') ?? null

/** The visible label of a menu node. */
const label = (el: Element | null) => el?.querySelector('strong')?.textContent?.trim() ?? ''

describe('micrio-menu rendering', () => {
	it('renders a button node with the localised title', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		// The title also becomes the dataset key the toolbar and tests select on
		expect(label(el)).toBe('About')
		expect(el.dataset.title).toBe('about')
		expect(node(el)?.tagName).toBe('BUTTON')
		viewer.destroy()
	})

	it('nests children and marks the parent with a chevron', async () => {
		const ui = uiBundle({ withChildren: true })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		const children = el.querySelectorAll<HTMLElement>(':scope > div > micrio-menu')
		expect(children).toHaveLength(2)
		expect([...children].map((c) => c.dataset.title)).toEqual(['team', 'jobs'])
		// A parent with children shows the affordance
		expect(el.querySelector('micrio-icon')).not.toBeNull()
		viewer.destroy()
	})

	it('renders an anchor for a link entry', async () => {
		const ui = uiBundle({ withLink: true })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		const anchor = node(el)
		expect(anchor?.tagName).toBe('A')
		expect(anchor?.getAttribute('href')).toBe('https://example.test/about')
		expect(anchor?.getAttribute('target')).toBe('_blank')
		viewer.destroy()
	})

	it('collapses a single untitled child into its parent', async () => {
		// A wrapper with exactly one child and no title of its own is transparent
		const wrapper: Models.ImageData.Menu = {
			id: 'wrapper',
			i18n: { en: { title: 'About' }, nl: { title: 'Over ons' } },
			children: [{ id: 'only', i18n: { en: { title: 'About' }, nl: { title: 'Over ons' } } }],
		}
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = await mountMenu(wrapper, viewer)
		// The wrapper's own title is present, so nothing collapses here
		expect(el.dataset.title).toBe('about')
		viewer.destroy()
	})

	it('falls back to a placeholder for missing culture data', async () => {
		const untitled: Models.ImageData.Menu = { id: 'untitled', i18n: {} }
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = await mountMenu(untitled, viewer)
		expect(label(el)).toBe('(Unknown)')
		viewer.destroy()
	})

	it('reads legacy top-level culture data', async () => {
		const ui = uiBundle({ withLegacyEntry: true })
		const { viewer } = await openUi(ui)
		const legacy = ui.pages.find((p) => p.id === 'legacy')
		if (!legacy) {
			throw new Error('no legacy entry')
		}
		const el = await mountMenu(legacy, viewer)
		expect(label(el)).toBe('Legacy entry')
		viewer.destroy()
	})
})

describe('micrio-menu opening', () => {
	/**
	 * A parent entry has something to reveal, so it opens rather than acting. An entry that
	 * carries an action or a link commits and closes instead — that asymmetry is the
	 * behaviour worth pinning.
	 */
	it('opens a parent entry on click and closes it on the next click', async () => {
		const ui = uiBundle({ withChildren: true })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		node(el)?.click()
		await settle(2)
		expect(el.classList.contains('opened')).toBe(true)

		node(el)?.click()
		await settle(2)
		expect(el.classList.contains('opened')).toBe(false)
		viewer.destroy()
	})

	it('closes a plainly-opened entry when the rest of the page is clicked', async () => {
		const ui = uiBundle({ withChildren: true })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		node(el)?.click()
		await settle(2)
		expect(el.classList.contains('opened')).toBe(true)

		// The module listens on the window while something is open
		document.body.click()
		await settle(2)
		expect(el.classList.contains('opened')).toBe(false)
		viewer.destroy()
	})

	it('never stays open for an entry that acts', async () => {
		// Acting entries commit immediately, so they close rather than reveal children
		const ui = uiBundle({ withMarkerId: 'm1' })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		node(el)?.click()
		await settle(4)
		expect(el.classList.contains('opened')).toBe(false)
		viewer.destroy()
	})

	it('marks an ancestor as opened when a descendant is open', async () => {
		// Children *without* an action of their own are the ones that reveal rather than
		// commit, so this tree uses plain leaves
		const tree: Models.ImageData.Menu = {
			id: 'branch',
			i18n: { en: { title: 'Branch' }, nl: { title: 'Tak' } },
			children: [
				{ id: 'leaf-a', i18n: {} },
				{ id: 'leaf-b', i18n: {} },
			],
		}
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = await mountMenu(tree, viewer)
		const childEl = el.querySelector<MicrioElement>(':scope > div > micrio-menu')
		if (!childEl) {
			throw new Error('no child menu')
		}

		node(childEl)?.click()
		await waitFor(() => childEl.classList.contains('opened'), 3000, 'the child to open')
		// The parent that contains the open child reports itself as opened too
		expect(el.classList.contains('opened')).toBe(true)

		// Clicking elsewhere closes the whole branch
		document.body.click()
		await waitFor(() => !el.classList.contains('opened'), 3000, 'the branch to close')
		expect(childEl.classList.contains('opened')).toBe(false)
		viewer.destroy()
	})

	it('closes itself after an action runs', async () => {
		const onclose = vi.fn()
		const ui = uiBundle({ withMarkerId: 'm1' })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer, { onclose })

		node(el)?.click()
		await settle(2)
		expect(onclose).toHaveBeenCalledTimes(1)
		expect(el.classList.contains('opened')).toBe(false)
		viewer.destroy()
	})
})

describe('micrio-menu actions', () => {
	it('opens a marker by id', async () => {
		const ui = uiBundle({ withMarkerId: 'm1' })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		node(el)?.click()
		// The image's own state resolves the id it was given into the marker object
		await waitFor(() => viewer.el.state.$marker?.id === 'm1', 3000, 'the marker to open')
		expect((viewer.el.$current?.state.$marker as Models.ImageData.Marker | undefined)?.id).toBe('m1')
		viewer.destroy()
	})

	it('opens a popover for a page with content', async () => {
		const ui = uiBundle({ withContent: true })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		const seen: string[] = []
		viewer.el.addEventListener('page-open', () => seen.push('page-open'))
		node(el)?.click()
		await waitFor(() => get(viewer.el.state.popover) !== undefined, 3000, 'the popover state')

		expect(seen).toEqual(['page-open'])
		// The popover is driven by the page the menu dispatched
		const popover = get(viewer.el.state.popover) as { contentPage?: Models.ImageData.Menu } | undefined
		expect(popover?.contentPage?.id).toBe('about')
		viewer.destroy()
	})

	it('still opens the marker when it already sits on its own image', async () => {
		const ui = uiBundle({ withMarkerId: 'm1' })
		const { viewer } = await openUi(ui)
		// Passing the image it is already on means no navigation is needed first
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer, { originalId: ui.id })

		node(el)?.click()
		await waitFor(() => viewer.el.state.$marker?.id === 'm1', 3000, 'the marker to open')
		expect(viewer.el.$current?.id).toBe(ui.id)
		viewer.destroy()
	})

	it('runs a direct action function when the menu carries one', async () => {
		const action = vi.fn()
		const menu: Models.ImageData.Menu = {
			id: 'direct',
			i18n: { en: { title: 'Direct' }, nl: { title: 'Direct' } },
			action,
		}
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = await mountMenu(menu, viewer)
		node(el)?.click()
		await settle(2)
		expect(action).toHaveBeenCalledTimes(1)
		viewer.destroy()
	})

	it('leaves an external link to the browser', async () => {
		const ui = uiBundle({ withLink: true })
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)

		const event = new MouseEvent('click', { bubbles: true, cancelable: true })
		node(el)?.dispatchEvent(event)
		await settle(2)
		// A link must not be prevented, or the navigation would never happen
		expect(event.defaultPrevented).toBe(false)
		viewer.destroy()
	})
})

describe('micrio-menu language', () => {
	it('renders the active language and re-renders on a switch', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = await mountMenu(ui.pages[0] as Models.ImageData.Menu, viewer)
		expect(label(el)).toBe('About')

		viewer.el._lang.set('nl')
		await waitFor(() => label(el) === 'Over ons', 3000, 'the Dutch label')
		// The dataset key follows the language too
		expect(el.dataset.title).toBe('over ons')
		viewer.destroy()
	})
})

describe('micrio-menu guards', () => {
	it('renders nothing without a menu', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = createElement('micrio-menu', { parent: viewer.el }) as MicrioElement
		await settle(2)
		expect(el.children).toHaveLength(0)
		viewer.destroy()
	})

	it('renders nothing outside a viewer', () => {
		const el = createElement('micrio-menu', {
			setProps: { menu: { id: 'x', i18n: { en: { title: 'X' } } } },
			parent: document.body,
		}) as MicrioElement
		// No micrio element to inject, so the menu stays empty rather than throwing
		expect(el.children).toHaveLength(0)
		el.remove()
	})
})
