import { afterEach, describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { albumOf } from '../../fixtures/albums'
import { mockJson } from '../../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'

/**
 * The IIIF URL path: `open('https://…')` (or the element's `id` attribute, which
 * `#doPrint` routes to the same handler) fetches a document and turns it into an
 * image or an album.
 *
 * Three shapes are supported:
 * - a multi-canvas Presentation 3 or 4 manifest → a `swipe` album;
 * - a one-canvas manifest → a single image, sized by the canvas *body* and keyed by
 *   its Image API `service` id;
 * - an Image API 2.1 or 3.0 `info.json` → a single image with the declared tiles.
 *
 * Presentation 2 is rejected on purpose (`IIIF_V2_UNSUPPORTED`), and so is a manifest
 * whose canvas bodies carry no Image API service — both boundaries are pinned below.
 *
 * Presentation 3 and the 4.0 draft share the same 2D structure (`type: Manifest`,
 * Canvas → AnnotationPage → Annotation → `body.service[0].id`), which is why v4 needs
 * no separate code path. The v4 fixtures mirror the consortium's own examples:
 * https://iiif.io/api/presentation/4.0/example/uc01_artwork.json and uc02_book.json.
 *
 * Every test fetches its own URL: `fetchJson` caches responses in a module-level
 * `jsonCache` keyed by URI, so a shared URL would be served from the first test's
 * response (and a two-canvas manifest would silently answer a one-canvas test).
 */

const viewers: Viewer[] = []

afterEach(() => {
	for (const viewer of viewers.splice(0)) {
		viewer.destroy()
	}
})

/** Mounts a viewer and remembers it for teardown. */
function mount(attrs: Record<string, string> = {}): Viewer {
	const viewer = mountViewer(attrs)
	viewers.push(viewer)
	return viewer
}

/** Serves `resp` for any `iiif.test` URL and opens `url` on a fresh viewer. */
async function openIIIF(resp: unknown, url: string): Promise<Viewer> {
	mockJson(/iiif\.test/, resp)
	const viewer = mount()
	await viewer.open(url)
	return viewer
}

/**
 * One canvas body: a concrete image URI (as a real manifest publishes) plus the Image
 * API service. The client keys the image off `service[0].id`, never off the body URI.
 */
function canvasBody(
	serviceId: string,
	opts: { width?: number; height?: number; format?: string; service?: Record<string, unknown> } = {},
) {
	const { width = 512, height = 512, format = 'image/webp', service = {} } = opts
	return {
		id: `${serviceId}/full/max/0/default.jpg`,
		type: 'Image',
		format,
		width,
		height,
		service: [{ id: serviceId, type: 'ImageService3', profile: 'level2', ...service }],
	}
}

/** One Canvas whose single painting Annotation carries `body`. */
function canvas(body: unknown, width = 512, height = 512) {
	return {
		id: 'https://iiif.test/canvas',
		type: 'Canvas',
		width,
		height,
		items: [
			{
				id: 'https://iiif.test/canvas/page',
				type: 'AnnotationPage',
				items: [
					{
						id: 'https://iiif.test/canvas/annotation',
						type: 'Annotation',
						motivation: ['painting'],
						body,
					},
				],
			},
		],
	}
}

/** A Presentation 3 or 4 manifest of the given canvases. */
function manifest(version: 3 | 4, canvases: unknown[], extra: Record<string, unknown> = {}) {
	return {
		'@context': `http://iiif.io/api/presentation/${version}/context.json`,
		id: `https://iiif.test/presentation/${version}/manifest`,
		type: 'Manifest',
		label: { en: ['Test manifest'] },
		items: canvases,
		...extra,
	}
}

/** Waits until the current image is placed on a canvas with at least one tile. */
async function waitForImage(viewer: Viewer): Promise<void> {
	await waitFor(() => viewer.el.$current?._placed === true, 4000, 'the image to be placed')
	expect(viewer.el._engine._numTiles).toBeGreaterThan(0)
}

/** Waits for the error UI and asserts its message. */
async function expectError(viewer: Viewer, message: string): Promise<void> {
	await waitFor(() => viewer.el.querySelector('micrio-error') !== null, 4000, 'the error UI')
	expect(viewer.el.gallery).toBeUndefined()
	expect(viewer.el.querySelector('micrio-error span')?.textContent).toBe(message)
}

describe('IIIF — multi-canvas manifests become a swipe album', () => {
	it('builds a swipe album from a multi-canvas v3 manifest', async () => {
		const viewer = await openIIIF(
			manifest(3, [
				canvas(canvasBody('https://iiif.test/v3/book/0')),
				canvas(canvasBody('https://iiif.test/v3/book/1', { width: 256, height: 128, format: 'image/png' }), 256, 128),
			]),
			'https://iiif.test/v3/book/manifest',
		)
		await waitFor(() => viewer.el.gallery !== undefined, 4000, 'the gallery controller')
		await waitFor(() => viewer.el.$current?.album !== undefined, 4000, 'the album API')

		const { gallery } = viewer.el
		const first = gallery?._images[0]
		const second = gallery?._images[1]

		expect(gallery?._config.type).toBe('swipe')
		expect(gallery?._images).toHaveLength(2)
		expect(first?.$info.isIIIF).toBe(true)
		expect(first?.$info.path).toBe('https://iiif.test/v3/book')
		// The service id's last segment becomes `$info.id`, so path + id reassemble the
		// service URL the Image API requests are built from.
		expect(first?.$info.id).toBe('0')
		expect(first?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/v3/book/0/0,0,512,512/512,512/0/default.webp')
		expect(second?.$info.isPng).toBe(true)
		expect(second?.$info.width).toBe(256)
		expect(second?.$info.height).toBe(128)
		// `isPng` never reaches the IIIF tile extension: it only ever picks webp or jpg
		expect(second?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/v3/book/1/0,0,256,128/256,128/0/default.jpg')

		// Every canvas reaches the engine as a child canvas of the strip
		await waitFor(() => gallery?._images.every((i) => i._placed) === true, 4000, 'the child canvases')
		expect(viewer.el._engine._numTiles).toBeGreaterThan(0)

		const album = albumOf(viewer.el)
		expect(album?.numPages).toBe(2)
		album?.next()
		await waitFor(() => album?.currentIndex === 1, 4000, 'the second page')
		const current = album?.currentImage
		expect(current === undefined ? undefined : get(current)).toBe(second)
	})

	it('builds a swipe album from a multi-canvas v4 manifest', async () => {
		// v4 adds a manifest-level `services` expansion for shared definitions, but the
		// spec still requires `service` on each body, which is all the client reads.
		const resp = manifest(
			4,
			[canvas(canvasBody('https://iiif.test/v4/book/0')), canvas(canvasBody('https://iiif.test/v4/book/1'))],
			{ services: [{ id: 'https://iiif.test/v4/book/0', type: 'ImageService3', profile: 'level2' }] },
		)
		const viewer = await openIIIF(resp, 'https://iiif.test/v4/book/manifest')
		await waitFor(() => viewer.el.gallery !== undefined, 4000, 'the gallery controller')

		const { gallery } = viewer.el
		expect(gallery?._config.type).toBe('swipe')
		expect(gallery?._images.map((i) => i.$info.id)).toEqual(['0', '1'])
		expect(gallery?._images.every((i) => i.$info.isIIIF)).toBe(true)
		await waitFor(() => gallery?._images.every((i) => i._placed) === true, 4000, 'the child canvases')
		expect(viewer.el._engine._numTiles).toBeGreaterThan(0)
	})

	it('opens a multi-canvas manifest from the element id attribute', async () => {
		mockJson(
			/iiif\.test/,
			manifest(4, [
				canvas(canvasBody('https://iiif.test/v4/attr/0')),
				canvas(canvasBody('https://iiif.test/v4/attr/1')),
			]),
		)
		// No `open()` call: `_onMount` sees the http id and `#doPrint` resolves it
		const viewer = mount({ id: 'https://iiif.test/v4/attr/manifest' })
		await waitFor(() => viewer.el.$current?.album !== undefined, 4000, 'the album API')

		expect(viewer.el.gallery?._config.type).toBe('swipe')
		expect(viewer.el.gallery?._images).toHaveLength(2)
	})
})

describe('IIIF — one-canvas manifests become a single image', () => {
	it('falls back to a single image for a one-canvas v3 manifest', async () => {
		const viewer = await openIIIF(
			manifest(3, [canvas(canvasBody('https://iiif.test/v3/single/0'))]),
			'https://iiif.test/v3/single/manifest',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		expect(viewer.el.gallery).toBeUndefined()
		const image = viewer.el.$current
		// `MicrioImage.id` keeps the full service URL while `$info.id` is the short segment
		expect(image?.id).toBe('https://iiif.test/v3/single/0')
		expect(image?.$info.id).toBe('0')
		expect(image?.$info.path).toBe('https://iiif.test/v3/single')
		// The body's `…/full/max/0/default.jpg` URI is never used as the image id. This path
		// does not read the body `format` either, so a webp body still asks for jpg (the
		// Image API's required format) unless the service lists `preferredFormats`.
		expect(image?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/v3/single/0/0,0,512,512/512,512/0/default.jpg')
		await waitForImage(viewer)
	})

	it('sizes a one-canvas v4 manifest from the body, not the canvas', async () => {
		const viewer = await openIIIF(
			manifest(4, [
				// The official v4 artwork example: a 6000×3813 canvas painting a 2000×1271 image
				canvas(
					canvasBody('https://iiif.test/v4/artwork', {
						width: 2000,
						height: 1271,
						format: 'image/jpeg',
						service: { preferredFormats: ['webp', 'jpg'] },
					}),
					6000,
					3813,
				),
			]),
			'https://iiif.test/v4/artwork/manifest',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		const image = viewer.el.$current
		expect(image?.$info.width).toBe(2000)
		expect(image?.$info.height).toBe(1271)
		expect(image?.$info.preferredFormats).toEqual(['webp', 'jpg'])
		// The service's preferred format decides the image extension
		expect(image?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/v4/artwork/0,0,1024,1024/1024,1024/0/default.webp')
		await waitForImage(viewer)
	})
})

describe('IIIF Image API info.json', () => {
	it('opens an Image API 3.0 info.json (id / ImageService3)', async () => {
		const viewer = await openIIIF(
			{
				'@context': 'http://iiif.io/api/image/3/context.json',
				id: 'https://iiif.test/api3/1',
				type: 'ImageService3',
				protocol: 'http://iiif.io/api/image',
				profile: 'level2',
				width: 800,
				height: 600,
				tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4] }],
				preferredFormats: ['webp'],
			},
			'https://iiif.test/api3/1/info.json',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		expect(viewer.el.gallery).toBeUndefined()
		const image = viewer.el.$current
		expect(image?.$info.id).toBe('1')
		expect(image?.$info.path).toBe('https://iiif.test/api3')
		expect(image?.$info.width).toBe(800)
		expect(image?.$info.height).toBe(600)
		// The declared `tiles` are kept on the info even though the tile size stays 1024
		expect(image?.$info.tiles).toEqual([{ width: 512, height: 512, scaleFactors: [1, 2, 4] }])
		expect(image?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/api3/1/0,0,800,600/800,600/0/default.webp')
		await waitForImage(viewer)
	})

	it('falls back to the URL when an info.json carries no id', async () => {
		const viewer = await openIIIF(
			{ '@context': 'http://iiif.io/api/image/3/context.json', type: 'ImageService3', width: 640, height: 480 },
			'https://iiif.test/api3/2/info.json',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		// The image id is the request URL with its whole `info.json` suffix removed, so the
		// trailing slash goes too — keeping it stripped the id down to an empty segment.
		const image = viewer.el.$current
		expect(image?.$info.id).toBe('2')
		expect(image?.$info.path).toBe('https://iiif.test/api3')
		expect(image?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/api3/2/0,0,640,480/640,480/0/default.jpg')
	})

	it('opens an Image API 2.1 info.json (@id)', async () => {
		const viewer = await openIIIF(
			{
				'@context': 'http://iiif.io/api/image/2/context.json',
				'@id': 'https://iiif.test/api2/1',
				profile: 'http://iiif.io/api/image/2/level2.json',
				width: 800,
				height: 600,
				tiles: [{ width: 256, scaleFactors: [1, 2] }],
			},
			'https://iiif.test/api2/1/info.json',
		)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 4000, 'the IIIF image')

		// A v2 `info.json` is not a Presentation 2 manifest: it opens as one image, resolved
		// from `@id`, and defaults to jpg because it carries no `preferredFormats`
		const image = viewer.el.$current
		expect(image?.$info.id).toBe('1')
		expect(image?.$info.path).toBe('https://iiif.test/api2')
		expect(image?._getTileSrc(0, 0, 0)).toBe('https://iiif.test/api2/1/0,0,800,600/800,600/0/default.jpg')
	})
})

describe('IIIF — unsupported input', () => {
	it('reports a v2 manifest as unsupported', async () => {
		const viewer = await openIIIF({ '@type': 'sc:Manifest', sequences: [] }, 'https://iiif.test/v2/type/manifest')
		await expectError(viewer, 'Only IIIF Presentation API 3 manifests are supported')
	})

	it('reports a v2 manifest that only carries sequences', async () => {
		const viewer = await openIIIF(
			{ '@context': 'http://iiif.io/api/presentation/2/context.json', sequences: [] },
			'https://iiif.test/v2/sequences/manifest',
		)
		await expectError(viewer, 'Only IIIF Presentation API 3 manifests are supported')
	})

	it('reports a manifest without usable canvases', async () => {
		const viewer = await openIIIF({ type: 'Manifest', items: [] }, 'https://iiif.test/empty/manifest')
		await expectError(viewer, 'No valid IIIF canvases found in the manifest')
	})

	it('reports a manifest whose canvas bodies carry no Image API service', async () => {
		// The cookbook's minimal single-image example has no service: its body is a plain
		// PNG URI (https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json), and a
		// body whose dimensions are not numbers is dropped by the same narrowing.
		const viewer = await openIIIF(
			manifest(3, [
				canvas({ id: 'https://iiif.test/bad/image.png', type: 'Image', width: 1200, height: 1800 }),
				canvas({ id: 'https://iiif.test/bad/2.png', type: 'Image', width: '1200', height: 1800 }),
				canvas({ id: 'https://iiif.test/bad/3.png', type: 'Image', width: 10, height: 10, service: [] }),
			]),
			'https://iiif.test/bad/manifest',
		)
		await expectError(viewer, 'No valid IIIF canvases found in the manifest')
	})

	it('reports a document that is neither a manifest nor an info.json', async () => {
		// A IIIF Collection (or any other JSON) has no dimensions to render: without the
		// guard it becomes an image with undefined bounds and a silently blank viewer.
		const viewer = await openIIIF(
			{
				'@context': 'http://iiif.io/api/presentation/3/context.json',
				id: 'https://iiif.test/coll/1',
				type: 'Collection',
				items: [],
			},
			'https://iiif.test/coll/manifest',
		)
		await expectError(viewer, 'Not a valid IIIF manifest or Image API info.json')
	})

	it('reports a response whose dimensions are not numbers', async () => {
		const viewer = await openIIIF(
			{ id: 'https://iiif.test/string/1', width: '800', height: 600 },
			'https://iiif.test/string/1/info.json',
		)
		await expectError(viewer, 'Not a valid IIIF manifest or Image API info.json')
	})
})
