import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { mountViewer, waitFor } from '../../helpers/viewer'
import { albumBundle } from '../../fixtures/bundles'
import { mockJson } from '../../helpers/network'

/** The album/wide surface is fetched through the image's own bundle, like a real album page. */
let run = 0
function freshAlbum() {
	const suffix = (++run).toString().padStart(3, '0')
	const bundle = albumBundle()
	for (const [index, image] of bundle.images.entries()) {
		const next = `${suffix}img${index}`
		image.id = next
		image.info.id = next
	}
	if (bundle.album) {
		bundle.album.id = `album-${suffix}`
	}
	return bundle
}

async function openAlbum() {
	const bundle = freshAlbum()
	mockJson(/bundle\.json/, bundle)
	const viewer = mountViewer()
	const first = bundle.images[0]
	if (!first) {
		throw new Error('album fixture missing images')
	}
	await viewer.open(first.id)
	await waitFor(() => viewer.el.$current?.id === first.id, 4000, 'first image')
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	return { viewer, bundle, ids: bundle.images.map((i) => i.id) }
}

describe('gallery', () => {
	it('opens the album image even when an album is attached', async () => {
		const { viewer, ids } = await openAlbum()
		expect(viewer.el.$current?.id).toBe(ids[0])
		viewer.destroy()
	})

	it('exposes the album data on the image info', async () => {
		const { viewer, bundle } = await openAlbum()
		expect(viewer.el.$current?.$info.albumId ?? bundle.album?.id).toBeDefined()
		viewer.destroy()
	})

	it('can switch to the second image of the album bundle', async () => {
		const { viewer, ids } = await openAlbum()
		await viewer.open(ids[1] ?? '')
		await waitFor(() => viewer.el.$current?.id === ids[1], 4000, 'second image')
		expect(viewer.el.$current?.id).toBe(ids[1])
		viewer.destroy()
	})

	it('keeps images independent when no gallery controller is attached', async () => {
		const { viewer, ids } = await openAlbum()
		expect(viewer.el.gallery).toBeUndefined()
		const firstCanvas = viewer.el.$current
		await viewer.open(ids[1] ?? '')
		await waitFor(() => viewer.el.$current?.id === ids[1], 4000, 'second image')
		expect(viewer.el.$current).not.toBe(firstCanvas)
		viewer.destroy()
	})
})
