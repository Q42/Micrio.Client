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
import { sleep } from '../../helpers/async'
import type { Viewer } from '../../helpers/viewer'
import { openUi, type UiBundle } from '../../fixtures/ui'
import { settle } from '../../helpers/tour'
import { currentViewport } from './setup'

/**
 * Polls `read` on a timer until it returns something truthy.
 *
 * The polling is on `setTimeout`, not animation frames: Chromium throttles `rAF` hard in
 * this headless iframe under load (a 0.25s fade took far longer in frames than in time), so
 * a frame-based wait makes every transition test slow and flaky. A timer wakes even when
 * frames do not, and the caller's own timeout bounds the wait.
 */
function poll<T>(read: () => T | undefined, timeout: number): Promise<T | undefined> {
	const start = performance.now()
	const next = async (): Promise<T | undefined> => {
		const value = read()
		if (value !== undefined && value !== false && value !== 0) {
			return value
		}
		if (performance.now() - start > timeout) {
			return value
		}
		await sleep(16)
		return next()
	}
	return next()
}

/** The computed value of a property, as the browser resolved it (custom properties included). */
export const style = (el: Element, property: string): string => getComputedStyle(el).getPropertyValue(property).trim()

/** A numeric computed property, with the unit dropped. */
export const styleNumber = (el: Element, property: string): number => Number.parseFloat(style(el, property))

/**
 * Waits until a computed property reaches `target`.
 *
 * Most of the rules this suite pins are *transitions* (`opacity` for the idle fades,
 * `transform` for the mobile sheet), and a transitioned property read one frame after the
 * attribute or class was set is mid-animation: the mobile sheet test would see
 * `matrix(1, 0, 0, 1, 0, 12.4)` and the logo test `opacity: 0.85`.
 */
export async function waitForStyle(el: Element, property: string, target: string, timeout = 4000): Promise<void> {
	const reached = await poll(() => (style(el, property) === target ? true : undefined), timeout)
	if (reached !== true) {
		throw new Error(`Timed out waiting for ${property} to become "${target}" (it is "${style(el, property)}")`)
	}
}

/**
 * Waits until a transitioned `transform` has a computed matrix.
 *
 * The closed state of the mobile sheet is `translateY(100%)` (a matrix) and its base state
 * on the desktop bar is `none`, so a matrix is what "the slide has started" means here.
 */
export async function waitForTransform(el: Element, timeout = 4000): Promise<void> {
	await poll(() => (style(el, 'transform').startsWith('matrix') ? true : undefined), timeout)
}

/**
 * Puts the viewer into the state element-ui.css's hide block keys on.
 *
 * The first grouped branch of that rule needs a tour flag *and* `data-idle`; `data-idle`
 * alone only hides the tour UI (the media figure, the serial-tour readout, the gallery
 * strip). `IdleState` sets `data-idle` itself after 4s of no input, which is far too slow
 * for a layout test, so the attribute is set directly — it is the same attribute the
 * client sets, and the CSS cannot tell the difference.
 */
export function setTourIdle(el: HTMLElement): void {
	el.dataset.markerTourActive = ''
	el.dataset.idle = ''
}

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
