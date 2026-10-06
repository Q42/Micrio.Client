import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import { archive } from '$utils/archive'
import { get } from '$core/store'
import { baseInfo } from './bundles'
import { gridImageId, makeMdp, stubArchiveXhr } from './grid'
import { mockJson } from '../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'
import { settle } from '../helpers/tour'

/**
 * The album harness.
 *
 * Every album type takes its image list from a binary archive index:
 * `Gallery._fromAlbum` reads `index.images` and pushes them through
 * `#getArchiveIndex`, so even a `swipe` or `switch` album needs an archive — a
 * gallery without one has zero images and `#renderGallery` returns before it
 * sets the album API on the parent image.
 *
 * The archive only has to carry the index entry: tiles go through the
 * texture-worker fake, because `engine._getTexture` consults `archive` only when
 * the exact tile URL is a db key.
 *
 * Two caches force a fresh fixture per call: `archive.db` is cleared per mount,
 * and `DataLoader`'s bundle/album caches plus the shared `jsonCache` are
 * module-level, so every image id, album id and archive id must be new. The
 * per-call base-36 tag does that (the pattern `book.ts` and `grid.ts` use).
 */

/** A unique 3-character fixture tag, so no two fixtures share an id. */
const TAG_RANGE = 36 * 36 * 36
let fixtureTag = Math.floor(Math.random() * TAG_RANGE)
const nextTag = (): string => {
	const tag = fixtureTag
	fixtureTag = (fixtureTag + 1) % TAG_RANGE
	return tag.toString(36).padStart(3, '0')
}

export interface AlbumOptions {
	/** How many images the album has (kept under 100 so `gridImageId` stays 7 chars). */
	count?: number
	/** Gallery type. Defaults to `swipe` (the type `_fromAlbum` falls back to). */
	type?: 'swipe' | 'switch' | 'grid'
	/** Start on the page containing this image id. */
	startId?: string
	/** Index into `ids` for the album's `startId` (resolved after the ids exist). */
	startIndex?: number
	isSpreads?: boolean
	coverPages?: number
	sort?: Models.GalleryConfig['sort']
	/** Archive index `delta`, propagated to the child images as `gallery.archiveLayerOffset`. */
	delta?: number
	/** Album archive id; `null` builds an album with no archive at all. */
	archive?: string | null
	/** Album-level custom settings JSON. */
	settings?: Record<string, unknown>
	/** Gallery-level grid config (wins over `settings.grid.clickable`). */
	grid?: Models.GalleryConfig['grid']
	/** Extra info per index image (`title`/`created` for the sort tests, sizes for spreads). */
	index?: (id: string, i: number) => Partial<Models.ImageInfo.ImageInfo>
	/** Bundle data per image (markers/tours); only the fetched bundle carries it. */
	data?: (id: string, i: number) => Models.ImageData.ImageData
	/** Fail the archive request, so `_fromAlbum` rejects and `#print` degrades. */
	brokenArchive?: boolean
	/** Leave the index entry out of the archive body, so `#getArchiveIndex` rejects. */
	missingIndex?: boolean
}

export interface AlbumFixture {
	/** The `bundle.json` body: the album plus its images. */
	bundle: Models.ImageBundle.BundleResponse & { album: Models.GalleryConfig }
	ids: string[]
	albumId: string
	/** The archive id as `_fromAlbum` loads it (`g/<id>`), or `''` when there is none. */
	archiveId: string
	mdp: ArrayBuffer
}

/** Builds an archive-backed album bundle plus the archive body it needs. */
export function albumFixture(opts: AlbumOptions = {}): AlbumFixture {
	const count = opts.count ?? 3
	const tag = nextTag()
	const albumId = `album${tag}`
	const archiveId = opts.archive === null ? '' : (opts.archive ?? `arc${tag}`)
	const ids = Array.from({ length: count }, (_, i) => gridImageId(i, tag))
	const startId = opts.startId ?? (opts.startIndex === undefined ? undefined : ids[opts.startIndex])

	const indexImages = ids.map((id, i) => ({
		...baseInfo(id, { isWebP: true, isDeepZoom: false, ...opts.index?.(id, i) }),
		albumId,
	}))

	const images: Models.ImageBundle.BundleImage[] = ids.map((id, i) => ({
		id,
		info: { ...baseInfo(id, { isWebP: true, isDeepZoom: false }), albumId },
		settings: {},
		data: opts.data?.(id, i) ?? {},
	}))

	const album: Models.GalleryConfig = {
		id: albumId,
		type: opts.type ?? 'swipe',
		...(archiveId ? { archive: archiveId } : {}),
		...(startId === undefined ? {} : { startId }),
		...(opts.isSpreads === undefined ? {} : { isSpreads: opts.isSpreads }),
		...(opts.coverPages === undefined ? {} : { coverPages: opts.coverPages }),
		...(opts.sort === undefined ? {} : { sort: opts.sort }),
		...(opts.grid === undefined ? {} : { grid: opts.grid }),
		settings: { ...opts.settings },
	}

	const index = { delta: opts.delta, images: indexImages }
	const mdp = makeMdp(
		archiveId && !opts.missingIndex
			? [{ name: `${archiveId}.json`, data: new TextEncoder().encode(JSON.stringify(index)) }]
			: [],
	)

	return { bundle: { images, album }, ids, albumId, archiveId, mdp }
}

export interface MountedAlbum {
	viewer: Viewer
	fixture: AlbumFixture
	ids: string[]
	/** The image id the element was mounted with (its `id` attribute). */
	mountId: string
}

/** Every viewer `mountAlbum` created, so a suite can destroy them all in `afterEach`. */
const mountedViewers: Viewer[] = []

/**
 * Destroys every viewer a fixture mounted.
 *
 * A viewer left behind keeps a live WebGL context: Chromium evicts the oldest
 * ones silently, and the later tests of the file then crawl. Call this from the
 * suite's `afterEach`, next to `restoreArchiveXhr()`.
 */
export function destroyAlbums(): void {
	for (const viewer of mountedViewers.splice(0)) {
		viewer.destroy()
	}
}

/**
 * Mounts an album by the element's **id attribute** and installs the archive
 * stub.
 *
 * Split from {@link awaitAlbum} so a test can attach its `gallery-show` listener
 * between the mount and the open: `_onMount` starts `#print` fire-and-forget, but
 * `#print` awaits a `tick()` before fetching, so a synchronous listener is in
 * place before the first album event.
 */
export function mountAlbum(
	opts: AlbumOptions = {},
	mountIndex = 0,
	attrs: Record<string, string> = {},
): MountedAlbum {
	const fixture = albumFixture(opts)
	archive.db.clear()
	mockJson(/bundle\.json/, fixture.bundle)
	stubArchiveXhr(fixture.mdp, opts.brokenArchive ? 404 : 200)

	const first = fixture.ids[mountIndex] ?? ''
	const viewer = mountViewer({ id: first, ...attrs }, 'width: 800px; height: 600px; display: block;')
	mountedViewers.push(viewer)
	return { viewer, fixture, ids: fixture.ids, mountId: first }
}

export interface OpenAlbum extends MountedAlbum {
	/** Waits for this gate. */
	gate: 'album' | 'grid' | 'gallery'
}

/**
 * Opens the mounted album and waits until the gallery has taken over.
 *
 * Nothing opens the image explicitly: `mountAlbum` gives the element an id, and
 * `#print` then resolves the album and opens the gallery parent itself. Calling
 * `viewer.open(id)` here would race that and build a **second** top-level
 * canvas; when that stray canvas finishes loading, `TileCanvas._fadeIn` fades
 * out every other canvas, including the gallery parent — which then counts as
 * hidden, stops stepping its children, and leaves every awaited
 * `SwipeGallery.animateTo` promise pending forever.
 *
 * The gate is the parent image rather than the controller: the album API
 * (`$current.album`) — or the grid controller for a `grid` album, which never
 * renders `<micrio-gallery>` and so never gets an album API — only exists once
 * that parent is current.
 *
 * The archive stub is deliberately **not** removed here: `#print` is
 * fire-and-forget, so an album can still be resolving when the test moves on.
 * Call `restoreArchiveXhr()` from the suite's `afterEach`.
 */
export async function awaitAlbum(
	mounted: MountedAlbum,
	opts: { gate?: 'album' | 'grid' | 'gallery'; timeout?: number } = {},
): Promise<OpenAlbum> {
	const { viewer, fixture } = mounted
	const gate = opts.gate ?? 'album'
	const timeout = opts.timeout ?? 6000

	try {
		await waitFor(() => Boolean(viewer.el.gallery), timeout, 'the album controller')
		if (gate === 'album') {
			await waitFor(() => viewer.el.$current?.album !== undefined, timeout, 'the album API')
		} else if (gate === 'grid') {
			await waitFor(() => viewer.el.$current?.grid !== undefined, timeout, 'the grid controller')
		} else {
			await settle(2)
		}
	} catch {
		throw new Error(
			`the album never opened: ${JSON.stringify({
				current: viewer.el.$current?.id ?? null,
				gallery: viewer.el.gallery?._config?.type ?? null,
				albumId: fixture.albumId,
				archiveId: fixture.archiveId,
				archiveDb: [...archive.db.keys()],
				loading: get(viewer.el._loading),
			})}`,
		)
	}
	return { ...mounted, gate }
}

/**
 * Waits for an album that is expected **not** to produce one (a broken archive,
 * a missing index, an album with no archive) and returns the degraded viewer, so
 * the test can assert the fallback and still destroy the element.
 */
export async function awaitNoAlbum(mounted: MountedAlbum, timeout = 4000): Promise<MountedAlbum> {
	const { viewer, mountId } = mounted
	// `#print` still runs, but its album attempt fails and it opens the single
	// image instead
	await waitFor(() => viewer.el.$current?.id === mountId, timeout, 'the single image')
	await waitFor(() => !get(viewer.el._loading), timeout, 'loading to finish').catch(() => {})
	await settle(2)
	return mounted
}

/** The `<micrio-gallery>` element the layout placed under the viewer, if any. */
export function galleryEl(el: Element): HTMLElement | null {
	return el.querySelector<HTMLElement>('micrio-gallery')
}

/** The scrubber ticks the gallery printed: one per gallery page. */
export function scrubberTicks(el: Element): HTMLElement[] {
	return [...el.querySelectorAll<HTMLElement>('micrio-gallery ul > :nth-child(2) > span')]
}

/** The scrubber's draggable handle `<button>`. */
export function scrubberHandle(el: Element): HTMLButtonElement | null {
	return el.querySelector<HTMLButtonElement>('micrio-gallery ul > button')
}

/** The scrubber's `<ul>` track. */
export function scrubberTrack(el: Element): HTMLElement | null {
	return el.querySelector<HTMLElement>('micrio-gallery ul')
}

/** The live album API on the parent gallery image. */
export function albumOf(el: HTMLMicrioElement): Models.Album | undefined {
	return el.$current?.album
}

/** Dispatches a `keydown` on the window, where the gallery listens for navigation keys. */
export function press(key: string): void {
	globalThis.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}
