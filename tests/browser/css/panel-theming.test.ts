import { describe, expect, it } from 'vitest'
import { uiBundle } from '../../fixtures/ui'
import { waitFor } from '../../helpers/viewer'
import type { Viewer } from '../../helpers/viewer'
import { box, expectFillsViewport, mountUi, style, styleNumber } from './helpers'
import { MOBILE, TABLET, useViewport } from './setup'

/**
 * The panel-level sheets that carry a media query or a scheme branch: `src/layout/popover.css`
 * (the client's one modal surface), `src/core/element.css` (the theme variables) and the
 * details panel.
 *
 * Three things are pinned:
 *
 * 1. **the light-mode variables**, because they are a whole second palette behind one
 *    attribute and nothing else asserts that a widget picks it up;
 * 2. **the popover's breakpoints as measured boxes** — the same dialog is a 9/16 panel on the
 *    desktop, full-screen-ish on a phone and a `min-aspect-ratio` shape on a landscape window;
 * 3. **the tablet band**, which no other viewport reaches: 820px is above the marker,
 *    subtitles and popover `max-width: 640` branches, and below nothing.
 *
 * The dialog state used is the welcome screen's language switcher: `dialog:not(.article)`,
 * `:not(.gallery)`, which is the shape the media rules size. A content page renders
 * `dialog.article` (a fixed 540px column at *every* width, so it proves nothing about a
 * breakpoint — measured while writing this), and a gallery fills the screen by design.
 *
 * `prefers-color-scheme` is deliberately not covered: the provider exposes no `emulateMedia`,
 * so an `[data-auto-scheme]` assertion would be testing the host machine's setting.
 */

/** Opens the popover's language switcher and waits for the dialog. */
async function openPopover(): Promise<{ viewer: Viewer; dialog: HTMLDialogElement }> {
	const viewer = await mountUi(uiBundle({ revision: { en: 1, nl: 1 } }))
	await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') !== null, 4000, 'the toolbar menu')
	viewer.el.state.popover.set({ showLangSelect: true })
	await waitFor(
		() => viewer.el.querySelector<HTMLDialogElement>('micrio-popover dialog')?.open === true,
		6000,
		'the popover dialog',
	)
	return { viewer, dialog: viewer.el.querySelector('micrio-popover dialog') as HTMLDialogElement }
}

describe('the theme variables', () => {
	it('switches to the light palette behind data-light-mode', async () => {
		const viewer = await mountUi(uiBundle())
		const before = {
			color: style(viewer.el, '--micrio-color'),
			background: style(viewer.el, '--micrio-background'),
			popover: style(viewer.el, '--micrio-popover-background'),
		}

		viewer.el.dataset.lightMode = ''
		// element.css: `micr-io[data-light-mode] { --micrio-color: #000; ... }`. The attribute
		// is set by the client from the image settings, so a lost rule silently keeps a dark
		// viewer on a light host.
		expect(style(viewer.el, '--micrio-color')).toBe('#000')
		expect(style(viewer.el, '--micrio-background')).not.toBe(before.background)
		expect(style(viewer.el, '--micrio-popover-background')).not.toBe(before.popover)

		delete viewer.el.dataset.lightMode
		expect(style(viewer.el, '--micrio-color')).toBe(before.color)
		viewer.destroy()
	})

	it('carries the palette into a rendered panel', async () => {
		const viewer = await mountUi(uiBundle())

		viewer.el.dataset.lightMode = ''
		// A panel takes `color`/`background` from the two variables (element-ui.css), so the
		// flip has to reach an actual painted box, not just the custom property.
		const probe = document.createElement('div')
		probe.style.cssText = 'color: var(--micrio-color); background: var(--micrio-background);'
		viewer.el.append(probe)
		expect(style(probe, 'color')).toBe('rgb(0, 0, 0)')
		expect(style(probe, 'background-color')).toBe('rgba(255, 255, 255, 0.66)')
		viewer.destroy()
	})
})

describe('the popover at each width', () => {
	it('is a centered panel on the desktop', async () => {
		const { viewer, dialog } = await openPopover()
		const rect = box(dialog)

		// popover.css `min-width: 640px`: `dialog:not(.article) { width: calc(85cqw - 56px) }`
		// with the close/next aside beside the content, so the box tracks the *container*
		// (`micr-io` is `container-type: size` in element.css), not the window. It has to stay
		// inside the viewport on both axes: the exact ratio is decided by the cascade of the
		// three rules in that file, and the two branches are pinned separately below.
		expect(style(dialog, 'display')).toBe('flex')
		expect(style(dialog, 'flex-direction')).toBe('row')
		expect(Math.round(rect.width)).toBe(Math.round(window.innerWidth * 0.85 - 56))
		expect(rect.height).toBeGreaterThan(0)
		expect(rect.height).toBeLessThan(window.innerHeight)
		expect(style(dialog.querySelector(':scope > aside') as HTMLElement, 'position')).toBe('absolute')
		expect(rect.left).toBeGreaterThan(0)
		expect(rect.top).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('fills the phone width and moves its aside over the content', async () => {
		await useViewport(MOBILE)
		const { viewer, dialog } = await openPopover()
		expectFillsViewport(viewer.el)

		// popover.css `max-width: 639px`: `width/height: 100%; flex-direction: column` and
		// `dialog > aside { position: fixed; top/right: border-margin }`. The box is capped by
		// `max-width: 90vw` — the width asserted here — and the aside is the part that is
		// *positioned* rather than laid out in the column.
		expect(style(dialog, 'flex-direction')).toBe('column')
		// `dialog { max-width: 90vw; max-height: 90vh }` still caps the `100%` size, so the
		// full-screen rule shows up as the box reaching the cap on both axes and staying
		// centered in the viewport rather than hugging one edge.
		expect(Math.round(box(dialog).width)).toBe(Math.round(window.innerWidth * 0.9))
		expect(Math.round(box(dialog).height)).toBe(Math.round(window.innerHeight * 0.9))
		expect(Math.round(box(dialog).left)).toBe(Math.round(window.innerWidth * 0.05))
		expect(style(dialog.querySelector(':scope > aside') as HTMLElement, 'position')).toBe('fixed')
		// The border margin itself is responsive: element.css drops it to 5px under 500px.
		expect(style(viewer.el, '--micrio-border-margin')).toBe('5px')
		viewer.destroy()
	})

	it('keeps the tablet width in the panel branch', async () => {
		await useViewport(TABLET)
		const { viewer, dialog } = await openPopover()
		expectFillsViewport(viewer.el)

		// 820px is above the 640px breakpoint, so the panel branch applies — at a width the
		// desktop viewport never exercises. This is the band that separates the
		// container-relative arithmetic (`85cqw`) from a plain viewport rule.
		expect(style(dialog, 'flex-direction')).toBe('row')
		expect(Math.round(box(dialog).width)).toBe(Math.round(TABLET.width * 0.85 - 56))
		expect(style(dialog.querySelector(':scope > aside') as HTMLElement, 'position')).toBe('absolute')
		viewer.destroy()
	})

	it('uses the wide aspect-ratio branch on a landscape viewport', async () => {
		await useViewport({ width: 1280, height: 600 })
		const { viewer, dialog } = await openPopover()

		// popover.css `min-aspect-ratio: 16/9` wins over the base height: `height: 75cqh` at
		// 16/9 wide, so the dialog fits a window that is much wider than it is tall.
		expect(styleNumber(dialog, 'height')).toBeCloseTo(600 * 0.75, 0)
		const rect = box(dialog)
		expect(rect.width / rect.height).toBeCloseTo(16 / 9, 2)
		viewer.destroy()
	})
})

describe('the details panel on a phone', () => {
	it('is part of the same responsive set', () => {
		// `details.css` has a `max-width: 600px` branch (it moves the panel to the bottom edge
		// and raises its `z-index`). The element only mounts for an image with `showInfo`, so
		// the branch is pinned from the sheet rather than from a rendered box — the same
		// "one breakpoint, one file" shape as the toolbar's.
		const media = Array.from(document.styleSheets)
			.flatMap((sheet) => {
				try {
					return Array.from(sheet.cssRules)
				} catch {
					return []
				}
			})
			.filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.includes('600px'))
			.map((rule) => rule.cssText)
			.join(' ')
		expect(media).toContain('micrio-details')
		expect(media).toContain('z-index')
	})
})
