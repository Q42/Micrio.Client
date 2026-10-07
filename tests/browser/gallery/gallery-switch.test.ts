import { afterEach, describe, expect, it } from 'vitest'
import { restoreArchiveXhr } from '../../fixtures/grid'
import { albumOf, awaitAlbum, destroyAlbums, mountAlbum, press, scrubberTicks } from '../../fixtures/albums'
import type { AlbumOptions, OpenAlbum } from '../../fixtures/albums'
import { waitFor } from '../../helpers/viewer'

/**
 * The switch album: every image embedded on the shared virtual canvas, placed
 * by `fitArea` (contain) into its spread slot, with the album API and keyboard
 * driving the active embed.
 */

afterEach(() => {
	destroyAlbums()
	restoreArchiveXhr()
})

async function openSwitch(count: number, opts: AlbumOptions = {}): Promise<OpenAlbum> {
	const mounted = mountAlbum({ ...opts, type: 'switch', count })
	return await awaitAlbum(mounted)
}

describe('switch album — layout', () => {
	it('opens on a virtual parent with all images embedded', async () => {
		const { viewer, ids } = await openSwitch(3)
		const { gallery } = viewer.el
		expect(gallery?._config.type).toBe('switch')
		expect(viewer.el.$current?.id).toBe('')
		expect(albumOf(viewer.el)?.numPages).toBe(3)
		expect(gallery?._images.map((i) => i.id)).toEqual(ids)
		expect(scrubberTicks(viewer.el)).toHaveLength(3)
		// The active embed is the first page's image
		expect(viewer.el.$current?.canvas?._activeImageIdx).toBe(0)
	})

	it('shares the parent camera with every child', async () => {
		const { viewer } = await openSwitch(3)
		const { $current: parent } = viewer.el
		const { gallery } = viewer.el
		expect(parent?.camera).toBeDefined()
		for (const image of gallery?._images ?? []) {
			expect(image.camera).toBe(parent?.camera)
			expect(image.opts.isEmbed).toBe(true)
			expect(image.opts.useParentCamera).toBe(true)
		}
	})

	it('fits each image into the container while keeping its aspect', async () => {
		// The container is sized to the largest image (512x512), so a 512x256
		// image is letterboxed instead of stretched
		const { viewer } = await openSwitch(3, {
			index: (_id, i) => ({ width: 512, height: [256, 512, 256][i] }),
		})
		const areas = (viewer.el.gallery?._images ?? []).map((i) => i.opts.area)
		expect(areas[0]).toEqual([0, 0.25, 1, 0.5])
		expect(areas[1]).toEqual([0, 0, 1, 1])
		expect(areas[2]).toEqual([0, 0.25, 1, 0.5])
	})

	it('lays a spread out as a left and a right page', async () => {
		const { viewer } = await openSwitch(2, { isSpreads: true, coverPages: 0 })
		const [left, right] = viewer.el.gallery?._images ?? []
		// The left page ends on the centre line, the right one starts there
		expect(left?.opts.area?.[0]).toBeCloseTo(0, 6)
		expect((left?.opts.area?.[0] ?? 0) + (left?.opts.area?.[2] ?? 0)).toBeCloseTo(0.5, 6)
		expect(right?.opts.area?.[0]).toBeCloseTo(0.5, 6)
		expect(right?.opts.area?.[2]).toBeCloseTo(0.5, 6)
	})

	it('centres a lone cover and the last unpaired page', async () => {
		// 4 images, one cover: [0], [1,2], [3] — both single pages are centred
		const { viewer } = await openSwitch(4, { isSpreads: true, coverPages: 1 })
		const { gallery } = viewer.el
		expect(gallery?._getPageLayout().pages).toEqual([[0], [1, 2], [3]])
		expect(gallery?._images[0]?.opts.area).toEqual([0.25, 0, 0.5, 1])
		expect(gallery?._images[3]?.opts.area).toEqual([0.25, 0, 0.5, 1])
	})
})

describe('switch album — navigation', () => {
	it('switches the active embed through the album API', async () => {
		const { viewer } = await openSwitch(3)
		const album = albumOf(viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		await album.goto(2)
		expect(album.currentIndex).toBe(2)
		expect(viewer.el.$current?.canvas?._activeImageIdx).toBe(2)

		album.prev()
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')
		expect(viewer.el.$current?.canvas?._activeImageIdx).toBe(1)

		album.next()
		await waitFor(() => album.currentIndex === 2, 4000, 'the third page')
	})

	it('moves to the first image of a spread page', async () => {
		const { viewer } = await openSwitch(4, { isSpreads: true, coverPages: 1 })
		const album = albumOf(viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		await album.goto(1)
		expect(album.currentIndex).toBe(1)
		// The spread page [1,2] activates its first image
		expect(viewer.el.$current?.canvas?._activeImageIdx).toBe(1)

		// Navigating to the image index on the same page is a no-op for the page
		const image = await album.goto(2)
		expect(image?.id).toBe(viewer.el.gallery?._images[2]?.id)
		expect(album.currentIndex).toBe(1)
	})

	it('reports both page ids for a spread', async () => {
		const mounted = mountAlbum({ type: 'switch', count: 3, isSpreads: true, coverPages: 1 })
		const shown: string[][] = []
		mounted.viewer.el.addEventListener('gallery-show', (e) => {
			if (e instanceof CustomEvent) {
				shown.push(e.detail as string[])
			}
		})
		const { viewer, ids } = await awaitAlbum(mounted)

		expect(shown.at(-1)).toEqual([ids[0]])
		albumOf(viewer.el)?.next()
		await waitFor(() => albumOf(viewer.el)?.currentIndex === 1, 4000, 'the spread page')
		expect(shown.at(-1)).toEqual([ids[1], ids[2]])
	})

	it('navigates with the keyboard', async () => {
		const { viewer } = await openSwitch(3)
		const album = albumOf(viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		press('ArrowRight')
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')
		press('End')
		await waitFor(() => album.currentIndex === 2, 4000, 'the last page')
		press('Home')
		await waitFor(() => album.currentIndex === 0, 4000, 'the first page')
	})
})
