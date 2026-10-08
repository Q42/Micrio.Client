import { describe, expect, it } from 'vitest'
import { createElement } from '$utils/dom'
import type { MicrioElement } from '$core/component'
import { tourBundle } from '../../fixtures/tours'
import { mountTour, settle } from '../../helpers/tour'
import { style, styleNumber } from './helpers'

/**
 * `src/media/media.css` and `media-controls.css` — the fullscreen playback bar and the
 * readout inside it.
 *
 * Unlike the other files in this suite, the rule that matters most here **cannot be executed
 * in a test**: `figure:is(:fullscreen, :-webkit-full-screen)` only matches a real fullscreen
 * element, which needs a user gesture and a browser-level fullscreen transition that a
 * headless iframe does not grant. So the file pins it the way it can:
 *
 * - the declaration is read from the sheet, because it is the fix for a recorded incident
 *   (the controls followed the media in normal flow and sat below the viewport);
 * - the *structure* the selector depends on is asserted on a mounted element, since that is
 *   what a refactor would break silently.
 *
 * Everything else here is ordinary computed style on a live `<micrio-media-controls>`.
 */

/** Mounts a media-controls element with the given props, inside a real viewer. */
async function mountControls(props: Record<string, unknown> = {}) {
	const viewer = await mountTour(tourBundle({}))
	const el = createElement('micrio-media-controls', { setProps: props, parent: viewer.el }) as MicrioElement
	await settle(3)
	return { viewer, el }
}

/**
 * Mounts the media-controls inside a `figure`, which is the shape the fullscreen rule needs.
 *
 * Built by hand rather than through `<micrio-media>`: that element only appends the controls
 * for a source it plays itself (a video or audio file, or a tour), and those need a decoder
 * this suite does not have. The three-element shape here is exactly what `media.ts` creates.
 */
async function mountControlsInFigure(props: Record<string, unknown> = {}) {
	const viewer = await mountTour(tourBundle({}))
	const figure = createElement('figure', { parent: viewer.el }) as HTMLElement
	createElement('video', { attrs: { width: '640', height: '360' }, parent: figure })
	const el = createElement('micrio-media-controls', { setProps: props, parent: figure }) as MicrioElement
	await settle(3)
	return { viewer, el, figure }
}

/** The `position/bottom/left/width` a fullscreen bar must have to stay visible. */
function fullscreenControlsRule(): CSSStyleRule | undefined {
	const found: CSSStyleRule[] = []
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList | undefined
		try {
			rules = sheet.cssRules
		} catch {
			continue
		}
		for (const rule of Array.from(rules ?? [])) {
			if (
				rule instanceof CSSStyleRule &&
				rule.selectorText.includes(':fullscreen') &&
				rule.selectorText.includes('media-controls')
			) {
				found.push(rule)
			}
		}
	}
	return found[0]
}

describe('the fullscreen playback bar', () => {
	it('overlays the media instead of following it in flow', () => {
		const rule = fullscreenControlsRule()
		expect(rule).toBeDefined()

		// `figure:is(:fullscreen, :-webkit-full-screen) micrio-media-controls { position:
		// absolute; bottom: 0; left: 0; width: 100% }`. Absolute (not fixed) on purpose: it
		// stays correct whatever element the browser made fullscreen.
		const { style: declarations } = rule as CSSStyleRule
		expect(declarations.getPropertyValue('position')).toBe('absolute')
		expect(Number.parseFloat(declarations.getPropertyValue('bottom'))).toBe(0)
		expect(Number.parseFloat(declarations.getPropertyValue('left'))).toBe(0)
		expect(declarations.getPropertyValue('width')).toBe('100%')
	})

	it('keeps the controls a child of the figure they overlay', async () => {
		const { viewer, el, figure } = await mountControlsInFigure({ paused: true, duration: 10, currentTime: 3 })

		// `micrio-media` appends the controls to the *figure* (`src/media/media.ts`, the
		// `createComponent(..., { parent: figure })` call) and hands that same figure to
		// `requestFullscreen`. The fullscreen selector is `figure:fullscreen
		// micrio-media-controls`, so a nesting change — controls moved into `micrio-media`,
		// or the figure made a grandparent — would silently break it with no other test
		// failing. The browser suite owns the wiring; this pins the shape it relies on.
		expect(figure.tagName).toBe('FIGURE')
		expect(el.parentElement).toBe(figure)
		expect(figure.querySelector('micrio-media-controls')).toBe(el)
		viewer.destroy()
	})

	it('sizes the media to the fullscreen box', () => {
		// `figure:fullscreen video { height: 100%; object-fit: contain }` and the same for an
		// iframe: the figure is the fullscreen element, so the media has to fill it rather
		// than keep its natural height.
		const mediaRules = Array.from(document.styleSheets).flatMap((sheet) => {
			try {
				return Array.from(sheet.cssRules)
			} catch {
				return []
			}
		})
		const declared = mediaRules
			.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
			.filter((rule) => rule.selectorText.includes('fullscreen'))
			.map((rule) => `${rule.selectorText} { ${rule.style.cssText} }`)
			.join(' ')
		expect(declared).toContain('height: 100%')
		expect(declared).toContain('object-fit: contain')
		expect(declared).toContain('iframe')
	})
})

describe('the readout inside the bar', () => {
	it('lays the bar out as a flex row', async () => {
		const { viewer, el } = await mountControls({ paused: true, duration: 10, currentTime: 3 })
		const aside = el.querySelector(':scope > aside') as HTMLElement

		// `micrio-media-controls { display: block }` with `> aside { display: flex;
		// align-items: center; width: 100% }` — the row the time, bar and buttons share.
		expect(style(el, 'display')).toBe('block')
		expect(style(aside, 'display')).toBe('flex')
		expect(style(aside, 'align-items')).toBe('center')
		expect(Math.round(aside.getBoundingClientRect().width)).toBeCloseTo(
			Math.round((el as HTMLElement).getBoundingClientRect().width),
			0,
		)
		viewer.destroy()
	})

	it('keeps the time readout a fixed width so the bar cannot jump', async () => {
		const { viewer, el } = await mountControls({ paused: true, duration: 120, currentTime: 0 })
		const readout = el.querySelector('aside > div > span') as HTMLElement

		// `aside > div > span { min-width: 50px; white-space: nowrap; font-variant-numeric:
		// tabular-nums }` — the collapse-on-every-step incident was this row's rule losing
		// out to another, so both the width and the monospaced digits are pinned.
		expect(style(readout, 'display')).toBe('block')
		expect(styleNumber(readout, 'min-width')).toBe(50)
		expect(style(readout, 'white-space')).toBe('nowrap')
		expect(style(readout, 'font-variant-numeric')).toBe('tabular-nums')
		viewer.destroy()
	})

	it('draws the progress bar from the theme variables', async () => {
		const { viewer, el } = await mountControls({ paused: true, duration: 10, currentTime: 3 })
		const bars = el.querySelector<HTMLElement>('[data-part="bars"]') as HTMLElement
		const bar = bars.querySelector<HTMLElement>('[data-part="bar"]') as HTMLElement

		// `[data-part="bars"] { flex: 1; height: 4px; background:
		// var(--micrio-progress-bar-background); border-radius: 2px }` plus the fill's
		// `background: var(--micrio-color)`.
		expect(styleNumber(bars, 'height')).toBe(4)
		expect(style(bars, 'border-radius')).toBe('2px')
		expect(style(bars, 'cursor')).toBe('pointer')
		expect(style(bars, 'position')).toBe('relative')
		expect(style(bar, 'position')).toBe('absolute')
		expect(style(bar, 'background-color')).toBe('rgb(255, 255, 255)')
		viewer.destroy()
	})
})
