import { afterEach, describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { Grid } from '$grid/grid'
import { modernBundle } from '../../fixtures/bundles'
import { waitFor } from '../../helpers/viewer'
import { settle } from '../../helpers/tour'
import { restoreArchiveXhr } from '../../fixtures/grid'
import type { AlbumOptions } from '../../fixtures/albums'
import {
	albumOf,
	awaitAlbum,
	awaitNoAlbum,
	destroyAlbums,
	galleryEl,
	mountAlbum,
	scrubberTicks,
} from '../../fixtures/albums'

/**
 * The album layer every album type shares: how the element turns a bundle's
 * `albumId` into a `Gallery`, which parts of the album config it honours, and
 * how it degrades when that fails.
 *
 * Real album *viewing* (the swipe/switch UIs, the scrubber and omni) lives in
 * the sibling suites; here the gallery only has to exist and be configured.
 */

afterEach(() => {
	destroyAlbums()
	restoreArchiveXhr()
})

describe('album resolution', () => {
	it('builds the gallery from the archive index, not the bundle image list', async () => {
		const mounted = mountAlbum({ count: 3 })
		const { viewer, ids } = mounted
		const { fixture } = mounted
		await awaitAlbum(mounted)

		expect(viewer.el.gallery?._config.type).toBe('swipe')
		expect(viewer.el.gallery?._images.map((i) => i.id)).toEqual(ids)
		// The album API is announced through the album's own index, not the bundle
		expect(albumOf(viewer.el)?.info?.id).toBe(fixture.albumId)
		// The gallery parent is a virtual canvas: no id, no tiles
		expect(viewer.el.$current?.id).toBe('')
		expect(viewer.el.$current?.album).toBe(albumOf(viewer.el))
	})

	it('falls back to the swipe type when the album has none', async () => {
		const mounted = mountAlbum({ count: 2 })
		// The fixture's album carries a type; removing it is what `_fromAlbum` sees
		delete mounted.fixture.bundle.album.type
		await awaitAlbum(mounted)
		expect(mounted.viewer.el.gallery?._config.type).toBe('swipe')
	})

	it('does not build an album when the element has a width or height attribute', async () => {
		// `#print` only takes the album branch without an explicit size: an author
		// who pins the element's size wants one image, not a gallery
		const mounted = mountAlbum({ count: 3 }, 0, { width: '800' })
		await awaitNoAlbum(mounted)

		expect(mounted.viewer.el.gallery).toBeUndefined()
		expect(mounted.viewer.el.$current?.id).toBe(mounted.mountId)
		expect(mounted.viewer.el.$current?.album).toBeUndefined()
	})
})

describe('album open race', () => {
	it('builds the album before an explicit open issued while printing', async () => {
		// Mounting starts `#print`; a page can call `open(id)` in the same tick. That
		// open has to wait for the print, or it races the album and builds a second
		// top-level canvas for the same image
		const mounted = mountAlbum({ count: 3 })
		const opened = mounted.viewer.open(mounted.mountId)

		await awaitAlbum(mounted)
		await opened

		// Only the gallery's virtual parent
		expect(mounted.viewer.el._canvases).toHaveLength(1)
		expect(mounted.viewer.el.$current?.id).toBe('')

		const album = albumOf(mounted.viewer.el)
		expect(album?.currentIndex).toBe(0)
		album?.next()
		await waitFor(() => albumOf(mounted.viewer.el)?.currentIndex === 1, 4000, 'the second page')
	})
})

describe('album without an archive', () => {
	it('attaches an empty gallery and prints no UI at all', async () => {
		// Every album type reads its images from the archive index, so an album
		// without an archive resolves to zero images — and `#renderGallery` bails
		// before it sets the album API, leaving the viewer with nothing
		const mounted = mountAlbum({ count: 3, archive: null })
		await awaitAlbum(mounted, { gate: 'gallery' })

		const { gallery } = mounted.viewer.el
		expect(gallery).toBeDefined()
		expect(gallery?._images).toHaveLength(0)
		expect(galleryEl(mounted.viewer.el)).not.toBeNull()
		expect(scrubberTicks(mounted.viewer.el)).toHaveLength(0)
		expect(mounted.viewer.el.$current?.album).toBeUndefined()
	})
})

describe('album start page', () => {
	it('lets the element id win when the album contains it', async () => {
		// `#print` passes the element's own id as `_fromAlbum`'s `startId`; when the
		// album lists that image, it is the page to open
		const mounted = mountAlbum({ count: 4, startIndex: 2 })
		await awaitAlbum(mounted)
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(0)
		expect(albumOf(mounted.viewer.el)?.info?.startId).toBe(mounted.mountId)
	})

	it('falls back to the album startId when the element id is not in the album', async () => {
		// The mounted image is left out of the index, so the album's own startId is
		// the author's intent — previously that setting was unreachable
		const mounted = mountAlbum({ count: 3, startIndex: 2, omitFromIndex: [0] })
		await awaitAlbum(mounted)

		expect(mounted.viewer.el.gallery?._images.map((i) => i.id)).toEqual([mounted.ids[1], mounted.ids[2]])
		expect(albumOf(mounted.viewer.el)?.info?.startId).toBe(mounted.ids[2])
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(1)
	})

	it('starts on the page of the element id', async () => {
		// `#print` passes the element's own id as the album's startId
		const mounted = mountAlbum({ count: 4 }, 3)
		await awaitAlbum(mounted)
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(3)
	})

	it('clamps an unknown startId to the first page', async () => {
		const mounted = mountAlbum({ count: 3, startId: 'zzzzzzz' })
		await awaitAlbum(mounted)
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(0)

		// ...also when the element id is not part of the album either
		const omitted = mountAlbum({ count: 3, startId: 'zzzzzzz', omitFromIndex: [0] })
		await awaitAlbum(omitted)
		expect(albumOf(omitted.viewer.el)?.currentIndex).toBe(0)
	})
})

/** Index images in reverse `created` order, so any sort has to move something. */
const reverseCreated: AlbumOptions['index'] = (_id, i) => ({ created: 30 - i * 10, title: `t${i}` })
const named: AlbumOptions['index'] = (_id, i) => ({ title: ['b', 'a', 'c'][i] })

describe('album sorting', () => {
	it('keeps the index order when no sort is set', async () => {
		const mounted = mountAlbum({ count: 3, index: reverseCreated })
		const { ids } = mounted
		await awaitAlbum(mounted)
		expect(mounted.viewer.el.gallery?._images.map((i) => i.id)).toEqual(ids)
	})

	it('sorts by created ascending and descending', async () => {
		const asc = mountAlbum({ count: 3, sort: 'created', index: reverseCreated })
		await awaitAlbum(asc)
		expect(asc.viewer.el.gallery?._images.map((i) => i.id)).toEqual([asc.ids[2], asc.ids[1], asc.ids[0]])

		const desc = mountAlbum({ count: 3, sort: '-created', index: reverseCreated })
		await awaitAlbum(desc)
		expect(desc.viewer.el.gallery?._images.map((i) => i.id)).toEqual([desc.ids[0], desc.ids[1], desc.ids[2]])
	})

	it('sorts by title', async () => {
		const asc = mountAlbum({ count: 3, sort: 'name', index: named })
		await awaitAlbum(asc)
		expect(asc.viewer.el.gallery?._images.map((i) => i.id)).toEqual([asc.ids[1], asc.ids[0], asc.ids[2]])

		const desc = mountAlbum({ count: 3, sort: '-name', index: named })
		await awaitAlbum(desc)
		expect(desc.viewer.el.gallery?._images.map((i) => i.id)).toEqual([desc.ids[2], desc.ids[0], desc.ids[1]])
	})

	it('keeps every image for a random sort', async () => {
		const mounted = mountAlbum({ count: 4, sort: 'random' })
		await awaitAlbum(mounted)
		const sorted = mounted.viewer.el.gallery?._images.map((i) => i.id) ?? []
		expect([...sorted].sort()).toEqual([...mounted.ids].sort())
	})
})

describe('spread layout', () => {
	it('lays cover pages out singly and the rest in spreads', async () => {
		const mounted = mountAlbum({ count: 5, isSpreads: true, coverPages: 1 })
		await awaitAlbum(mounted)
		expect(mounted.viewer.el.gallery?._getPageLayout().pages).toEqual([[0], [1, 2], [3, 4]])
	})

	it('pairs every image when there are no cover pages', async () => {
		const mounted = mountAlbum({ count: 4, isSpreads: true, coverPages: 0 })
		await awaitAlbum(mounted)
		expect(mounted.viewer.el.gallery?._getPageLayout().pages).toEqual([
			[0, 1],
			[2, 3],
		])
	})
})

describe('archive layer offset', () => {
	it('propagates the index delta to every child image', async () => {
		// An index delta means the archive's levels are shifted: the child images
		// have to advertise the archive and carry the offset, which also adjusts
		// their level count (512px @ 256 => 2 levels, minus 1 for the archive)
		const mounted = mountAlbum({ count: 2, delta: 0 })
		await awaitAlbum(mounted)
		const child = mounted.viewer.el.gallery?._images[0]
		expect(child?.$settings.gallery?.archive).toBe(true)
		expect(child?.$settings.gallery?.archiveLayerOffset).toBe(0)
		expect(child?._levels).toBe(1)
	})

	it('leaves the level count alone without a delta', async () => {
		const mounted = mountAlbum({ count: 2 })
		await awaitAlbum(mounted)
		const child = mounted.viewer.el.gallery?._images[0]
		expect(child?.$settings.gallery?.archive).toBeUndefined()
		expect(child?._levels).toBe(2)
	})
})

describe('grid albums', () => {
	it('builds the grid controller and injects the interactive defaults', async () => {
		const mounted = mountAlbum({ type: 'grid', count: 3, grid: { clickable: 'focus' } })
		await awaitAlbum(mounted, { gate: 'grid' })

		const { viewer } = mounted
		expect(viewer.el.gallery?._config.type).toBe('grid')
		expect(viewer.el.$current?.grid).toBeInstanceOf(Grid)
		expect(viewer.el.$current?.grid?._images).toHaveLength(3)
		// A clickable grid hooks the keyboard itself, and the album adds its own defaults
		expect(viewer.el.gallery?._config.settings).toMatchObject({ hookKeys: true, zoomLimit: 15, minimap: false })
		// A grid never renders the album UI, so it has no album API either
		expect(galleryEl(viewer.el)).toBeNull()
		expect(viewer.el.$current?.album).toBeUndefined()
	})

	it('reads clickable from the nested settings when the gallery has none', async () => {
		const mounted = mountAlbum({ type: 'grid', count: 2, settings: { grid: { clickable: 'zoom' } } })
		await awaitAlbum(mounted, { gate: 'grid' })
		expect(mounted.viewer.el.gallery?._config.settings).toMatchObject({ hookKeys: true })
	})

	it('never overrides an explicit hookKeys', async () => {
		const mounted = mountAlbum({
			type: 'grid',
			count: 2,
			grid: { clickable: 'focus' },
			settings: { hookKeys: false },
		})
		await awaitAlbum(mounted, { gate: 'grid' })
		expect(mounted.viewer.el.gallery?._config.settings?.hookKeys).toBe(false)
	})

	it('leaves a non-grid album settings untouched', async () => {
		const mounted = mountAlbum({ count: 2, settings: { custom: 1 } })
		await awaitAlbum(mounted)
		expect(mounted.viewer.el.gallery?._config.settings).toEqual({ custom: 1 })
	})
})

describe('album degradation', () => {
	it('falls back to the single image when the archive request fails', async () => {
		const mounted = mountAlbum({ count: 3, brokenArchive: true })
		await awaitNoAlbum(mounted)
		expect(mounted.viewer.el.gallery).toBeUndefined()
		expect(mounted.viewer.el.$current?.id).toBe(mounted.mountId)
	})

	it('falls back to the single image when the archive has no index', async () => {
		const mounted = mountAlbum({ count: 3, missingIndex: true })
		await awaitNoAlbum(mounted)
		expect(mounted.viewer.el.gallery).toBeUndefined()
		expect(mounted.viewer.el.$current?.id).toBe(mounted.mountId)
	})

	it('injects no grid defaults into a grid album without an archive', async () => {
		// The interactive defaults are gated on `aInfo.type === 'grid' && aInfo.archive`
		const mounted = mountAlbum({ type: 'grid', count: 2, archive: null })
		await awaitAlbum(mounted, { gate: 'grid' })
		expect(mounted.viewer.el.gallery?._config.settings?.hookKeys).toBeUndefined()
		expect(mounted.viewer.el.gallery?._config.settings?.zoomLimit).toBeUndefined()
		expect(mounted.viewer.el.$current?.grid).toBeInstanceOf(Grid)
	})
})

describe('a one-image album', () => {
	it('prints a gallery but no scrubber', async () => {
		const mounted = mountAlbum({ count: 1 })
		await awaitAlbum(mounted)
		expect(albumOf(mounted.viewer.el)?.numPages).toBe(1)
		expect(scrubberTicks(mounted.viewer.el)).toHaveLength(0)
	})
})

describe('gallery parent survival', () => {
	it('is not faded out by another image opening on top of it', async () => {
		// `open(bundle)` has no gallery short-circuit, so it builds a second
		// top-level canvas. That canvas fading in must not fade out the gallery
		// parent: hidden, the parent stops stepping its children and any awaited
		// strip animation stays pending forever.
		const mounted = mountAlbum({ count: 3 })
		const { viewer } = await awaitAlbum(mounted)
		const parent = viewer.el._canvases.find((c) => c.album)
		if (!parent?.album) {
			throw new Error('no gallery parent')
		}

		await viewer.open(modernBundle())
		const next = viewer.el._canvases.find((c) => c !== parent)
		if (!next) {
			throw new Error('the second image never opened')
		}
		await waitFor(() => get(next.visible), 4000, 'the opened image to draw')
		await settle(2)

		// The real fade-in already ran; calling it again keeps the assertion honest
		next.canvas?._fadeIn()
		expect(parent.canvas?._targetOpacity).toBe(1)

		// ...and the strip still animates to completion
		await parent.album.goto(1)
		await waitFor(() => parent.album?.currentIndex === 1, 6000, 'the strip slide')
	})
})
