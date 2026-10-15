import { describe, expect, it } from 'vitest'
import { style, waitForStyle } from './helpers'

/**
 * `src/embed/image-embeds.css` — the overlay's own fade.
 *
 * The layout mounts a fresh `<micrio-image-embeds>` per visible image, so a switch removes
 * one layer and creates the next. Without a fade the new image's embeds pop in over the
 * crossfade while the outgoing image's are still at full opacity. The class wiring is pinned
 * in `tests/browser/embed/image-embeds.test.ts`; this file pins the stylesheet it drives.
 *
 * The probe is a bare element appended to the body: nothing but the element's own rules
 * apply to it, and no viewer (let alone a WebGL context) is needed.
 */

function mountLayer(): HTMLElement {
	const layer = document.createElement('micrio-image-embeds')
	// A child, so the `:empty { display: none }` rule does not hide it
	layer.append(document.createElement('div'))
	document.body.append(layer)
	return layer
}

describe('the image-embeds overlay fade', () => {
	it('fades the layer in when it is created', async () => {
		const layer = mountLayer()
		expect(style(layer, 'animation-name')).toBe('micrio-embeds-fade-in')
		await waitForStyle(layer, 'opacity', '1')
	})

	it('fades it back out while images are being switched', async () => {
		const layer = mountLayer()
		await waitForStyle(layer, 'opacity', '1')

		layer.classList.add('inactive')
		// The creation animation would otherwise keep winning over the class
		expect(style(layer, 'animation-name')).toBe('none')
		await waitForStyle(layer, 'opacity', '0')
	})
})
