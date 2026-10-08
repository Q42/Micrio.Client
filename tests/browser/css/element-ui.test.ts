import { describe, expect, it } from 'vitest'
import { uiBundle } from '../../fixtures/ui'
import { waitFor } from '../../helpers/viewer'
import type { Viewer } from '../../helpers/viewer'
import { hitsAt, mountUi, rendered, setTourIdle, style, waitForStyle } from './helpers'

/**
 * `src/core/element-ui.css` — the client's visibility substrate, and the file behind three
 * of the five stylesheet incidents TESTING.md records.
 *
 * Three concerns are pinned here:
 *
 * 1. **`display: contents`** on the wrapper elements. When one of those rules is dropped (as
 *    it was when inline styles moved into a file) the wrapper becomes a real box and the
 *    layout inside it silently changes; the serial tour's readout vanished that way. The
 *    rule is asserted both on mounted elements and as CSS text, so a dropped member of the
 *    shared list is visible too.
 * 2. **`:empty` hiding** for the layers the client leaves in the DOM.
 * 3. **the hide block** at the bottom of the file: `opacity: 0` + `pointer-events: none` +
 *    `transform: var(--micrio-hide, none)`, and the companion rule that keeps the controls
 *    faded but *usable* during a marker tour — the "visible but dead" incident.
 *
 * The idle half of the hide block is driven by attributes rather than by waiting out
 * `IdleState`'s 4s timer: `setTourIdle` sets exactly the attribute pair the client sets, and
 * the fade is then waited on for real (`waitForStyle`), because a transitioned property read
 * too early is a mid-animation value.
 */

/** The wrappers that must stay layout-transparent, one per area of the UI. */
const CONTENTS_WRAPPERS = [
	'micrio-main',
	'micrio-toolbar',
	'micrio-controls',
	'micrio-popover',
	'micrio-gallery',
	'micrio-swipe-gallery',
	'micrio-logo',
	'micrio-tour',
	'micrio-serial-tour',
	'micrio-embed',
	'micrio-button',
] as const

/** A viewer on the toolbar/popover fixture, with the UI rendered. */
async function openUiViewer(): Promise<Viewer> {
	const viewer = await mountUi(uiBundle({ revision: { en: 1, nl: 1 } }))
	await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') !== null, 4000, 'the toolbar menu')
	return viewer
}

/**
 * Every authored top-level style rule in the document.
 *
 * Two of the assertions below are about the *rule* rather than a rendered result (the
 * shared container selector and the marker-tour companion), and those have to read the CSS
 * text. Rules inside `@media` are skipped: the ones pinned here are all top-level, and a
 * rule that moved into a media query is a different claim that a selector search would
 * silently accept.
 */
function authoredRules(): CSSStyleRule[] {
	const found: CSSStyleRule[] = []
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList | undefined
		try {
			rules = sheet.cssRules
		} catch {
			continue
		}
		for (const rule of Array.from(rules ?? [])) {
			if (rule instanceof CSSStyleRule) {
				found.push(rule)
			}
		}
	}
	return found
}

describe('display:contents containers', () => {
	it('keeps the client elements layout-transparent', async () => {
		const viewer = await openUiViewer()

		let checked = 0
		for (const tag of CONTENTS_WRAPPERS) {
			const el = viewer.el.querySelector(tag)
			// Not every wrapper is mounted for this fixture (no gallery or tour), so the rule is
			// checked on the ones that exist and the CSS text is checked for all of them below.
			if (el !== null) {
				expect(`${tag}: ${style(el, 'display')}`).toBe(`${tag}: contents`)
				checked += 1
			}
		}
		expect(checked).toBeGreaterThan(3)
		viewer.destroy()
	})

	it('lists every wrapper in the shared selector', () => {
		const selectors = authoredRules()
			.filter((rule) => rule.style.display === 'contents')
			.map((rule) => rule.selectorText)

		// One `:where()` rule holds the container list; `:where()` keeps its specificity at
		// zero so a component's own `display` still wins.
		const shared = selectors.find((selector) => CONTENTS_WRAPPERS.every((tag) => selector.includes(tag)))
		expect(shared).toBeDefined()
		expect(shared?.trimStart().startsWith(':where(')).toBe(true)
		// Only the shared rule carries the full list.
		expect(selectors.filter((selector) => selector.includes('micrio-toolbar'))).toHaveLength(1)
	})
})

describe('empty layers', () => {
	it('hides an empty layer instead of leaving its box in the flow', async () => {
		const viewer = await openUiViewer()

		// :is(micrio-markers, micrio-image-embeds, micrio-marker, micrio-button-group):empty
		// A layer is created eagerly and filled later, so the empty window is real. Both
		// states are checked on one element, which is what makes the rule (not the element)
		// the thing under test.
		const group = document.createElement('micrio-button-group')
		viewer.el.append(group)
		expect(style(group, 'display')).toBe('none')
		expect(rendered(group)).toBe(false)

		group.append(document.createElement('micrio-button'))
		expect(style(group, 'display')).not.toBe('none')
		expect(rendered(group)).toBe(true)
		viewer.destroy()
	})
})

describe('the hide block', () => {
	it('fades the logo out and takes it out of the click path during an idle tour', async () => {
		const viewer = await openUiViewer()
		const logo = viewer.el.querySelector('micrio-logo a') as HTMLElement

		// The clickable logo, with the pointer over its centre.
		expect(style(logo, 'opacity')).toBe('1')
		expect(hitsAt(logo)).toBe(true)
		const centre = { x: logo.getBoundingClientRect().left + 11, y: logo.getBoundingClientRect().top + 11 }

		setTourIdle(viewer.el)
		// The fade is a 0.25s transition (`src/layout/logo.css`), so wait for the target value.
		await waitForStyle(logo, 'opacity', '0')
		expect(style(logo, 'pointer-events')).toBe('none')
		// Nothing at the logo's own position reaches it any more — the incident this rule
		// exists for was a control that was faded out but still received clicks.
		expect(logo.contains(document.elementFromPoint(centre.x, centre.y))).toBe(false)
		viewer.destroy()
	})

	it('leaves an idle viewer without a tour alone', async () => {
		const viewer = await openUiViewer()
		const logo = viewer.el.querySelector('micrio-logo a') as HTMLElement

		// `data-idle` alone is the state after four seconds without input. The grouped rule's
		// first branch needs a tour flag too, so the logo is untouched — a distinction a
		// selector rewritten as one flat list would silently lose.
		viewer.el.dataset.idle = ''
		expect(style(logo, 'opacity')).toBe('1')
		expect(hitsAt(logo)).toBe(true)
		viewer.destroy()
	})

	it('keeps the zoom controls untouched during the same idle marker tour', async () => {
		const viewer = await openUiViewer()
		const logo = viewer.el.querySelector('micrio-logo a') as HTMLElement
		const zoom = viewer.el.querySelector('micrio-zoom-buttons') as HTMLElement

		// Nothing in the hide block targets the controls for a marker tour, so the zoom
		// buttons keep their own state while the logo fades: the buttons are disabled here
		// (this fixture mounts no image, so `isZoomedOut()` reports `true`), which is the one
		// state `src/ui/button.css` turns into `pointer-events: none` and marks with the 0.4
		// icon opacity. That is a *disabled* button, not an invisible control still swallowing
		// clicks — the incident the hide block's own `pointer-events: none` exists to prevent.
		expect(style(zoom, 'opacity')).toBe('1')
		expect(style(zoom, 'pointer-events')).toBe('auto')

		setTourIdle(viewer.el)
		await waitForStyle(logo, 'opacity', '0')
		expect(style(zoom, 'opacity')).toBe('1')
		expect(style(zoom, 'pointer-events')).toBe('auto')

		const button = viewer.el.querySelector('micrio-button.zoomIn button') as HTMLButtonElement
		expect(button.disabled).toBe(true)
		expect(style(button, 'pointer-events')).toBe('none')
		expect(style(button.querySelector('svg') as SVGElement, 'opacity')).toBe('0.4')
		viewer.destroy()
	})

	it('keeps the marker-tour companion rule for the controls', () => {
		// The rule that overrides `--micrio-hide` while a marker tour runs. Today no rule
		// hides `micrio-controls aside` on a marker tour, so it is inert; it is pinned
		// because it is the guard that has to exist the moment one does. If this assertion
		// fails, the two rules drifted — see the "visible but dead" incident in TESTING.md.
		const selectors = authoredRules()
			.filter((rule) => rule.style.getPropertyValue('--micrio-hide') === 'none')
			.map((rule) => rule.selectorText)
			.join(' ')
		expect(selectors).toContain('micrio-controls aside')
		expect(selectors).toContain('[data-marker-tour-active]')
	})
})

describe('the canvas pin', () => {
	it('sizes the canvas to the host, whatever the attribute says', async () => {
		const viewer = await openUiViewer()
		const canvas = viewer.el.querySelector('canvas.micrio') as HTMLCanvasElement

		// `canvas.micrio { width/height: 100% !important }` in element.css is what keeps the
		// WebGL surface matching the element box even while `onresize` writes attributes.
		expect(Math.round(canvas.getBoundingClientRect().width)).toBe(Math.round(viewer.el.getBoundingClientRect().width))
		expect(Math.round(canvas.getBoundingClientRect().height)).toBe(Math.round(viewer.el.getBoundingClientRect().height))
		expect(rendered(canvas)).toBe(true)
		viewer.destroy()
	})
})
