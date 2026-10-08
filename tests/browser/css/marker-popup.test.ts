import { describe, expect, it } from 'vitest'
import { imageAsset } from '../../fixtures/ui'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, waitForMarker, waitForPopup, type OpenMarkers } from '../../fixtures/markers'
import { waitFor } from '../../helpers/viewer'
import { box, intersectsViewport, rendered, style, styleNumber, waitForStyle } from './helpers'
import { MOBILE, useViewport } from './setup'

/**
 * `src/markers/marker-popup.css` and `src/markers/marker-content.css` — where the popup
 * lands and what it keeps on a phone.
 *
 * `marker-popup.test.ts` in the browser project already owns the popup's *behaviour*
 * (close, minimize, tour stepping, the counter). What it cannot see is this file's two
 * jobs: the popup is a fixed-width panel beside the top-left border margin on a desktop
 * and an auto-width panel pinned to both edges on a phone, and the marker content's image
 * strip collapses from a grid to "first image only, no captions" under 500px. Both are
 * branches that can be dropped without any DOM change.
 */

/**
 * Whether `marker-content.css` still hides the image captions and drops all but the first
 * image under 500px — the two declarations the phone view is made of. Read from the sheet
 * because the fixture's assets are offline URLs that never load, so the caption element the
 * rule targets is never created.
 */
function hidesCaptionOnPhone(): boolean {
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList | undefined
		try {
			rules = sheet.cssRules
		} catch {
			continue
		}
		for (const rule of Array.from(rules ?? [])) {
			if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('500px')) {
				continue
			}
			for (const inner of Array.from(rule.cssRules)) {
				if (
					inner instanceof CSSStyleRule &&
					inner.style.display === 'none' &&
					inner.selectorText.includes('figcaption')
				) {
					return true
				}
			}
		}
	}
	return false
}

/**
 * Opens a marker viewer that fills the iframe, with the popup for `m1` open.
 *
 * Waits for the popup's slide-in to *finish*: `micrio-popup-in` starts at
 * `translateX(-50px)`, and measuring during it reports a box 50px to the left of the rule
 * being tested. Frame throttling in this iframe makes a fixed sleep unreliable, so the
 * animation's end state is polled for directly.
 */
async function openPopup(
	options: Parameters<typeof markerBundle>[0] = {},
): Promise<{ opened: OpenMarkers; popup: HTMLElement }> {
	const opened = await openMarkers(markerBundle(options), { style: 'width: 100vw; height: 100vh; display: block;' })
	await waitForMarker(opened.viewer.el, opened.mid('m1'))
	await opened.openMarker('m1')
	await waitForPopup(opened.viewer.el)
	const popup = opened.viewer.el.querySelector<HTMLElement>('micrio-marker-popup')
	if (popup === null) {
		throw new Error('the marker popup never mounted')
	}
	await waitFor(() => style(popup, 'transform') === 'none', 6000, 'the popup slide-in to finish')
	return { opened, popup }
}

describe('the marker popup panel', () => {
	it('is a 440px panel at the top-left border margin on the desktop', async () => {
		const { opened, popup } = await openPopup()
		const rect = box(popup)

		// marker-popup.css `min-width: 501px`: `micrio-marker-popup { width: 440px; min-width:
		// 20% }` at `top/left: var(--micrio-border-margin)`, plus the slide-in keyframes.
		expect(styleNumber(popup, 'width')).toBeCloseTo(440, 0)
		expect(style(popup, 'position')).toBe('absolute')
		expect(Math.round(rect.left)).toBe(16)
		expect(Math.round(rect.top)).toBe(16)
		expect(style(popup, 'animation-name')).toBe('micrio-popup-in')
		expect(rendered(popup)).toBe(true)
		opened.viewer.destroy()
	})

	it('puts its controls beside the content on the desktop', async () => {
		const { opened, popup } = await openPopup()
		const aside = popup.querySelector(':scope > aside') as HTMLElement

		// The `min-width: 501px` branch moves the aside out to the right of the panel
		// (`left: calc(100% + margin)`), above the content it would otherwise cover.
		expect(style(aside, 'position')).toBe('absolute')
		expect(styleNumber(aside, 'left')).toBeCloseTo(box(popup).width + 16, 0)
		expect(Math.round(box(aside).left)).toBeGreaterThanOrEqual(Math.round(box(popup).right))
		opened.viewer.destroy()
	})

	it('spans the phone width and overlays its controls', async () => {
		await useViewport(MOBILE)
		const { opened, popup } = await openPopup()
		const aside = popup.querySelector(':scope > aside') as HTMLElement

		// The `max-width: 500px` branch: `top: var(--micrio-border-margin)`, `left` and `right`
		// both at the border margin, `width: auto` — and the aside drops to the top-right
		// corner over the content with its own chrome stripped (`--micrio-background: none`).
		expect(intersectsViewport(popup)).toBe(true)
		expect(Math.round(box(popup).left)).toBe(5)
		expect(Math.round(box(popup).right)).toBe(window.innerWidth - 5)
		expect(Math.round(box(aside).top)).toBe(5)
		expect(style(aside, 'z-index')).toBe('2')
		expect(style(aside, '--micrio-background')).toBe('none')
		opened.viewer.destroy()
	})

	it('gives the body text room for the overlaid controls on a phone', async () => {
		await useViewport(MOBILE)
		const { opened, popup } = await openPopup()
		const heading = popup.querySelector<HTMLElement>('micrio-marker-content h1')

		// `@media (max-width: 500px) micrio-marker-popup :is(h1, micrio-media:only-child) {
		// margin-right: ... }` — without it the title runs under the close/step buttons.
		expect(heading).not.toBeNull()
		expect(styleNumber(heading as HTMLElement, 'margin-right')).toBeGreaterThan(0)
		opened.viewer.destroy()
	})

	it('fades the panel out and stops it receiving clicks while it is destroying', async () => {
		const { opened, popup } = await openPopup()

		// `micrio-marker-popup.destroying { animation: none; opacity: 0; pointer-events: none }`
		// on the desktop branch. The class is set by the popup itself from the marker state;
		// here it is applied directly, which is the state a transition catches it in.
		popup.classList.add('destroying')
		await waitForStyle(popup, 'opacity', '0')
		expect(style(popup, 'pointer-events')).toBe('none')
		expect(style(popup, 'animation-name')).toBe('none')
		opened.viewer.destroy()
	})
})

/**
 * A marker carrying two gallery assets, which is what builds the strip. Built per call:
 * `MicrioElement._markerImages` caches by marker id for the whole file, so a reused id would
 * hand a later test the previous viewer's image.
 */
const withImages = () => ({
	markers: [
		marker('m1', {
			images: [
				imageAsset('https://example.test/a.jpg', { id: 'a' }),
				imageAsset('https://example.test/b.jpg', { id: 'b' }),
			],
		}),
	],
})

describe('the marker content image strip', () => {
	it('lays the images out as a grid with captions on the desktop', async () => {
		const { opened, popup } = await openPopup(withImages())
		await waitFor(() => popup.querySelector('micrio-marker-content section') !== null, 4000, 'the image strip')
		const section = popup.querySelector('micrio-marker-content section') as HTMLElement
		const buttons = section.querySelectorAll(':scope > button')

		// `micrio-marker-content section { display: grid;
		// grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)) }` with `section img {
		// width: 100% }`. The assertions are the CSS facts rather than the rendered sizes:
		// the fixture's assets are `example.test` URLs the offline fetch patch 404s, so an
		// image box is zero by construction (the browser suite pins the loading itself).
		expect(buttons.length).toBe(2)
		expect(style(section, 'display')).toBe('grid')
		// `repeat(auto-fit, minmax(100px, 1fr))` with two buttons gives them two equal tracks
		// (`auto-fit` collapses the remainder to a zero track, hence the filter).
		expect(
			style(section, 'grid-template-columns')
				.split(' ')
				.filter((track) => track !== '0px').length,
		).toBe(2)
		for (const button of Array.from(buttons)) {
			expect(style(button, 'display')).toBe('block')
		}
		// `section img { width: 100% }` resolves against the grid track, which is the cell the
		// image was sized to before the responsive work (`section button { width: 100% }`).
		expect(styleNumber(section.querySelector('img') as Element, 'width')).toBeCloseTo(
			styleNumber(buttons[0] as Element, 'width'),
			0,
		)
		// The caption itself is written by the asset load (pinned in the browser suite's
		// `renders one asset with a caption`); these fixture URLs are offline, so what is
		// asserted here is the rule that would hide it on a phone — present in the sheet and
		// scoped to the phone branch, not applied on the desktop one.
		expect(hidesCaptionOnPhone()).toBe(true)
		opened.viewer.destroy()
	})

	it('keeps only the first image and drops the captions on a phone', async () => {
		await useViewport(MOBILE)
		const { opened, popup } = await openPopup(withImages())
		await waitFor(() => popup.querySelector('micrio-marker-content section') !== null, 4000, 'the image strip')
		const section = popup.querySelector('micrio-marker-content section') as HTMLElement
		const buttons = section.querySelectorAll(':scope > button')

		// `@media (max-width: 500px)`: the section becomes a floated 100px column, and
		// `> button:not(:nth-child(1)) { display: none }` with the figcaption hidden — the
		// single-image view a phone gets instead of the grid.
		expect(style(section, 'display')).toBe('block')
		expect(styleNumber(section, 'width')).toBeCloseTo(100, 0)
		expect(style(section, 'float')).toBe('right')
		expect(buttons.length).toBe(2)
		expect(style(buttons[0], 'display')).toBe('block')
		expect(style(buttons[1], 'display')).toBe('none')
		opened.viewer.destroy()
	})

	it('strips the browser button chrome from a bare popup button', async () => {
		const { opened, popup } = await openPopup(withImages())
		const button = popup.querySelector<HTMLElement>('micrio-marker-content button') as HTMLElement

		// The recorded `buttonface` incident: a bare `<button>` is not a `<micrio-button>`,
		// so `element-ui.css`'s nested-context strip never reaches it and only this file's
		// own rule keeps the browser's default background and padding off it.
		expect(button.tagName).toBe('BUTTON')
		expect(style(button, 'background-color')).toBe('rgba(0, 0, 0, 0)')
		expect(style(button, 'padding-top')).toBe('0px')
		expect(style(button, 'cursor')).toBe('pointer')
		opened.viewer.destroy()
	})
})
