import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import { archive } from '$utils/archive'
import { baseInfo } from './bundles'
import { makeMdp, stubArchiveXhr } from './grid'
import { mockJson } from '../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'

/**
 * The book3d album harness.
 *
 * A book3d album is only ever built from a binary archive: `Gallery._fromAlbum`
 * takes the album's images from the archive's index JSON (read over
 * `XMLHttpRequest`, which the suite's `fetch` interception does not reach), and
 * `BookViewer` then reads each page's texture out of the same archive through
 * `archive._getImageById`. So the fixture has to give it both: a real,
 * tightly-packed MDP body containing one decodable thumbnail per image id (the
 * archive indexes images by the first path segment of an entry) and the album
 * index.
 *
 * The image ids must survive `decodeV5Id` as plain, non-360 raster images and
 * must be unique per fixture: `DataLoader`'s bundle/album caches are module-level
 * and keyed by id, so a reused id serves an earlier test's album.
 *
 * The archive stub is the grid fixture's, and it is deliberately not removed by
 * {@link openBook}: `#print`/`_openOn` are fire-and-forget, so an album can still
 * be resolving when the test moves on. Restore it in the suite's `afterEach`
 * (`restoreArchiveXhr()`).
 *
 * The gallery parent keeps its **empty id** and stays `$current` for the whole
 * book — that is the hop the book's draw hand-off uses to reach the marker layer.
 * A book test therefore asserts through the album accessors below (`bookAlbum`,
 * `scrubberTicks`, `bookMarkers`) rather than through `$current`.
 */

/** A decodable image body to store as each page's thumbnail (shared with `browser/book-helpers`). */
let thumbBlob: Promise<Uint8Array> | undefined

export async function thumbBytes(): Promise<Uint8Array> {
	thumbBlob ??= (async () => {
		const canvas = new OffscreenCanvas(8, 6)
		const ctx = canvas.getContext('2d')
		if (ctx) {
			ctx.fillStyle = '#f2e9d8'
			ctx.fillRect(0, 0, 8, 6)
		}
		const blob = await canvas.convertToBlob({ type: 'image/webp' })
		return new Uint8Array(await blob.arrayBuffer())
	})()
	return await thumbBlob
}

/**
 * A unique 7-character v5 id that `decodeV5Id` treats as a plain WebP raster
 * image. The leading `AN` is what carries those flags (see `gridImageId`); the
 * trailing three characters are a per-call base-36 counter so ids never collide.
 */
let fixtureTag = Math.floor(Math.random() * 36 ** 3)
const nextTag = (): string => {
	const tag = fixtureTag
	fixtureTag = (fixtureTag + 1) % 36 ** 3
	return tag.toString(36).padStart(3, '0')
}

export const bookImageId = (n: number, tag: string) => `AN${n.toString().padStart(2, '0')}${tag}`

export interface BookOptions {
	/** How many images the album has (a book of `ceil(count / 2)` pages). */
	count?: number
	/** Album settings, e.g. `{ allowRotation: false, individualAspects: true }`. */
	settings?: Record<string, unknown>
	/** How long to wait for the album to take over before giving up (ms). */
	albumTimeout?: number
}

export interface BookFixture {
	/** The `bundle.json` body: the album plus its images. */
	bundle: Models.ImageBundle.BundleResponse & { album: Models.GalleryConfig }
	ids: string[]
	albumId: string
	/** The archive id as the album names it (bare, no `g/` prefix). */
	archiveId: string
	mdp: ArrayBuffer
}

/** Builds a book3d album bundle plus the archive body it needs. */
export async function bookFixture(opts: BookOptions = {}): Promise<BookFixture> {
	const count = opts.count ?? 4
	const tag = nextTag()
	const albumId = `bookalbum${tag}`
	const archiveId = `book${tag}`
	const ids = Array.from({ length: count }, (_, i) => bookImageId(i, tag))
	const bytes = await thumbBytes()

	const images: Models.ImageBundle.BundleImage[] = ids.map((id, i) => ({
		id,
		info: { ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId },
		settings: { gallery: { archive: archiveId } },
		data: {
			markers: i === 0 ? [{ id: 'bm1', x: 0.5, y: 0.5, type: 'default', popupType: 'popup' }] : [],
		},
	}))

	const album: Models.GalleryConfig = {
		id: albumId,
		type: 'book3d',
		archive: archiveId,
		settings: { ...opts.settings },
	}

	// Everything `Gallery._fromAlbum` needs from the index, and what the book
	// layout reads (the image sizes give each page its aspect).
	const index = {
		images: ids.map((id) => ({ ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId })),
	}

	const files = [
		{ name: `${archiveId}.json`, data: new TextEncoder().encode(JSON.stringify(index)) },
		...ids.map((id, i) => ({ name: `${id}/1/${i}_0.webp`, data: bytes })),
	]

	return { bundle: { images, album }, ids, albumId, archiveId, mdp: makeMdp(files) }
}

export interface OpenBook {
	viewer: Viewer
	ids: string[]
	fixture: BookFixture
}

/**
 * Opens a book3d album through the element's **id attribute**.
 *
 * `#print()` is the only place an album becomes a gallery, and it runs only while
 * the element has not printed. The book arriving is the gate: `Gallery._loadBook3d`
 * runs once the gallery element mounts, which is after `#print` resolved.
 */
export async function openBook(opts: BookOptions = {}): Promise<OpenBook> {
	const fixture = await bookFixture(opts)
	archive.db.clear()
	mockJson(/bundle\.json/, fixture.bundle)
	stubArchiveXhr(fixture.mdp)

	const first = fixture.ids[0] ?? ''
	const viewer = mountViewer({ id: first }, 'width: 800px; height: 600px; display: block;')
	await viewer.open(first)
	try {
		// `_openOn` is fire-and-forget, so the gallery appears before its images and
		// its book viewer do; the parent image is `_placed` once the book is ready
		await waitFor(() => Boolean(viewer.el.gallery), opts.albumTimeout ?? 5000, 'the album')
		await waitFor(() => (viewer.el.gallery?._images.length ?? 0) > 0, 5000, 'the album images')
		await waitFor(() => viewer.el.$current?._placed === true, 8000, 'the book spread')
	} catch {
		throw new Error(
			`the book3d album never opened: ${JSON.stringify({
				current: viewer.el.$current?.id ?? null,
				gallery: viewer.el.gallery?._config?.type ?? null,
				albumId: fixture.albumId,
				archiveDb: [...archive.db.keys()],
			})}`,
		)
	}
	return { viewer, ids: fixture.ids, fixture }
}

/**
 * The `<micrio-marker>` elements the book's current spread renders.
 *
 * Only pages the book has drawn become visible, so a marker existing at all
 * proves the page's draw hand-off reached the marker layer.
 */
export function bookMarkers(el: HTMLMicrioElement): HTMLElement[] {
	return [...el.querySelectorAll<HTMLElement>('micrio-marker')]
}

/** The scrubber ticks the gallery printed: one per gallery page. */
export function scrubberTicks(el: HTMLMicrioElement): HTMLElement[] {
	return [...el.querySelectorAll<HTMLElement>('micrio-gallery ul > :nth-child(2) > span')]
}

/** The book's live album API, as exposed on the gallery parent. */
export function bookAlbum(el: HTMLMicrioElement): NonNullable<HTMLMicrioElement['$current']>['album'] {
	return el.$current?.album
}
