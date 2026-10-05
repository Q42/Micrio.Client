import { describe, expect, it } from 'vitest'
import { mountViewer } from '../helpers/viewer'
import { modernBundle } from '../fixtures/bundles'

/** Opens a bundle and returns the options parsed from the element's attributes. */
async function printOptions(attrs: Record<string, string>) {
	const viewer = mountViewer(attrs)
	let detail: Record<string, unknown> | undefined
	viewer.el.addEventListener('print', (e) => {
		detail = (e as CustomEvent).detail as Record<string, unknown>
	})
	await viewer.open(modernBundle())
	const settings = (detail?.settings ?? {}) as Record<string, unknown>
	viewer.destroy()
	return { opts: detail ?? {}, settings }
}

describe('<micr-io> attribute parsing', () => {
	it('maps numbers, arrays and strings', async () => {
		const { settings } = await printOptions({
			'data-camspeed': '2.5',
			'data-zoomlimit': '3',
			'data-view': '0.1,0.2,0.3,0.4',
			'data-focus': '0.1,0.9',
			lang: 'nl',
		})
		expect(settings.camspeed).toBe(2.5)
		expect(settings.zoomLimit).toBe(3)
		expect(settings.view).toEqual([0.1, 0.2, 0.3, 0.4])
		expect(settings.focus).toEqual([0.1, 0.9])
	})

	it('fills in the numeric default for lazyload when the attribute is absent', async () => {
		const { settings } = await printOptions({})
		// lazyload has dN: 0, so it is always present
		expect(settings.lazyload).toBe(0)
	})

	it('ignores non-numeric values for numeric attributes', async () => {
		const { settings } = await printOptions({ 'data-camspeed': 'fast' })
		expect(settings.camspeed).toBeUndefined()
	})

	it('treats a bare boolean attribute as true and "false" as false', async () => {
		const bare = await printOptions({ 'data-show-info': '' })
		expect(bare.settings.showInfo).toBe(true)

		const explicitFalse = await printOptions({ 'data-show-info': 'false' })
		expect(explicitFalse.settings.showInfo).toBe(false)
	})

	it('negates attributes declared with n: true', async () => {
		// `muted` maps to `audio: false`
		const muted = await printOptions({ muted: '' })
		expect(muted.settings.audio).toBe(false)

		// `data-ui` maps to `noUI`: present "false" means *no* UI
		const noUi = await printOptions({ 'data-ui': 'false' })
		expect(noUi.settings.noUI).toBe(true)

		// ...and a bare `data-ui` explicitly keeps the UI on
		const withUi = await printOptions({ 'data-ui': '' })
		expect(withUi.settings.noUI).toBe(false)

		// `data-zooming="false"` maps to `noZoom: true`
		const noZoom = await printOptions({ 'data-zooming': 'false' })
		expect(noZoom.settings.noZoom).toBe(true)
	})

	it('supports dotted option paths', async () => {
		const { settings } = await printOptions({
			'data-gallery-type': 'swipe',
			'data-start': 'abc123',
		})
		expect(settings.gallery).toMatchObject({ type: 'swipe', startId: 'abc123' })
	})

	it('applies the side effects of data-static', async () => {
		const { settings } = await printOptions({ 'data-static': '' })
		expect(settings.static).toBe(true)
		expect(settings.noUI).toBe(true)
		expect(settings.skipMeta).toBe(true)
		expect(settings.hookEvents).toBe(false)
	})

	it('ignores unknown attributes', async () => {
		const { opts, settings } = await printOptions({ 'data-totally-unknown': 'x', whatever: 'y' })
		expect(settings).not.toHaveProperty('totallyUnknown')
		expect(opts).not.toHaveProperty('whatever')
	})

	it('reads width/height overrides into the root options', async () => {
		const { opts } = await printOptions({ width: '1024', height: '768' })
		expect(opts.width).toBe(1024)
		expect(opts.height).toBe(768)
	})
})
