import type { Models } from '../../src/types/models'
import type { Grid } from '../../src/grid/grid'
import type { HTMLMicrioElement } from '../../src/core/element'
import { archive } from '../../src/utils/archive'
import { baseInfo } from './bundles'
import { mockJson } from '../helpers/network'

import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'
import { settle } from '../helpers/tour'
import { get } from '../../src/core/store'
import { DataLoader } from '../../src/utils/dataLoader'

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

/**
 * The live archive stub.
 *
 * It has to outlive `openGrid`: `#print()` is fire-and-forget, so an album can still be
 * resolving (over XHR) when the test that started it moves on. A stub restored at the end of
 * `openGrid` would let that in-flight album fall through to the real network, which 404s and
 * silently degrades the grid to a single image. One stub therefore serves the whole file, and
 * `restoreArchiveXhr()` (called from the suite's `afterEach`) removes it.
 */
let archiveXhrStub: { body: ArrayBuffer | undefined; status: number } | undefined
let archiveXhrOriginal: typeof XMLHttpRequest | undefined

/** Answers every XHR with `body` (or a failure when `status` is not 200) until restored. */
export function stubArchiveXhr(body: ArrayBuffer | undefined, status = 200): () => void {
	archiveXhrStub = { body, status }
	if (archiveXhrOriginal === undefined) {
		archiveXhrOriginal = globalThis.XMLHttpRequest
		class StubbedXhr extends FakeXhr {
			constructor() {
				super()
				this.body = archiveXhrStub?.body
				this.statusCode = archiveXhrStub?.status ?? 200
			}
		}
		globalThis.XMLHttpRequest = StubbedXhr as unknown as typeof XMLHttpRequest
	}
	return restoreArchiveXhr
}

/** Removes the archive stub installed by {@link stubArchiveXhr}. Safe to call repeatedly. */
export function restoreArchiveXhr(): void {
	if (archiveXhrOriginal !== undefined) {
		globalThis.XMLHttpRequest = archiveXhrOriginal
		archiveXhrOriginal = undefined
	}
	archiveXhrStub = undefined
}

/**
 * Image ids that survive `decodeV5Id` with predictable flags.
 *
 * Ids of 6-7 characters are treated as v5, and `decodeV5Id` overwrites `is360`, `isWebP`
 * and `isPng` from a character inside the id: index `1 + (getIdVal(id[0]) % 6)`, which is
 * index 1 for a leading `A`. `N` there decodes to a value with WebP on, 360 off and no
 * deep-zoom flag, so these are plain non-360 raster images — what a grid fixture wants. The
 * leading `AN` is what matters; the trailing characters only have to be distinct.
 *
 * A 7-character id leaves room for an image index plus a 3-character fixture tag, so every
 * fixture *must* pass a distinct `tag`. `DataLoader` caches bundles by image id and the shared
 * `jsonCache` caches by request URL for the whole file, so a reused id serves the earlier
 * test's album — and, worse, silently resolves its `info.albumId` while the current fixture
 * looks up its own album from the cache.
 */
export const gridImageId = (n: number, tag: string) => `AN${n.toString().padStart(2, '0')}${tag}`

/**
 * A unique 3-character fixture tag: a base-36 counter, so ids can never collide across calls
 * (a random 3-character tag does, with birthday probability, and would then serve a stale
 * bundle out of `jsonCache`). The start is randomised so the tag from a previous page load of
 * the same file is not reused, and it wraps well inside base-36's three digits.
 */
const TAG_RANGE = 36 * 36 * 36
let fixtureTag = Math.floor(Math.random() * TAG_RANGE)
const nextFixtureTag = (): string => {
	const tag = fixtureTag
	fixtureTag = (fixtureTag + 1) % TAG_RANGE
	return tag.toString(36).padStart(3, '0')
}

export interface GridOptions {
	/** How many images the album has. */
	count?: number
	/** Album-level settings: `grid`, `hookKeys`, `initType`, durations. */
	settings?: Record<string, unknown>
	/** Gallery-level grid config. */
	grid?: Models.GalleryConfig['grid']
	/** Per-image marker data, keyed by image index. */
	markers?: Record<number, Models.ImageData.Marker[]>
	/**
	 * Called with the generated image ids before the bundle is returned.
	 *
	 * Marker `_meta.gridAction` payloads name image ids, and those ids only exist once the fixture
	 * has made them. Building the markers here (from the ids the callback receives) keeps the
	 * markers and the album in one fixture; peeking at a fixture would spend a *different* id set.
	 */
	withIds?: (ids: string[]) => Partial<Record<number, Models.ImageData.Marker[]>>
	/** Per-image video tours, keyed by image index (what a step marker's tour is authored as). */
	tours?: Record<number, Models.ImageData.VideoTour[]>
	/** Marker tours, attached to the first image's data. */
	markerTours?: Models.ImageData.MarkerTour[]
	/** Fail the archive request, so the gallery has no images. */
	brokenArchive?: boolean
	/** Leave the archive index out of the body, so the album has no images. */
	missingIndex?: boolean
	/** How long to wait for the album to take over before giving up (ms). */
	albumTimeout?: number
	/**
	 * Assert that the album is expected *not* to open. Skips both gates and resolves with a
	 * {@link NoGrid}, so a degradation test can assert the failure *and* still destroy the
	 * element (a rejected `openGrid` would leave the viewer and its WebGL context behind).
	 */
	expectNoAlbum?: boolean
}

export interface GridFixture {
	bundle: Models.ImageBundle.BundleResponse & { album: Models.GalleryConfig }
	ids: string[]
	archiveId: string
	mdp: ArrayBuffer
}

/** Builds a grid album bundle plus the archive body it needs. */
export function gridFixture(opts: GridOptions = {}): GridFixture {
	const count = opts.count ?? 4
	const suffix = nextFixtureTag() + Math.random().toString(36).slice(2, 4)
	const albumId = `gridalbum${suffix}`
	const archiveId = `grid${suffix}`
	const ids = Array.from({ length: count }, (_, i) => gridImageId(i, suffix.slice(0, 3)))
	/**
	 * `archive.load(path, id)` keys every entry as `<path><entry name>`, and
	 * `Gallery.#getArchiveIndex` looks the index up as `<path><archive>.json` — with the album's
	 * **raw** archive id, which carries no `g/` prefix (the fetched archive *file* does, because
	 * `Gallery._fromAlbum` loads `g/<archive>`). So the entry name is the bare id plus `.json`.
	 * `info.path` must stay `https://r2.micr.io/` (`BASEPATH_V5`), which is what `_fromAlbum`
	 * resolves both paths from.
	 */
	const indexPath = `${archiveId}.json`

	const images: Models.ImageBundle.BundleImage[] = ids.map((id, i) => ({
		id,
		info: { ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId },
		settings: { gallery: { archive: archiveId } },
		data: {
			markers: opts.withIds?.(ids)[i] ?? opts.markers?.[i] ?? [],
			...(opts.tours?.[i] ? { tours: opts.tours[i] } : {}),
			...(i === 0 && opts.markerTours ? { markerTours: opts.markerTours } : {}),
		},
	}))

	// `Gallery._fromAlbum` prefers `config.grid.clickable` over `settings.grid.clickable`, so the
	// gallery-level value is what decides the controller's behaviour. The fixture only fills in
	// what the caller asks for: defaulting `panZoom` here would override the controller's own
	// default, which is `'grid'` only when the setting is absent.
	const settingsGrid = opts.settings?.grid as { clickable?: 'focus' | 'zoom' | false } | undefined
	const clickable = opts.grid?.clickable ?? settingsGrid?.clickable
	const panZoom = opts.grid?.panZoom
	const gridConfig: NonNullable<Models.GalleryConfig['grid']> = {
		...(clickable === undefined ? {} : { clickable }),
		...(panZoom === undefined ? {} : { panZoom }),
	}
	const album: Models.GalleryConfig = {
		id: albumId,
		type: 'grid',
		archive: archiveId,
		// `...opts.settings` first: it may carry a partial `grid` (a duration, an extra key), but
		// the fixture's own `clickable`/`panZoom` must win — `Gallery._fromAlbum` reads them off
		// this object to decide whether the grid is interactive at all.
		settings: { ...opts.settings, grid: { ...(settingsGrid as object), ...gridConfig } },
		grid: gridConfig,
	}

	// The index lists every image, which is what gives each cell its info and ordering
	const index = {
		images: ids.map((id) => ({ ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId })),
	}

	const mdp = makeMdp(
		opts.missingIndex ? [] : [{ name: indexPath, data: new TextEncoder().encode(JSON.stringify(index)) }],
	)

	// The archive *file* lives under `g/`, which is how `Gallery._fromAlbum` loads it; the
	// index entry inside it is keyed by bare name (see above).
	return { bundle: { images, album }, ids, archiveId: `g/${archiveId}`, mdp }
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
	gridEl: HTMLElement
	/** The live `Grid` controller (`gridEl` itself, typed). */
	grid: Grid
	ids: string[]
	fixture: GridFixture
}

/**
 * A viewer whose album was expected *not* to open (the `expectNoAlbum` fixtures): there is no
 * grid element and no controller, and the element has degraded to the plain first image.
 */
export interface NoGrid {
	viewer: Viewer
	gridEl: undefined
	grid: undefined
	ids: string[]
	fixture: GridFixture
}

/**
 * Waits for the grid controller the layout places under the `<micr-io>` element.
 *
 * The presence of the element is the signal, not the viewer's `_visible` list: these
 * fixtures serve no real tiles, so an image never becomes visible even though the grid is
 * fully laid out.
 */
export async function waitForGrid(el: Element, timeout = 8000): Promise<HTMLElement> {
	await waitFor(() => el.querySelector('micrio-grid') !== null, timeout, 'the grid element')
	const grid = el.querySelector<HTMLElement>('micrio-grid')
	if (!grid) {
		throw new Error('no grid element')
	}
	return grid
}

/**
 * Resolves the `Grid` controller of a mounted viewer.
 *
 * The controller is attached to the *parent* image by `Gallery._attach`, so it is not on the
 * grid element's attributes — it is either already on `$current`, or announced once through
 * `grid-init` (which `#print()` can fire before the element's `open()` resolves).
 */
export async function getGrid(viewer: HTMLMicrioElement, timeout = 8000): Promise<Grid> {
	const existing = viewer.$current?.grid
	if (existing) {
		return existing
	}
	const announced = new Promise<Grid | undefined>((ok) => {
		viewer.addEventListener(
			'grid-init',
			(e) => {
				if (e instanceof CustomEvent && e.detail) {
					ok(e.detail as Grid)
				}
			},
			{ once: true },
		)
	})
	const found =
		(await Promise.race([
			announced,
			waitFor(() => viewer.$current?.grid !== undefined, timeout, 'the grid controller').then(
				() => viewer.$current?.grid,
			),
		])) ?? undefined
	if (!found) {
		throw new Error('no grid controller')
	}
	return found
}

/**
 * Opens a grid album and waits until it has been laid out.
 *
 * The album is resolved through the element's **id attribute**, not through `open(id)`:
 * `#print()` is the only place an album becomes a gallery, and it runs only while the element
 * has not printed. `#print` is fire-and-forget and can finish *after* `open()` has resolved, so
 * opening the image is not enough — the gate has to be the album itself: the parent gallery
 * image is `#print`'s last step, so once `$current` is it, the gallery is attached and the
 * layout has built the grid.
 *
 * `opts.expectNoAlbum` is for the degenerate fixtures (a failed archive, a missing index) whose
 * whole point is that no album, and so no grid, ever arrives. It skips both gates and returns
 * the viewer with `grid: undefined`, so the test can assert the degradation *and* still destroy
 * the element — a rejected `openGrid` would leave that viewer (and its WebGL context) behind.
 *
 * The archive stub is deliberately **not** removed here: `#print` is fire-and-forget, so an
 * album can still be resolving when the test moves on, and a removed stub would send it to the
 * real network. Call `restoreArchiveXhr()` from the suite's `afterEach` instead.
 */
export async function openGrid(opts: GridOptions & { expectNoAlbum: true }): Promise<NoGrid>
export async function openGrid(opts?: GridOptions): Promise<OpenGrid>
export async function openGrid(opts: GridOptions = {}): Promise<OpenGrid | NoGrid> {
	const fixture = gridFixture(opts)
	archive.db.clear()
	mockJson(/bundle\.json/, fixture.bundle)
	stubArchiveXhr(fixture.mdp, opts.brokenArchive ? 404 : 200)

	const first = fixture.ids[0] ?? ''
	const viewer = mountViewer({ id: first }, 'width: 800px; height: 600px; display: block;')
	const failed: NoGrid = { viewer, gridEl: undefined, grid: undefined, ids: fixture.ids, fixture }

	if (opts.expectNoAlbum) {
		// Let `#print`'s album attempt fail and settle before reporting, so the test can assert
		// the degradation without racing it.
		await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish').catch(() => {})
		await settle(opts.albumTimeout ?? 300)
		return failed
	}

	await viewer.open(first)

	// The gallery image only exists once the album has been built, and `open(first)` cannot wait
	// for that. So wait for it, then open the first cell again — through the gallery's `gotoId`
	// path this time.
	try {
		await waitFor(() => Boolean(viewer.el.gallery), opts.albumTimeout ?? 4000, 'the album')
	} catch {
		// Report what the client actually did, instead of a bare timeout
		throw new Error(
			`the grid album never opened: ${JSON.stringify({
				current: viewer.el.$current?.id ?? null,
				gallery: viewer.el.gallery?._config?.type ?? null,
				albumId: fixture.bundle.album.id,
				albumFound: (fixture.bundle.album.id ? DataLoader._getAlbum(fixture.bundle.album.id)?.type : null) ?? null,
				first: first,
				archiveId: fixture.archiveId,
				archiveDb: [...archive.db.keys()],
				loading: get(viewer.el._loading),
			})}`,
		)
	}

	await viewer.open(first)
	await waitFor(() => !get(viewer.el._loading), 8000, 'loading to finish')

	const gridEl = await waitForGrid(viewer.el, 4000)
	const grid = await getGrid(viewer.el)
	await waitFor(() => grid.images.length > 0, 8000, 'the grid layout')
	return { viewer, gridEl, grid, ids: fixture.ids, fixture }
}
