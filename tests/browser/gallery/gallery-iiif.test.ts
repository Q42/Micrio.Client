import { afterEach, describe, expect, it } from 'vitest'
import { mockJson } from '../../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'

/**
 * The IIIF manifest path: `open('https://…')` fetches a Presentation API 3
 * manifest, and a multi-canvas one becomes a `swipe` gallery while a
 * single-canvas manifest (or a bare Image API response) stays one image.
 *
 * A v2 manifest and a manifest without usable canvases are failures, so they
 * surface through `#printError` and the `<micrio-error>` element.
 *
 * Every test fetches its own URL: `fetchJson` caches responses in a module-level
 * `jsonCache` keyed by URI, so a shared URL would be served from the first
 * test's response (and a two-canvas manifest would silently answer a one-canvas
 * test).
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

/** One canvas body: a service id plus the dimensions the gallery needs. */
const body = (id: string, width = 512, height = 512, format = 'image/webp') => ({
	service: [{ id }],
	width,
	height,
	format,
})

/** The nested `items → items → body` shape a Presentation 3 manifest uses. */
const manifest = (...bodies: unknown[]) => ({
	type: 'Manifest',
	items: bodies.map((b) => ({ items: [{ items: [{ body: b }] }] })),
})

async function openManifest(resp: unknown, url = 'https://iiif.test/manifest') {
	mockJson(/iiif\.test/, resp)
	const viewer = mount()
	await viewer.open(url)
	return viewer
}

describe('IIIF albums', () => {
	it('builds a swipe gallery from a multi-canvas v3 manifest', async () => {
		const viewer = await openManifest(
			manifest(body('https://iiif.test/multi/0'), body('https://iiif.test/multi/1', 256, 128, 'image/png')),
			'https://iiif.test/multi/manifest',
		)
		await waitFor(() => Boolean(viewer.el.gallery), 4000, 'the gallery')
		await waitFor(() => viewer.el.$current?.album !== undefined, 4000, 'the album API')

		const gallery = viewer.el.gallery
		expect(gallery?._config.type).toBe('swipe')
		expect(gallery?._images).toHaveLength(2)
		expect(gallery?._images[0]?.$info.isIIIF).toBe(true)
		expect(gallery?._images[0]?.$info.path).toBe('https://iiif.test/multi')
		// The second canvas is a PNG and keeps its own size
		expect(gallery?._images[1]?.$info.isPng).toBe(true)
		expect(gallery?._images[1]?.$info.width).toBe(256)
		expect(gallery?._images[1]?.$info.height).toBe(128)
	})

	it('falls back to a single image for a one-canvas manifest', async () => {
		const viewer = await openManifest(
			manifest(body('https://iiif.test/single/0')),
			'https://iiif.test/single/manifest',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		// `_fromIIIF` returns null for a single canvas, so `#handleIIIF` builds one image
		expect(viewer.el.gallery).toBeUndefined()
		expect(viewer.el.$current?.$info.isIIIF).toBe(true)
		// The IIIF id is reduced to its last path segment
		expect(viewer.el.$current?.$info.id).toBe('0')
	})

	it('falls back to a single image for a raw Image API response', async () => {
		const viewer = await openManifest(
			{ id: 'https://iiif.test/raw/1', width: 400, height: 300, tiles: [{ width: 256 }] },
			'https://iiif.test/raw/1/info.json',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		expect(viewer.el.gallery).toBeUndefined()
		expect(viewer.el.$current?.$info.width).toBe(400)
		expect(viewer.el.$current?.$info.tiles).toEqual([{ width: 256 }])
	})

	it('reports a v2 manifest as unsupported', async () => {
		const viewer = await openManifest({ '@type': 'sc:Manifest', sequences: [] }, 'https://iiif.test/v2/manifest')
		await waitFor(() => viewer.el.querySelector('micrio-error') !== null, 4000, 'the error UI')
		expect(viewer.el.gallery).toBeUndefined()
		expect(viewer.el.querySelector('micrio-error span')?.textContent).toBe(
			'Only IIIF Presentation API 3 manifests are supported',
		)
	})

	it('reports a manifest without usable canvases', async () => {
		const viewer = await openManifest({ type: 'Manifest', items: [] }, 'https://iiif.test/empty/manifest')
		await waitFor(() => viewer.el.querySelector('micrio-error') !== null, 4000, 'the error UI')
		expect(viewer.el.querySelector('micrio-error span')?.textContent).toBe(
			'No valid IIIF canvases found in the manifest',
		)
	})
})
