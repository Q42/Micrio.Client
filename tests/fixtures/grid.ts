import type { Models } from '../../src/types/models'
import { archive } from '../../src/utils/archive'
import { baseInfo } from './bundles'
import { mockJson } from '../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'
import { get } from '../../src/core/store'

/**
 * The grid harness.
 *
 * A grid album is only ever built from a binary archive: `Gallery._fromAlbum` requires
 * `album.archive`, loads it over **XMLHttpRequest** (which the suite's `fetch`
 * interception does not reach) and then reads its index JSON through a `FileReader` over
 * a byte range. So the fixture packs a real, tightly-packed MDP body and stubs XHR —
 * the same two moving parts `tests/core/archive.test.ts` already exercises.
 *
 * Two caches force a fresh fixture per test: the archive's loaded bodies are private and
 * keyed by id, and `bundle`/`album`/`json` caches are module-level. Every image id, the
 * album id and the archive id must therefore be new for each call.
 */

/** Builds one 32-byte MDP header entry: 20 bytes of name, 12 bytes of octal size. */
export function mdpEntry(name: string, size: number): Uint8Array {
	const header = new Uint8Array(32)
	header.set(new TextEncoder().encode(name).subarray(0, 20), 0)
	header.set(new TextEncoder().encode(size.toString(8).padStart(11, '0')).subarray(0, 11), 20)
	return header
}

/** Concatenates headers plus payload bytes, mirroring the tightly-packed archive layout. */
export function makeMdp(files: { name: string; data?: Uint8Array }[]): ArrayBuffer {
	const chunks: Uint8Array[] = []
	let total = 0
	for (const file of files) {
		const data = file.data ?? new Uint8Array(0)
		chunks.push(mdpEntry(file.name, data.byteLength), data)
		total += 32 + data.byteLength
	}
	const out = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.byteLength
	}
	return out.buffer
}

/** Minimal `XMLHttpRequest` stand-in that answers `send()` immediately. */
class FakeXhr extends EventTarget {
	responseType = ''
	readyState = 1
	status = 200
	response: unknown = undefined
	body: ArrayBuffer | undefined = undefined
	statusCode = 200

	open(): void {
		this.readyState = 1
	}

	getResponseHeader(): string | null {
		return null
	}

	send(): void {
		this.readyState = 4
		this.status = this.statusCode
		this.response = this.statusCode === 200 ? this.body : undefined
		this.dispatchEvent(new Event('load'))
	}
}

/** Answers every XHR with the given body, or a failure status when not 200. */
export function stubArchiveXhr(body: ArrayBuffer | undefined, status = 200): () => void {
	const original = globalThis.XMLHttpRequest
	class StubbedXhr extends FakeXhr {
		constructor() {
			super()
			this.body = body
			this.statusCode = status
		}
	}
	globalThis.XMLHttpRequest = StubbedXhr as unknown as typeof XMLHttpRequest
	return () => {
		globalThis.XMLHttpRequest = original
	}
}

/**
 * Image ids that survive `decodeV5Id` with predictable flags.
 *
 * Ids of 6-7 characters are treated as v5, and `decodeV5Id` overwrites `is360`, `isWebP`
 * and `isPng` from a character inside the id. The character after the first (here the
 * `N`) decodes to a value with WebP on, 360 off and no deep-zoom flag, so these are plain
 * non-360 raster images — exactly what a grid fixture wants. Every id is 7 characters.
 */
export const gridImageId = (n: number) => `AN${n.toString().padStart(5, '0')}`

export interface GridOptions {
	/** How many images the album has. */
	count?: number
	/** Album-level settings: `grid`, `hookKeys`, `initType`, durations. */
	settings?: Record<string, unknown>
	/** Gallery-level grid config. */
	grid?: Models.GalleryConfig['grid']
	/** Per-image marker data, keyed by image index. */
	markers?: Record<number, Models.ImageData.Marker[]>
	/** Marker tours, attached to the first image's data. */
	markerTours?: Models.ImageData.MarkerTour[]
	/** Fail the archive request, so the gallery has no images. */
	brokenArchive?: boolean
	/** Leave the archive index out of the body, so the album has no images. */
	missingIndex?: boolean
}

export interface GridFixture {
	bundle: Models.ImageBundle.BundleResponse & { album: Models.GalleryConfig }
	ids: string[]
	archiveId: string
	indexPath: string
	mdp: ArrayBuffer
}

/** Builds a grid album bundle plus the archive body it needs. */
export function gridFixture(opts: GridOptions = {}): GridFixture {
	const count = opts.count ?? 4
	const suffix = Math.random().toString(36).slice(2, 7)
	const albumId = `gridalbum${suffix}`
	const archiveId = `grid${suffix}`
	const ids = Array.from({ length: count }, (_, i) => gridImageId(i))

	const images: Models.ImageBundle.BundleImage[] = ids.map((id, i) => ({
		id,
		info: { ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId },
		settings: { gallery: { archive: archiveId } },
		data: {
			markers: opts.markers?.[i] ?? [],
			...(i === 0 && opts.markerTours ? { markerTours: opts.markerTours } : {}),
		},
	}))

	const album: Models.GalleryConfig = {
		id: albumId,
		type: 'grid',
		archive: `${archiveId}.mdp`,
		settings: { grid: { clickable: 'focus', ...(opts.settings?.grid as object) }, ...opts.settings },
		grid: opts.grid ?? { clickable: 'focus', panZoom: 'grid' },
	}

	// The index lists every image, which is what gives each cell its info and ordering
	const index = {
		images: ids.map((id) => ({ ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId })),
	}

	/**
	 * `archive.load(path, id)` keys the index as `<path><entry name>` while
	 * `_fromAlbum` looks it up as `<path><id>.json`, and it loads the archive itself with
	 * the same `id`. So the id has to carry the `g/` prefix the album's archive path
	 * implies, exactly as the production data does.
	 */
	const basePath = new URL(images[0]?.info.path ?? 'https://r2.micr.io/').href
	const archiveKey = `g/${archiveId}`
	const indexPath = `${basePath}${archiveId}.json`
	const mdp = makeMdp(
		opts.missingIndex ? [] : [{ name: `${archiveId}.json`, data: new TextEncoder().encode(JSON.stringify(index)) }],
	)

	return { bundle: { images, album }, ids, archiveId: archiveKey, indexPath, mdp }
}

/**
 * A mounted grid album.
 *
 * `viewer` is the mounted `Viewer` (so `openGrid().viewer.el` works), matching the
 * shape of the space fixture's `openSpace`.
 */
export interface OpenGrid {
	viewer: Viewer
	/** The `<micrio-grid>` element the layout placed under the viewer. */
	grid: HTMLElement
	ids: string[]
	fixture: GridFixture
}

/** Waits for the grid controller the layout places under the `<micr-io>` element. */
export async function waitForGrid(el: Element, timeout = 8000): Promise<HTMLElement> {
	await waitFor(() => el.querySelector('micrio-grid') !== null, timeout, 'the grid element')
	const grid = el.querySelector<HTMLElement>('micrio-grid')
	if (!grid) {
		throw new Error('no grid element')
	}
	return grid
}

/**
 * Opens a grid album and waits until it is laid out.
 *
 * `grid-load` is the signal the client itself treats as "the initial `set()` resolved and
 * the hooks are wired" (see `templates/grid/README.md`), which is the state every test
 * wants to start from.
 */
export async function openGrid(opts: GridOptions = {}): Promise<OpenGrid> {
	const fixture = gridFixture(opts)
	archive.db.clear()
	mockJson(/bundle\.json/, fixture.bundle)
	const restoreXhr = stubArchiveXhr(fixture.mdp, opts.brokenArchive ? 404 : 200)

	// The album is resolved by the element's *id attribute* (see `#print`), not by
	// `open(id)`: that path calls `#print()` only while it has not printed yet, and it is
	// the only place an album is turned into a gallery. `mountViewer` sets the attribute.
	const first = fixture.ids[0] ?? ''
	const viewer = mountViewer({ id: first }, 'width: 800px; height: 600px; display: block;')
	await viewer.open(first)
	await waitFor(() => viewer.el.gallery !== undefined, 8000, 'the album gallery')
	await waitFor(() => get(viewer.el._loading) === false, 8000, 'loading to finish')

	// The archive stub has to stay installed until the grid itself has been built: the
	// gallery reads the archive index asynchronously, after `open()` has resolved
	const grid = await waitForGrid(viewer.el)
	restoreXhr()
	return { viewer, grid, ids: fixture.ids, fixture }
}
