import { afterEach, describe, expect, it } from 'vitest'
import { albumOf } from '../../fixtures/albums'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'

/**
 * The opt-in live IIIF suite (`MICRIO_LIVE=1 pnpm run test:browser:live`).
 *
 * The offline suite serves hand-built manifests, so it pins what the client *does* with
 * a shape; this one points the viewer at real documents published by the IIIF consortium
 * and checks that the tile URLs it derives from them actually resolve. Manifests and
 * `info.json` are fetched over the real network; pixels still come from the texture
 * worker fake installed by the browser setup, which is why every test fetches a derived
 * tile URL itself instead of asserting on decoded frames.
 *
 * All four documents are CORS-open (`access-control-allow-origin: *`) and their example
 * image services answer arbitrary Image API regions/sizes.
 */

const live = __MICRIO_LIVE__

const P3_COOKBOOK = 'https://iiif.io/api/cookbook/recipe/0005-image-service/manifest.json'
const P4_ARTWORK = 'https://iiif.io/api/presentation/4.0/example/uc01_artwork.json'
const P4_BOOK = 'https://iiif.io/api/presentation/4.0/example/uc02_book.json'
const IMAGE_API_3 =
	'https://iiif.io/api/image/3.0/example/reference/421e65be2ce95439b3ad6ef1f2ab87a9-dee-natural/info.json'

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

/** Asserts that a derived Image API tile URL is a real, fetchable image. */
async function expectRealTile(src: string | undefined): Promise<void> {
	expect(src).toBeTruthy()
	const response = await fetch(src ?? '')
	expect(response.ok).toBe(true)
	expect(response.headers.get('content-type')?.startsWith('image/')).toBe(true)
}

describe('live IIIF', () => {
	it('opens a real Presentation 3 manifest and its Image API tiles', async () => {
		if (!live) {
			return
		}
		const viewer = mount()
		await viewer.open(P3_COOKBOOK)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 20000, 'the IIIF image')

		const image = viewer.el.$current
		expect(viewer.el.gallery).toBeUndefined()
		expect(image?.$info.width).toBe(4032)
		expect(image?.$info.height).toBe(3024)
		await expectRealTile(image?._getTileSrc(0, 0, 0))
	})

	it('opens the official Presentation 4.0 single-canvas example', async () => {
		if (!live) {
			return
		}
		const viewer = mount()
		await viewer.open(P4_ARTWORK)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 20000, 'the IIIF image')

		// The canvas is 6000×3813 but the painted image is 2000×1271
		const image = viewer.el.$current
		expect(image?.$info.width).toBe(2000)
		expect(image?.$info.height).toBe(1271)
		await expectRealTile(image?._getTileSrc(0, 0, 0))
	})

	it('opens the official Presentation 4.0 multi-canvas book example as an album', async () => {
		if (!live) {
			return
		}
		const viewer = mount()
		await viewer.open(P4_BOOK)
		await waitFor(() => viewer.el.gallery !== undefined, 20000, 'the gallery controller')

		const { gallery } = viewer.el
		expect(gallery?._config.type).toBe('swipe')
		expect(albumOf(viewer.el)?.numPages).toBe(5)
		await expectRealTile(gallery?._images[0]?._getTileSrc(0, 0, 0))
	})

	it('opens a real Image API 3.0 info.json', async () => {
		if (!live) {
			return
		}
		const viewer = mount()
		await viewer.open(IMAGE_API_3)
		await waitFor(() => viewer.el.$current?.$info.isIIIF === true, 20000, 'the IIIF image')

		const image = viewer.el.$current
		expect(image?.$info.path).toBe('https://iiif.io/api/image/3.0/example/reference')
		await expectRealTile(image?._getTileSrc(0, 0, 0))
	})
})
