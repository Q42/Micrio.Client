import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { Models } from '$types/models'
import { mountViewer, waitFor } from '../../helpers/viewer'
import { legacyBundle, modernBundle } from '../../fixtures/bundles'

async function waitForLoaded(viewer: ReturnType<typeof mountViewer>) {
	await waitFor(() => viewer.el.$current !== undefined, 4000, 'current image')
	await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish')
}

/** The pre-v5 bundle shape: culture data lives at the top level, not in `i18n`. */
const legacyData = (b: Models.ImageBundle.BundleImage) =>
	(b.data ?? {}) as Models.ImageData.ImageData & { title?: string; description?: string }

describe('pre-v5 vs v5+ bundles', () => {
	it('opens a v3.2 image with top-level culture data', async () => {
		const viewer = mountViewer()
		const bundle = legacyBundle()
		await viewer.open(bundle)
		await waitForLoaded(viewer)

		const image = viewer.el.$current
		expect(image?.id).toBe('dzzLm')
		// The legacy image keeps its own (path-derived) tile base and version
		expect(image?.$info.version).toBe('3.2')
		expect(image?.$info.path).toBe('https://b.micr.io/')
		// Legacy culture fields are readable straight off the data object
		expect(legacyData(bundle).title).toBe('Legacy title')
		expect(legacyData(bundle).description).toBe('Legacy description')
		// ...and the modern typed accessor is simply empty for them
		expect(bundle.data?.i18n).toBeUndefined()
		// Markers load the same way for both eras
		expect(image?.$data?.markers).toHaveLength(1)
		viewer.destroy()
	})

	it('opens a v6 image with the i18n culture map', async () => {
		const viewer = mountViewer()
		const bundle = modernBundle()
		await viewer.open(bundle)
		await waitForLoaded(viewer)

		const image = viewer.el.$current
		expect(image?.id).toBe('rqFkjZz')
		expect(image?.$info.version).toBe('6.1.11')
		expect(bundle.data?.i18n?.en?.title).toBe('Modern title')
		expect(legacyData(bundle).title).toBeUndefined()
		expect(image?.$data?.markers).toHaveLength(2)
		viewer.destroy()
	})

	it('sets extra underzoom levels for a version <= 3.1', async () => {
		const viewer = mountViewer()
		const bundle = legacyBundle()
		bundle.info.version = '3.1'
		await viewer.open(bundle)
		await waitForLoaded(viewer)
		// engine #addCanvas: version <= 3.1 needs the extra underzoom levels
		expect(viewer.el._engine._underzoomLevels).toBe(8)
		viewer.destroy()
	})

	it('leaves underzoom levels alone for 3.2 and later', async () => {
		const viewer = mountViewer()
		const bundle = legacyBundle()
		bundle.info.version = '3.2'
		await viewer.open(bundle)
		await waitForLoaded(viewer)
		expect(viewer.el._engine._underzoomLevels).toBe(4)
		viewer.destroy()
	})

	it('keeps the modern underzoom level for a v6 image', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer)
		expect(viewer.el._engine._underzoomLevels).toBe(4)
		viewer.destroy()
	})

	it('falls back to a language the image actually has', async () => {
		const viewer = mountViewer({ lang: 'de' })
		const bundle = legacyBundle()
		bundle.info.revision = { en: 1, nl: 2 }
		await viewer.open(bundle)
		await waitForLoaded(viewer)
		// 'de' is not in the revision, so the image falls back to 'en'
		expect(viewer.el.lang).toBe('en')
		viewer.destroy()
	})

	it('does not rewrite the language when it is available', async () => {
		const viewer = mountViewer({ lang: 'nl' })
		const bundle = legacyBundle()
		bundle.info.revision = { en: 1, nl: 2 }
		await viewer.open(bundle)
		await waitForLoaded(viewer)
		expect(viewer.el.lang).toBe('nl')
		viewer.destroy()
	})
})
