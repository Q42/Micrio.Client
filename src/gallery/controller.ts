import type { Models } from '$types/models'
import type { Engine } from '$render/engine'
import type { HTMLMicrioElement } from '$core/element'

import { MicrioImage } from '$core/image'
import { jsonCache } from '$utils/fetch'
import { MicrioError } from '$core/error'
import { DataLoader } from '$utils/dataLoader'
import { archive } from '$utils/archive'
import { createElement } from '$utils/dom'
import { BASEPATH, BASEPATH_V5 } from '$core/globals'
import { Grid } from '$grid/grid'
import { computePageLayout } from '$book/core/layout'

/** Fits an image within its slot area while maintaining aspect ratio (like `object-fit: contain`).
 *  The slot is defined in normalized coordinates [x, y, width, height] within a virtual container
 *  of `containerWidth`×`containerHeight` pixels. Returns a centered sub-area `[x, y, width, height]`
 *  that contains the image without stretching.
 */
function fitArea(
	slot: Models.Camera.View,
	containerWidth: number,
	containerHeight: number,
	imageWidth: number,
	imageHeight: number,
): Models.Camera.View {
	const [x, y, w, h] = slot
	const slotW = w * containerWidth
	const slotH = h * containerHeight
	const scale = Math.min(slotW / imageWidth, slotH / imageHeight)
	const renderW = (imageWidth * scale) / containerWidth
	const renderH = (imageHeight * scale) / containerHeight
	const cx = x + w / 2
	const cy = y + h / 2
	return [cx - renderW / 2, cy - renderH / 2, renderW, renderH]
}

/** Compare two optional archive metadata strings, inverting for descending sorts. */
function compareStrings(a: string | undefined, b: string | undefined, invert: boolean): number {
	if (!a || !b || a === b) {
		return 0
	}
	const less = a < b ? -1 : 1
	return invert ? -less : less
}

/** Compare two optional archive metadata numbers, inverting for descending sorts. */
function compareNumbers(a: number | undefined, b: number | undefined, invert: boolean): number {
	if (!a || !b || a === b) {
		return 0
	}
	const less = a < b ? -1 : 1
	return invert ? -less : less
}

/** True for non-null objects; the starting point for narrowing external JSON. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** True for arrays, but keeps the element type `unknown` (`Array.isArray` narrows to `any[]`). */
function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value)
}

/** Narrows a custom-settings `grid.clickable` leaf to the values the grid understands. */
function toGridClickable(settings: unknown): 'focus' | 'zoom' | false | undefined {
	if (!isRecord(settings)) {
		return undefined
	}
	const { grid } = settings
	if (!isRecord(grid)) {
		return undefined
	}
	const { clickable } = grid
	return clickable === 'focus' || clickable === 'zoom' || clickable === false ? clickable : undefined
}

/** A IIIF canvas body: the image service plus the dimensions the gallery needs. */
interface IIIFCanvasBody {
	id: string
	width: number
	height: number
	format?: string
}

/**
 * Narrow one IIIF canvas `body` value to a usable source.
 *
 * Only an Image API `service` counts: Micrio renders tiled IIIF, so the body's own
 * representation URI is ignored and a body without a service is not a canvas at all.
 * Dimensions must be numbers for the same reason — they size the tile grid. This is
 * why the cookbook's minimal single-image manifest (a plain PNG body, no service)
 * cannot be opened; see the boundaries on {@link Gallery._fromIIIF}.
 */
function toIIIFCanvasBody(value: unknown): IIIFCanvasBody | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const service = isUnknownArray(value.service) ? value.service[0] : undefined
	if (!isRecord(service) || typeof service.id !== 'string') {
		return undefined
	}
	if (typeof value.width !== 'number' || typeof value.height !== 'number') {
		return undefined
	}
	return {
		id: service.id,
		width: value.width,
		height: value.height,
		format: typeof value.format === 'string' ? value.format : undefined,
	}
}

/** Manages a collection of gallery images with navigation (swipe, switch, grid, album). */
export class Gallery {
	/** @internal */
	readonly _config: Models.GalleryConfig
	/** @internal */
	readonly _images: MicrioImage[]

	#parent: MicrioImage | null = null

	readonly _items: Models.ImageInfo.ImageInfo[]

	/** Max width for the virtual container canvas (switch/omni galleries). */
	#containerWidth = 0
	/** Max height for the virtual container canvas (switch/omni galleries). */
	#containerHeight = 0

	/* @internal */
	constructor(items: Models.ImageInfo.ImageInfo[], engine: Engine, config: Models.GalleryConfig) {
		this._items = items

		// Book3D albums are always laid out as a book: a single cover page
		// followed by image spreads.
		const isBook3d = config.type === 'book3d'
		this._config = isBook3d ? { ...config, isSpreads: true, coverPages: 1 } : config

		const isSwitch = config.type === 'switch'
		const { isSpreads } = this._config
		const coverPages = isSpreads ? (this._config.coverPages ?? 0) : 0

		if (isSwitch) {
			this.#containerHeight = Math.max(...items.map((p) => p.height))
			this.#containerWidth = Math.max(...items.map((p) => p.width * (isSpreads ? 2 : 1)))
		}

		this._images = items.map((info, i) => {
			const imageSettings = { ...config.settings }

			// Propagate archive layer offset so child images adjust their level count
			// and generate thumbSrc URLs that match what the archive stores.
			if (config.archiveLayerOffset !== undefined) {
				const existing: unknown = imageSettings.gallery
				imageSettings.gallery = {
					...(isRecord(existing) ? existing : undefined),
					archive: true,
					archiveLayerOffset: config.archiveLayerOffset,
				}
			}

			const opts: Partial<MicrioImage['opts']> = {}
			const data = DataLoader._getBundleImageSync(info.id)?.data

			if (isSwitch) {
				opts.isEmbed = true
				opts.useParentCamera = true

				let slot: Models.Camera.View

				if (!isSpreads) {
					slot = [0, 0, 1, 1]
				} else {
					const rel = i - coverPages
					if (rel < 0 || (i === items.length - 1 && rel % 2 === 0)) {
						slot = [0.25, 0, 0.5, 1]
					} else if (rel % 2 === 0) {
						slot = [0, 0, 0.5, 1]
					} else {
						slot = [0.5, 0, 0.5, 1]
					}
				}

				let area = fitArea(slot, this.#containerWidth, this.#containerHeight, info.width, info.height)

				if (isSpreads) {
					if (slot[0] === 0.5) {
						area[0] = 0.5
					} else if (slot[0] === 0) {
						const w = area[2]
						area[0] = 0.5 - w
					}
				}

				opts.area = area
			} else {
				opts.area = [i, 0, 1, 1]
			}

			return new MicrioImage(
				engine,
				{
					id: info.id,
					info,
					settings: imageSettings,
					data,
				},
				opts,
			)
		})
	}

	// --- Factory Methods ---

	/**
	 * Create a gallery from a IIIF Presentation API 3 manifest. Returns null for single-image
	 * manifests and raw Image API responses.
	 *
	 * The boundaries, pinned by `tests/browser/gallery/gallery-iiif.test.ts`:
	 *
	 * - Only a canvas body carrying an Image API `service` (with a string `id`, and numeric
	 *   `width`/`height`) is usable. The body's own URI is never read, so a manifest of plain
	 *   image URIs — the cookbook's minimal `recipe/0001-mvm-image` — has no canvases at all.
	 * - A manifest with zero usable canvases throws `NO_CANVASES` **before** the single-canvas
	 *   fallback in the element, so it renders `micrio-error` rather than one of its images.
	 * - Presentation 2 (`@type: 'sc:Manifest'`, or anything with `sequences`) throws
	 *   `IIIF_V2_UNSUPPORTED`. A raw Presentation 2 `info.json` is *not* that: it is an Image
	 *   API response and still opens (see `#handleIIIF` in `$core/element`).
	 * - A response that is neither a usable manifest nor an `info.json` with numeric dimensions
	 *   is rejected as `UNSUPPORTED_IIIF` instead of becoming a blank image.
	 * - Presentation 4's manifest-level `services` expansion is unread: the v4 spec still
	 *   requires `service` on the body.
	 * @internal
	 */
	static _fromIIIF(resp: unknown, engine: Engine): Gallery | null {
		if (!isRecord(resp)) {
			return null
		}
		if (resp['@type'] === 'sc:Manifest' || resp['sequences'] != null) {
			throw new MicrioError('IIIF_V2_UNSUPPORTED', {
				displayMessage: 'Only IIIF Presentation API 3 manifests are supported',
			})
		}

		if (resp.type === 'Manifest') {
			const canvases: IIIFCanvasBody[] = []
			const pages = Array.isArray(resp.items) ? resp.items : []
			for (const page of pages) {
				if (!isRecord(page)) {
					continue
				}
				const canvas = isUnknownArray(page.items) ? page.items[0] : undefined
				if (!isRecord(canvas)) {
					continue
				}
				const annotation = isUnknownArray(canvas.items) ? canvas.items[0] : undefined
				if (!isRecord(annotation)) {
					continue
				}
				const bodies = Array.isArray(annotation.body) ? annotation.body : [annotation.body]
				for (const body of bodies) {
					const b = toIIIFCanvasBody(body)
					if (b) {
						canvases.push(b)
					}
				}
			}

			if (canvases.length === 0) {
				throw new MicrioError('NO_CANVASES', { displayMessage: 'No valid IIIF canvases found in the manifest' })
			}

			const images = canvases.map((b): Models.ImageInfo.ImageInfo => ({
				id: b.id,
				path: b.id.replace(/\/[^/]*$/, ''),
				version: '',
				width: b.width,
				height: b.height,
				isWebP: b.format === 'image/webp',
				isPng: b.format === 'image/png',
				isIIIF: true,
			}))

			if (images.length === 1) {
				return null
			}

			return new Gallery(images, engine, { type: 'swipe', settings: {} })
		}

		return null
	}

	/** @internal */
	static _fromAssets(
		assets: Models.Assets.Image[],
		engine: Engine,
		micrio: HTMLMicrioElement,
		opts?: { startId?: string; basePath?: string },
	): Gallery {
		const path = opts?.basePath ?? micrio.$current?._dataPath ?? BASEPATH

		const items: Models.ImageInfo.ImageInfo[] = []
		for (const c of assets) {
			const id = c.micrioId ?? c.id
			if (!id) {
				continue
			}
			items.push({
				id,
				path,
				version: '',
				width: c.width,
				height: c.height,
				isDeepZoom: c.isDeepZoom,
				isPng: c.isPng,
				isWebP: c.isWebP,
			})
		}

		return new Gallery(items, engine, {
			type: 'swipe',
			startId: opts?.startId,
			settings: { skipMeta: true, noLogo: true },
		})
	}

	/** @internal */
	static async _fromAlbum(
		albumId: string,
		engine: Engine,
		opts?: { startId?: string; path?: string; onProgress?: (n: number) => void },
	): Promise<Gallery | null> {
		const aInfo = DataLoader._getAlbum(albumId)
		if (!aInfo) {
			return null
		}

		const path = opts?.path ?? DataLoader._getOrganisation()?.baseUrl ?? BASEPATH_V5

		if (aInfo.archive) {
			await archive.load(path, `g/${aInfo.archive}`, opts?.onProgress)
		}

		const config: Partial<Models.GalleryConfig> = {
			...aInfo,
			startId: opts?.startId ?? aInfo.startId,
		}
		if (aInfo.settings) {
			config.settings = { ...aInfo.settings }
		}

		if (aInfo.type === 'grid' && aInfo.archive) {
			const gridClickable = config.grid?.clickable ?? toGridClickable(config.settings)
			const settings: Record<string, unknown> = { zoomLimit: 15, minimap: false, ...config.settings }
			if ((gridClickable === 'focus' || gridClickable === 'zoom') && settings.hookKeys === undefined) {
				settings.hookKeys = true
			}
			config.settings = settings
		}

		const index = aInfo.archive ? await Gallery.#getArchiveIndex(aInfo.archive.split('.')[0], path) : undefined
		if (index) {
			config.archiveLayerOffset = index.delta
			// The caller's startId (the element's own id) only wins when the album
			// actually contains that image; otherwise the album's own setting is the
			// author's intent. `#renderGallery` clamps an unknown id to page 0.
			const known = new Set(index.images.map((image) => image.id))
			if (!opts?.startId || !known.has(opts.startId)) {
				config.startId = aInfo.startId ?? opts?.startId
			}
		}
		const { sort } = config
		if (sort && index?.images) {
			index.images.sort(Gallery.#sortArchiveImages(sort))
		}
		const rawImages = index?.images ?? []

		const items = []
		for (const i of rawImages) {
			items.push({ ...i, path, version: '' })
		}
		return new Gallery(items, engine, {
			...config,
			type: config.type ?? 'swipe',
		})
	}

	// --- Static Helpers ---

	static #getArchiveIndex = (
		id: string,
		path: string,
	): Promise<{ delta?: number; images: Models.ImageInfo.ImageInfo[] }> =>
		archive.get<{ images: Models.ImageInfo.ImageInfo[] }>(`${path}${id}.json`).then((r) => {
			for (const i of r.images) {
				jsonCache.set(`${path}${i.id}/info.json`, i)
			}
			return r
		})

	static #sortArchiveImages(
		sort: string | undefined,
	): (a: Models.ImageInfo.ImageInfo, b: Models.ImageInfo.ImageInfo) => number {
		switch (sort) {
			case 'random': {
				return () => Math.random() - 0.5
			}
			case 'name': {
				return (a, b) => compareStrings(a.title, b.title, false)
			}
			case '-name': {
				return (a, b) => compareStrings(a.title, b.title, true)
			}
			case '-created': {
				return (a, b) => compareNumbers(a.created, b.created, true)
			}
			default: {
				return (a, b) => compareNumbers(a.created, b.created, false)
			}
		}
	}

	// --- Page Layout (spread-aware) ---

	/** @internal Compute which image indices belong to each logical page.
	 *  For spread albums, cover pages are single-image pages and remaining images
	 *  are paired into spreads. For regular albums each image is its own page.
	 *  A book3d album uses the book's own layout, so the album and the viewer
	 *  agree on the page count (otherwise the gallery's extra page can never be
	 *  displayed: `BookViewer.goto` clamps it away). */
	_getPageLayout(): { pages: number[][]; numPages: number } {
		const isSpread = Boolean(this._config.isSpreads)
		const coverPages = this._config.coverPages ?? 0
		const pages: number[][] = []

		if (this._config.type === 'book3d') {
			pages.push(...computePageLayout(this._images.map((image) => image.$info)).pageIdxes)
		} else if (isSpread) {
			let i = 0
			for (; i < Math.min(coverPages, this._images.length); i++) {
				pages.push([i])
			}
			for (; i < this._images.length; i += 2) {
				const page = [i]
				if (i + 1 < this._images.length) {
					page.push(i + 1)
				}
				pages.push(page)
			}
		} else {
			for (let i = 0; i < this._images.length; i++) {
				pages.push([i])
			}
		}

		return { pages, numPages: pages.length }
	}

	// --- Instance Methods ---

	/** @internal */
	_attach(parent: MicrioImage): void {
		this.#parent = parent

		if (this._config.type === 'grid') {
			const { micrio } = parent.engine
			const gridEl = createElement(Grid.tag, {
				setProps: { micrio, image: parent, gallery: this },
			})
			if (gridEl instanceof Grid) {
				parent.grid = gridEl
			}
		}

		// Book3D albums ship their own WebGL renderer on the shared `<canvas>`,
		// so the Micrio engine and WebGL stay uninitialized (and inert) while loaded.
		if (this._config.type === 'book3d') {
			parent.engine._book3d = true
		}
	}

	// --- Element Opening ---

	/** @internal Build gallery BundleImage and open the parent gallery image on the `<micr-io>` element. */
	async _openOn(micrio: HTMLMicrioElement): Promise<void> {
		const isSwitch = this._config.type === 'switch'
		const gallerySettings: Partial<Models.ImageInfo.Settings> = {
			view: [0, 0, 1, 1],
			gallery: { ...this._config },
			pinchZoomOutLimit: isSwitch ? true : undefined,
		}

		if (this._config.settings) {
			Object.assign(gallerySettings, this._config.settings)
		}

		const path = DataLoader._getOrganisation()?.baseUrl ?? BASEPATH_V5

		await micrio.open(
			{
				id: '',
				info: {
					id: '',
					path,
					version: '',
					width: isSwitch ? this.#containerWidth : micrio.offsetWidth * micrio.canvas.getRatio(),
					height: isSwitch ? this.#containerHeight : micrio.offsetHeight * micrio.canvas.getRatio(),
				},
				settings: gallerySettings,
			},
			{
				gallery: this,
			},
		)
	}

	// --- Navigation ---
	gotoId = (id: string): Promise<MicrioImage | undefined> => this.goto(this._images.findIndex((i) => i.id === id))
	goto = (index: number): Promise<MicrioImage | undefined> =>
		this.#parent?.album?.goto(index) ?? Promise.resolve(this._images[index])
	next = (): void => this.#parent?.album?.next()
	prev = (): void => this.#parent?.album?.prev()
}
