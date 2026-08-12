import type { Models } from '$types/models';
import type { Engine } from '$render/engine';
import type { HTMLMicrioElement } from '$core/element';

import { MicrioImage } from '$core/image';
import { jsonCache } from '$utils/fetch';
import { MicrioError } from '$core/error';
import { DataLoader } from '$utils/dataLoader';
import { archive } from '$utils/archive';
import { createElement } from '$utils/dom';
import { BASEPATH, BASEPATH_V5 } from '$core/globals';
import { Grid } from '$grid/grid';

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
	imageHeight: number
): Models.Camera.View {
	const [x, y, w, h] = slot;
	const slotW = w * containerWidth;
	const slotH = h * containerHeight;
	const scale = Math.min(slotW / imageWidth, slotH / imageHeight);
	const renderW = (imageWidth * scale) / containerWidth;
	const renderH = (imageHeight * scale) / containerHeight;
	const cx = x + w / 2;
	const cy = y + h / 2;
	return [cx - renderW / 2, cy - renderH / 2, renderW, renderH];
}

/** Manages a collection of gallery images with navigation (swipe, switch, grid, album). */
export class Gallery {
	/** @internal */
	readonly _config: Models.GalleryConfig;
	/** @internal */
	readonly _images: MicrioImage[];

	#parent: MicrioImage | null = null;

	readonly _items: Models.ImageInfo.ImageInfo[];

	/** Max width for the virtual container canvas (switch/omni galleries). */
	#containerWidth: number = 0;
	/** Max height for the virtual container canvas (switch/omni galleries). */
	#containerHeight: number = 0;

	/* @internal */
	constructor(items: Models.ImageInfo.ImageInfo[], engine: Engine, config: Models.GalleryConfig) {
		this._items = items;

		// Book3D albums are always laid out as a book: a single cover page
		// followed by image spreads.
		const isBook3d = config.type == 'book3d';
		this._config = isBook3d ? { ...config, isSpreads: true, coverPages: 1 } : config;

		const isSwitch = config.type == 'switch';
		const isSpreads = this._config.isSpreads;
		const coverPages = isSpreads ? (this._config.coverPages ?? 0) : 0;

		if (isSwitch) {
			this.#containerHeight = Math.max(...items.map(p => p.height));
			this.#containerWidth = Math.max(...items.map(p => p.width * (isSpreads ? 2 : 1)));
		}

		this._images = items.map((info, i) => {
			const imageSettings: Record<string, any> = { ...config.settings };

			// Propagate archive layer offset so child images adjust their level count
			// and generate thumbSrc URLs that match what the archive stores.
			if (config.archiveLayerOffset !== undefined) {
				imageSettings.gallery = {
					...(imageSettings.gallery || {}),
					archive: true,
					archiveLayerOffset: config.archiveLayerOffset
				};
			}

			const opts: Partial<MicrioImage['opts']> = {};
			const data = DataLoader._getBundleImageSync(info.id)?.data;

			if (isSwitch) {
				opts.isEmbed = true;
				opts.useParentCamera = true;

				let slot: Models.Camera.View;

				if (!isSpreads) {
					slot = [0, 0, 1, 1];
				} else {
					slot = i - coverPages < 0 || (i == items.length - 1 && (i - coverPages) % 2 == 0)
						? [0.25, 0, 0.5, 1]
						: (i - coverPages) % 2 == 0
							? [0, 0, 0.5, 1]
							: [0.5, 0, 0.5, 1];
				}

				let area = fitArea(slot, this.#containerWidth, this.#containerHeight, info.width, info.height);

				if (isSpreads) {
					if (slot[0] === 0.5) {
						area[0] = 0.5;
					} else if (slot[0] === 0) {
						const w = area[2];
						area[0] = 0.5 - w;
					}
				}

				opts.area = area;
			} else {
				opts.area = [i, 0, 1, 1];
			}

			return new MicrioImage(engine, {
				id: info.id, info,
				settings: imageSettings as any,
				data,
			}, opts);
		});

	}

	// --- Factory Methods ---

	/** Create a gallery from a IIIF Presentation API 3 manifest. Returns null for single-image manifests and raw Image API responses. */
	/** @internal */
	static _fromIIIF(resp: any, engine: Engine): Gallery | null {
		if (resp['@type'] === 'sc:Manifest' || resp.sequences)
			throw new MicrioError('IIIF_V2_UNSUPPORTED', { displayMessage: 'Only IIIF Presentation API 3 manifests are supported' });

		if (resp.type === 'Manifest') {
			const canvases = (resp.items as any[])
				?.flatMap((p: any) => p.items?.[0]?.items?.[0]?.body)
				?.filter((b: any) => b?.service?.[0]?.id) ?? [];

			if (!canvases.length)
				throw new MicrioError('NO_CANVASES', { displayMessage: 'No valid IIIF canvases found in the manifest' });

			const images = canvases.map((b: any): Models.ImageInfo.ImageInfo => ({
				id: b.service[0].id, path: b.service[0].id.replace(/\/[^/]*$/, ''), version: '',
				width: b.width, height: b.height, isWebP: b.format === 'image/webp', isPng: b.format === 'image/png', isIIIF: true,
			}));

			if (images.length === 1) return null;

			return new Gallery(images, engine, { type: 'swipe', settings: {} });
		}

		return null;
	}

	/** @internal */
	static _fromAssets(assets: Models.Assets.Image[], engine: Engine, micrio: HTMLMicrioElement, opts?: { startId?: string; basePath?: string }): Gallery {
		const path = opts?.basePath ?? micrio.$current?._dataPath ?? BASEPATH;

		const items: Models.ImageInfo.ImageInfo[] = assets.map(c => ({
			id: c.micrioId ?? c.id!, path, version: '',
			width: c.width, height: c.height,
			isDeepZoom: c.isDeepZoom, isPng: c.isPng, isWebP: c.isWebP,
		}));

		return new Gallery(items, engine, {
			type: 'swipe',
			startId: opts?.startId,
			settings: { skipMeta: true, noLogo: true }
		});
	}

	/** @internal */
	static async _fromAlbum(albumId: string, engine: Engine, opts?: { startId?: string; path?: string; onProgress?: (n: number) => void }): Promise<Gallery | null> {
		const aInfo = DataLoader._getAlbum(albumId);
		if (!aInfo) return null;

		const path = opts?.path ?? DataLoader._getOrganisation()?.baseUrl ?? BASEPATH_V5;

		if (aInfo.archive) {
			await archive.load(path, 'g/' + aInfo.archive, opts?.onProgress);
		}

		const config: Partial<Models.GalleryConfig> = {
			...aInfo,
			startId: opts?.startId ?? aInfo.startId,
		};
		if (aInfo.settings) {
			config.settings = { ...aInfo.settings };
		}

		if (aInfo.type === 'grid' && aInfo.archive) {
			const gridClickable = config.grid?.clickable ?? config.settings?.grid?.clickable;
			const settings: Record<string, any> = { zoomLimit: 15, minimap: false, ...(config.settings ?? {}) };
			if (gridClickable && settings.hookKeys === undefined) settings.hookKeys = true;
			config.settings = settings as any;
		}

		const index = await Gallery.#getArchiveIndex(aInfo.archive!.split('.')[0], path);
		if (index) config.archiveLayerOffset = index.delta;
		const sort = config.sort;
		if (sort && index?.images) index.images.sort(Gallery.#sortArchiveImages(sort));
		const rawImages = index?.images ?? [];

		return new Gallery(rawImages.map(i => ({ ...i, path, version: '' })), engine, {
			...config,
			type: config.type ?? 'swipe',
		} as Models.GalleryConfig);
	}

	// --- Static Helpers ---

	static #getArchiveIndex = async (id: string, path: string):
		Promise<{ delta?: number; images: Models.ImageInfo.ImageInfo[] }> =>
		archive.get<{ images: Models.ImageInfo.ImageInfo[] }>(`${path}${id}.json`)
			.then(r => { r.images.forEach(i => jsonCache.set(`${path}${i.id}/info.json`, i)); return r; });

	static #sortArchiveImages(sort: string | undefined): (a: Models.ImageInfo.ImageInfo, b: Models.ImageInfo.ImageInfo) => number {
		return sort == 'random' ? () => Math.random() - .5
			: sort == 'name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0
				: sort == '-name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? 1 : a.title > b.title ? -1 : 0
					: sort == '-created' ? (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? 1 : a.created > b.created ? -1 : 0
						: (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? -1 : a.created > b.created ? 1 : 0;
	}

	// --- Page Layout (spread-aware) ---

	/** @internal Compute which image indices belong to each logical page.
	 *  For spread albums, cover pages are single-image pages and remaining images
	 *  are paired into spreads. For regular albums each image is its own page. */
	_getPageLayout(): { pages: number[][]; numPages: number } {
		const isSpread = !!this._config.isSpreads;
		const coverPages = this._config.coverPages ?? 0;
		const pages: number[][] = [];

		if (isSpread) {
			let i = 0;
			for (; i < Math.min(coverPages, this._images.length); i++) {
				pages.push([i]);
			}
			for (; i < this._images.length; i += 2) {
				const page = [i];
				if (i + 1 < this._images.length) page.push(i + 1);
				pages.push(page);
			}
		} else {
			for (let i = 0; i < this._images.length; i++) {
				pages.push([i]);
			}
		}

		return { pages, numPages: pages.length };
	}

	// --- Instance Methods ---

	/** @internal */
	_attach(parent: MicrioImage): void {
		this.#parent = parent;

		if (this._config.type == 'grid') {
			const micrio = parent.engine.micrio;
			parent.grid = createElement(Grid.tag, {
				setProps: { micrio, image: parent, gallery: this },
			}) as Grid;
		}

		// Book3D albums ship their own WebGL renderer on the shared `<canvas>`,
		// so the Micrio engine and WebGL stay uninitialized (and inert) while loaded.
		if(this._config.type == 'book3d') {
			parent.engine._book3d = true;
		}

	}

	// --- Element Opening ---

	/** @internal Build gallery BundleImage and open the parent gallery image on the `<micr-io>` element. */
	async _openOn(micrio: HTMLMicrioElement): Promise<void> {
		const isSwitch = this._config.type == 'switch';
		const gallerySettings: Partial<Models.ImageInfo.Settings> = {
			view: [0, 0, 1, 1],
			gallery: { ...this._config },
			pinchZoomOutLimit: isSwitch ? true : undefined,
		};

		if(this._config.settings) {
			Object.assign(gallerySettings, this._config.settings);
		}

		const path = DataLoader._getOrganisation()?.baseUrl ?? BASEPATH_V5;

		await micrio.open({
			id: '',
			info: {
				id: '',
				path,
				version: '',
				width: isSwitch ? this.#containerWidth : (micrio.offsetWidth * micrio.canvas.getRatio()),
				height: isSwitch ? this.#containerHeight : (micrio.offsetHeight * micrio.canvas.getRatio()),
			},
			settings: gallerySettings,
		}, {
			gallery: this
		});
	}

	// --- Navigation ---
	gotoId = (id: string): Promise<MicrioImage | undefined> => this.goto(this._images.findIndex(i => i.id == id));
	goto = (index: number): Promise<MicrioImage | undefined> => this.#parent?.album?.goto(index) ?? Promise.resolve(this._images[index]);
	next = (): void => this.#parent?.album?.next();
	prev = (): void => this.#parent?.album?.prev();
}
