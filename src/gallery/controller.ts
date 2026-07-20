import type { Models } from '$types/models';
import type { Engine } from '$render/engine';
import type { HTMLMicrioElement } from '$core/element';

import { MicrioImage } from '$core/image';
import { jsonCache } from '$utils/fetch';
import { MicrioError } from '$core/error';
import { DataLoader } from '$utils/dataLoader';
import { archive } from '$utils/archive';
import { writable, get, type Writable } from '$core/store';
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

export class Gallery {
	readonly config: Models.GalleryConfig;
	readonly images: MicrioImage[];
	readonly engine: Engine;
	readonly micrio: HTMLMicrioElement;

	parent: MicrioImage | null = null;

	readonly currentIndex: Writable<number> = writable(0);

	/** Raw ImageInfo[] from the archive index, used to initialize the Grid. */
	#gridImageInfos: Models.ImageInfo.ImageInfo[] = [];

	/** Max width for the virtual container canvas (switch/omni galleries). */
	containerWidth: number = 0;
	/** Max height for the virtual container canvas (switch/omni galleries). */
	containerHeight: number = 0;

	get type(): Models.GalleryConfig['type'] { return this.config.type; }

	constructor(items: Models.GalleryItem[], engine: Engine, micrio: HTMLMicrioElement, config: Models.GalleryConfig) {
		this.engine = engine;
		this.micrio = micrio;
		this.config = config;

		const isSwitch = config.type == 'switch';
		const isSpreads = config.isSpreads;
		const coverPages = isSpreads ? (config.coverPages ?? 0) : 0;

		if (isSwitch) {
			this.containerHeight = Math.max(...items.map(p => p.height));
			this.containerWidth = Math.max(...items.map(p => p.width * (isSpreads ? 2 : 1)));
		}

		this.images = items.map((c, i) => {
			const rev = config.revisions?.[c.id];

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

				let area = fitArea(slot, this.containerWidth, this.containerHeight, c.width, c.height);

				if (isSpreads) {
					if (slot[0] === 0.5) {
						// Right page: left-align to the spread center
						area[0] = 0.5;
					} else if (slot[0] === 0) {
						// Left page: right-align to the spread center
						const w = area[2];
						area[0] = 0.5 - w;
					}
					// Cover pages (slot [0.25, 0, 0.5, 1]) stay centered
				}

				opts.area = area;
			} else {
				opts.area = [i, 0, 1, 1];
			}

			return new MicrioImage(engine, {
				id: c.id,
				info: {
					id: c.id,
					path: c.path,
					version: '',
					width: c.width,
					height: c.height,
					tileSize: c.tileSize,
					isDeepZoom: c.isDeepZoom,
					isPng: c.isPng,
					isWebP: c.isWebP,
					revision: rev,
				} as Models.ImageInfo.ImageInfo,
				settings: imageSettings as any,
				data: DataLoader.getBundleImageSync(c.id)?.data,
			}, opts);
		});

		// Load per-image data (markers, tours, etc.) from the bundle cache
		queueMicrotask(() => this.images.forEach(c => c.loadBundleData()));
	}

	// --- Factory Methods ---

	/** Create a gallery from a IIIF Presentation API 3 manifest. Returns null for single-image manifests and raw Image API responses. */
	static fromIIIF(resp: any, engine: Engine, micrio: HTMLMicrioElement): Gallery | null {
		if (resp['@type'] === 'sc:Manifest' || resp.sequences)
			throw new MicrioError('IIIF_V2_UNSUPPORTED', { displayMessage: 'Only IIIF Presentation API 3 manifests are supported' });

		if (resp.type === 'Manifest') {
			const canvases = (resp.items as any[])
				?.flatMap((p: any) => p.items?.[0]?.items?.[0]?.body)
				?.filter((b: any) => b?.service?.[0]?.id) ?? [];

			if (!canvases.length)
				throw new MicrioError('NO_CANVASES', { displayMessage: 'No valid IIIF canvases found in the manifest' });

			const images = canvases.map((b: any): Models.GalleryItem => ({
				id: b.service[0].id,
				width: b.width,
				height: b.height,
				isPng: b.format === 'image/png',
				path: b.service[0].id.replace(/\/[^/]*$/, ''),
			}));

			if (images.length === 1) return null;

			return new Gallery(images, engine, micrio, { type: 'swipe', settings: {} });
		}

		return null;
	}

	static fromAssets(assets: Models.Assets.Image[], engine: Engine, micrio: HTMLMicrioElement, opts?: { startId?: string; basePath?: string }): Gallery {
		const path = opts?.basePath ?? micrio.$current?.dataPath ?? BASEPATH;

		const items: Models.GalleryItem[] = assets.map(c => ({
			id: c.micrioId ?? c.id!,
			path,
			width: c.width,
			height: c.height,
			isDeepZoom: c.isDeepZoom,
			isPng: c.isPng,
			isWebP: c.isWebP,
		}));

		return new Gallery(items, engine, micrio, {
			type: 'swipe',
			startId: opts?.startId,
			settings: { skipMeta: true }
		});
	}

	/** Load an archive index and prepare the Gallery config. Shared by fromArchive / fromGrid. */
	static async #fromArchiveIndex(
		id: string, path: string, engine: Engine, micrio: HTMLMicrioElement, config: Models.GalleryConfig
	): Promise<{ images: Models.ImageInfo.ImageInfo[]; config: Models.GalleryConfig }> {
		const index = await Gallery.#getArchiveIndex(id.split('.')[0], path, engine, micrio);
		if (index) config.archiveLayerOffset = index.delta;
		const s = config.sort;
		if (s && index?.images) index.images.sort(Gallery.#sortArchiveImages(s));
		return { images: index?.images ?? [], config };
	}

	static async fromArchive(archiveId: string, path: string, engine: Engine, micrio: HTMLMicrioElement, config?: Partial<Models.GalleryConfig>): Promise<Gallery> {
		const { images, config: galleryConfig } = await Gallery.#fromArchiveIndex(
			archiveId, path, engine, micrio, { type: 'swipe', ...config }
		);
		const items: Models.GalleryItem[] = images.map(i => ({
			id: i.id, path, width: i.width, height: i.height,
			isDeepZoom: i.isDeepZoom, isPng: i.isPng, isWebP: i.isWebP, tileSize: i.tileSize,
		}));
		return new Gallery(items, engine, micrio, galleryConfig);
	}

	static async fromGrid(archiveId: string, engine: Engine, micrio: HTMLMicrioElement, config?: Partial<Models.GalleryConfig & { path?: string }>): Promise<Gallery | null> {
		const path = config?.path ?? BASEPATH_V5;
		const { images, config: galleryConfig } = await Gallery.#fromArchiveIndex(
			archiveId, path, engine, micrio,
			{ type: 'grid', ...config, settings: { zoomLimit: 15, minimap: false, ...config?.settings } }
		);
		const gallery = new Gallery([], engine, micrio, galleryConfig);
		gallery.#gridImageInfos = images;
		return gallery;
	}

	static async fromAlbum(albumId: string, engine: Engine, micrio: HTMLMicrioElement, opts?: { startId?: string; path?: string; onProgress?: (n: number) => void }): Promise<Gallery | null> {
		const aInfo = DataLoader.getAlbum(albumId);
		if (!aInfo) return null;

		const path = opts?.path ?? DataLoader.getOrganisation()?.baseUrl ?? BASEPATH_V5;

		if (aInfo.archive) {
			await archive.load(path, 'g/' + aInfo.archive, opts?.onProgress);
		}

		const config: Partial<Models.GalleryConfig> = {
			...aInfo,
			startId: opts?.startId ?? aInfo.startId
		};
		if (aInfo.settings) {
			config.settings = { ...aInfo.settings };
		}

		if (aInfo.type === 'grid' && aInfo.archive) {
			return Gallery.fromGrid(aInfo.archive, engine, micrio, { ...config, path });
		}

		return Gallery.fromArchive(aInfo.archive!, path, engine, micrio, config);
	}

	// --- Static Helpers ---

	static #getArchiveIndex = async (id: string, path: string, _engine: Engine, _micrio: HTMLMicrioElement):
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

	/** Compute which image indices belong to each logical page.
	 *  For spread albums, cover pages are single-image pages and remaining images
	 *  are paired into spreads. For regular albums each image is its own page. */
	getPageLayout(): { pages: number[][]; numPages: number } {
		const isSpread = !!this.config.isSpreads;
		const coverPages = this.config.coverPages ?? 0;
		const pages: number[][] = [];

		if (isSpread) {
			let i = 0;
			for (; i < Math.min(coverPages, this.images.length); i++) {
				pages.push([i]);
			}
			for (; i < this.images.length; i += 2) {
				const page = [i];
				if (i + 1 < this.images.length) page.push(i + 1);
				pages.push(page);
			}
		} else {
			for (let i = 0; i < this.images.length; i++) {
				pages.push([i]);
			}
		}

		return { pages, numPages: pages.length };
	}

	// --- Instance Methods ---

	attach(parent: MicrioImage): void {
		this.parent = parent;
		(parent as any).__gallery = this;
	}

	// --- Element Opening ---

	/** Build gallery BundleImage and open the parent gallery image on the `<micr-io>` element. */
	async openOn(micrio: HTMLMicrioElement): Promise<void> {
		const isSwitch = this.type == 'switch';
		const gallerySettings: Partial<Models.ImageInfo.Settings> = {
			view: [0, 0, 1, 1],
			gallery: { ...this.config },
			pinchZoomOutLimit: isSwitch ? true : undefined,
		};

		if(this.config.settings) {
			Object.assign(gallerySettings, this.config.settings);
		}

		const path = DataLoader.getOrganisation()?.baseUrl ?? BASEPATH_V5;

		if(this.type == 'grid') {
			gallerySettings.zoomLimit = 15;
			gallerySettings.minimap = false;
			if(gallerySettings.grid?.clickable && gallerySettings.hookKeys === undefined) {
				gallerySettings.hookKeys = true;
			}
		}

		const img = await micrio.open({
			id: '',
			info: {
				id: '',
				path,
				version: '',
				width: isSwitch ? this.containerWidth : (micrio.offsetWidth * micrio.canvas.getRatio()),
				height: isSwitch ? this.containerHeight : (micrio.offsetHeight * micrio.canvas.getRatio()),
			},
			settings: gallerySettings,
		}, {
			gallery: this
		});

		if (this.type == 'grid') {
			img.grid = new Grid(micrio, img, this.#gridImageInfos);
		}
	}

	// --- Navigation ---

	/** Go to a specific page index. */
	goto(index: number): void {
		this.currentIndex.set(index);
		const parent = this.parent;
		// Dispatch gallery-show event so Gallery.svelte and album interface respond
		if (parent) {
			this.engine.micrio.events.dispatch('gallery-show', index);
		}
	}

	/** Go to the next page. */
	next(): void {
		const current = get(this.currentIndex);
		this.goto(Math.min(this.images.length - 1, current + 1));
	}

	/** Go to the previous page. */
	prev(): void {
		const current = get(this.currentIndex);
		this.goto(Math.max(0, current - 1));
	}
}
