/**
 * Assertion vocabulary for the stylesheet suite.
 *
 * Every layout claim here is one of four questions, asked in a way that survives a
 * refactor of the rule:
 *
 * - **visibility** — {@link rendered}: is the element in flow at all (as opposed to
 *   `display: none`, which is what a lost `display: contents` or a `:empty` rule decides);
 * - **placement** — {@link box} / {@link intersectsViewport}: where does it end up, in
 *   viewport coordinates;
 * - **layering** — {@link topAt} / {@link hitsAt}: which element actually receives a click
 *   at a point, which is the only honest test of `z-index` and `pointer-events` together;
 * - **interactivity** — the same hit test after a real `locator.hover()`, plus
 *   {@link style} for the state the hit test cannot see (`cursor`, custom properties).
 *
 * Numbers are compared, never strings: the CSSOM reserializes what the stylesheet wrote
 * (`translateY(0)` becomes a matrix, `rgba(...)` gets spaces), and a test that compares
 * those strings breaks on a formatting change rather than a layout change.
 */
import { expect } from 'vitest'
import type { Viewer } from '../../helpers/viewer'
import { openUi, type UiBundle } from '../../fixtures/ui'
import { settle } from '../../helpers/tour'
import { currentViewport } from './setup'

/** The computed value of a property, as the browser resolved it (custom properties included). */
export const style = (el: Element, property: string): string => getComputedStyle(el).getPropertyValue(property).trim()

/** A numeric computed property, with the unit dropped. */
export const styleNumber = (el: Element, property: string): number => Number.parseFloat(style(el, property))

/** The element's border box in viewport coordinates. */
export const box = (el: Element): DOMRect => el.getBoundingClientRect()

/** Whether the element generates a box at all: not `display: none`, and with a measurable one. */
export const rendered = (el: Element | null | undefined): boolean => {
	if (!el) {
		return false
	}
	const rect = el.getBoundingClientRect()
	return style(el, 'display') !== 'none' && rect.width > 0 && rect.height > 0
}

/**
 * Whether any part of the element is inside the viewport.
 *
 * This is how "the mobile sheet sits below the fold until it opens" is asserted: the
 * element is `rendered`, but its top is at or under the viewport height.
 */
export const intersectsViewport = (el: Element): boolean => {
	const rect = box(el)
	return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
}

/** The element in the topmost paint layer at a viewport point, or `null` when nothing is there. */
export const topAt = (x: number, y: number): Element | null => document.elementFromPoint(x, y)

/** Whether the element (or one of its descendants) is what receives a click at its own centre. */
export const hitsAt = (el: Element, offset = { x: 0, y: 0 }): boolean => {
	const rect = box(el)
	const hit = topAt(rect.left + rect.width / 2 + offset.x, rect.top + rect.height / 2 + offset.y)
	return hit !== null && (hit === el || el.contains(hit))
}

/**
 * Mounts a UI viewer that fills the whole iframe.
 *
 * `mountViewer`'s default 800×600 box is wrong for these suites twice over: a responsive
 * rule is about the *page* width, and `micr-io` is `container-type: size`, so an 800px
 * element inside a 400px viewport reports 800px to any container query. A full-viewport
 * mount is also what a real embed does. {@link expectFillsViewport} guards it.
 */
export async function mountUi(bundle: UiBundle, attrs?: Record<string, string>): Promise<Viewer> {
	const { viewer } = await openUi(bundle, {
		attrs,
		style: 'width: 100vw; height: 100vh; display: block;',
	})
	return viewer
}

/** Pins that the mounted element actually got the viewport box, before any rule is asserted. */
export function expectFillsViewport(el: HTMLElement): void {
	const { width } = currentViewport()
	expect(Math.round(box(el).width)).toBe(window.innerWidth)
	expect(window.innerWidth).toBe(width)
}

/** Clicks an element through the real event path and lets the layout settle. */
export async function click(el: Element): Promise<void> {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle(2)
}

/** The current image's toolbar, which the `openUi` fixture always renders. */
export const toolbar = (viewer: Viewer): HTMLElement | null => viewer.el.querySelector<HTMLElement>('micrio-toolbar')

/** The toolbar's one menu node, in the mobile sheet or on the desktop bar. */
export const toolbarMenu = (viewer: Viewer): HTMLElement | null =>
	viewer.el.querySelector<HTMLElement>('micrio-toolbar > menu')

/** A content page's popover dialog, when the popover is open. */
export const popoverDialog = (viewer: Viewer): HTMLDialogElement | null =>
	viewer.el.querySelector<HTMLDialogElement>('micrio-popover dialog')
