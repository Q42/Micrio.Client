import { afterEach, describe, expect, it } from 'vitest'
import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import { createElement } from '$utils/dom'
import { imageAsset } from '../../fixtures/ui'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'

/**
 * `micrio-swipe-gallery`: the asset-backed swipe gallery the popover renders for
 * a content page's images and for a marker's `images`. It builds its own nested
 * `<micr-io>` through `Gallery._fromAssets`, and mirrors the current asset's
 * description into a `<figcaption>`.
 */

const viewers: Viewer[] = []

afterEach(() => {
	for (const viewer of viewers.splice(0)) {
		viewer.destroy()
	}
})

function mount(): Viewer {
	const viewer = mountViewer()
	viewers.push(viewer)
	return viewer
}

/** Mounts the gallery element inside a viewer and waits for its nested `<micr-io>`. */
async function openAssets(
	gallery: Models.Assets.Image[],
	opts: { galleryStart?: string; lang?: string } = {},
): Promise<{ viewer: Viewer; nested: HTMLMicrioElement; caption: HTMLElement | null }> {
	const viewer = mount()
	createElement('micrio-swipe-gallery', {
		setProps: { gallery, galleryStart: opts.galleryStart, lang: opts.lang ?? 'en' },
		parent: viewer.el,
	})

	await waitFor(
		() => viewer.el.querySelector<HTMLMicrioElement>('micrio-swipe-gallery > micr-io')?.gallery !== undefined,
		4000,
		'the asset gallery',
	)
	const nested = viewer.el.querySelector<HTMLMicrioElement>('micrio-swipe-gallery > micr-io')
	if (!nested) {
		throw new Error('no nested viewer')
	}
	return { viewer, nested, caption: viewer.el.querySelector<HTMLElement>('micrio-swipe-gallery > figcaption') }
}

describe('micrio-swipe-gallery', () => {
	it('builds a swipe gallery from the assets with the gallery settings the popover expects', async () => {
		const { nested } = await openAssets([
			imageAsset('https://example.test/a.jpg', { id: 'a' }),
			imageAsset('https://example.test/b.jpg', { id: 'b' }),
		])
		const { gallery } = nested

		expect(gallery?._config.type).toBe('swipe')
		expect(gallery?._images.map((i) => i.id)).toEqual(['a', 'b'])
		// Asset galleries skip the metadata fetch and the logo
		expect(gallery?._config.settings).toEqual({ skipMeta: true, noLogo: true })
	})

	it('prefers the micrioId over the asset id, and skips an asset without either', async () => {
		const { nested } = await openAssets([
			imageAsset('https://example.test/a.jpg', { id: 'a', micrioId: 'rqFkjZz' }),
			imageAsset('https://example.test/none.jpg'),
			imageAsset('https://example.test/b.jpg', { id: 'b' }),
		])
		expect(nested.gallery?._images.map((i) => i.id)).toEqual(['rqFkjZz', 'b'])
	})

	it('starts on the galleryStart image', async () => {
		const { nested } = await openAssets(
			[imageAsset('https://example.test/a.jpg', { id: 'a' }), imageAsset('https://example.test/b.jpg', { id: 'b' })],
			{ galleryStart: 'b' },
		)
		expect(nested.$current?.album?.currentIndex).toBe(1)
	})

	it('prints the current asset description and follows gallery-show', async () => {
		const { nested, caption } = await openAssets([
			imageAsset('https://example.test/a.jpg', { id: 'a' }),
			imageAsset('https://example.test/b.jpg', { id: 'b' }),
		])
		// The caption is language-scoped and shows the first asset's description
		expect(caption?.textContent).toBe('https://example.test/a.jpg description')
		expect(caption?.style.display).toBe('')

		// The gallery reports the page ids, and the element maps them back to an asset
		nested.dispatchEvent(new CustomEvent('gallery-show', { detail: ['b'] }))
		expect(caption?.textContent).toBe('https://example.test/b.jpg description')
	})

	it('hides the caption when the asset has no description for the language', async () => {
		const silent = {
			...imageAsset('https://example.test/silent.jpg', { id: 's' }),
			i18n: { en: { title: 'Silent' } },
		}
		const { caption } = await openAssets([silent])
		expect(caption?.textContent).toBe('')
		expect(caption?.style.display).toBe('none')
	})
})
