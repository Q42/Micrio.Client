import type { Models } from '$types/models';
import type { Engine } from './render/engine';
import type { HTMLMicrioElement } from './element';

import { MicrioImage } from './image';
import { fetchJson, jsonCache } from './utils/fetch';
import { MicrioError } from './utils/error';
import { DataLoader } from './utils/dataLoader';
import { archive } from './render/archive';
import { Grid } from './nav/grid';
import { writable, get, type Writable } from 'svelte/store';
import { BASEPATH, BASEPATH_V5, DEFAULT_INFO } from './globals';

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
	swiper: any = null;
	grid: Grid | null = null;

	readonly currentIndex: Writable<number> = writable(0);

	/** For grid-type galleries, the processed grid string for Grid controller. */
	_gridString: string | undefined;

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

			const imageSettings: Record<string, any> = { skipMeta: true, ...config.settings };

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
				path: c.path,
				width: c.width,
				height: c.height,
				isDeepZoom: c.isDeepZoom,
				isPng: c.isPng,
				isWebP: c.isWebP,
				tileSize: c.tileSize ?? DEFAULT_INFO.tileSize,
				revision: rev,
				settings: imageSettings as any
			}, opts);
		});
	}

	// --- Factory Methods ---

	/** Create a gallery from a IIIF Presentation API 3 manifest. Returns null for single-image manifests and raw Image API responses. */
	static async fromIIIF(url: string, engine: Engine, micrio: HTMLMicrioElement): Promise<Gallery | null> {
		const resp = await fetchJson<any>(url);

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
				tileSize: DEFAULT_INFO.tileSize
			}));

			if (images.length === 1) return null;

			return new Gallery(images, engine, micrio, { type: 'swipe', settings: {} });
		}

		return null;
	}

	/** Extract single-image gallery item from a IIIF response URL */
	static async singleIIIFInfo(url: string): Promise<Models.GalleryItem> {
		const resp = await fetchJson<any>(url);
		const baseId = (resp['@id'] || resp.id || url).replace('/info.json', '');
		return {
			id: baseId.replace(/^.*\//, ''),
			width: resp.width,
			height: resp.height,
			tileSize: resp.tiles?.[0]?.width ?? DEFAULT_INFO.tileSize,
			path: baseId.replace(/\/[^/]*$/, '')
		};
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
			tileSize: 1024
		}));

		return new Gallery(items, engine, micrio, {
			type: 'swipe',
			startId: opts?.startId,
			settings: {}
		});
	}

	static async fromArchive(archiveId: string, path: string, engine: Engine, micrio: HTMLMicrioElement, config?: Partial<Models.GalleryConfig>): Promise<Gallery> {
		const galleryConfig: Models.GalleryConfig = { type: 'swipe', ...config };

		const index = await Gallery.getArchiveIndex(archiveId.split('.')[0], path, engine, micrio);
		galleryConfig.archiveLayerOffset = index.delta;
		const sorted = index.images.sort(Gallery.sortArchiveImages(galleryConfig.sort));

		const items: Models.GalleryItem[] = sorted.map(i => ({
			id: i.id,
			path,
			width: i.width,
			height: i.height,
			isDeepZoom: i.isDeepZoom,
			isPng: i.isPng,
			isWebP: i.isWebP,
			tileSize: i.tileSize || 1024,
		}));

		return new Gallery(items, engine, micrio, galleryConfig);
	}

	static async fromGrid(gridData: string, engine: Engine, micrio: HTMLMicrioElement, config?: Partial<Models.GalleryConfig & { path?: string }>): Promise<Gallery | null> {
		const galleryConfig: Models.GalleryConfig = { type: 'grid', ...config };

		if (!galleryConfig.settings) galleryConfig.settings = {};
		galleryConfig.settings.zoomLimit = 15;
		galleryConfig.settings.minimap = false;
		const path = config?.path ?? BASEPATH_V5;

		if (galleryConfig.archive && galleryConfig.archive == gridData) {
			const index = await Gallery.getArchiveIndex(gridData.split('.')[0], path, engine, micrio);
			const s = galleryConfig.sort;
			if (s && index?.images) index.images.sort(Gallery.sortArchiveImages(s));
			gridData = index.images.map(i =>
				Grid.getString(i, { cultures: 'cultures' in i ? (i.cultures as string[]).join('-') : undefined })
			).join(';');
		}

		const pages = gridData.split(';').map(t => t.trim());
		const items: Models.GalleryItem[] = pages.map(e => {
			const parts = e.split(',').map((v: any) => isNaN(v) ? v : Number(v));
			return { id: parts[0], width: parts[1] ?? 0, height: parts[2] ?? 0, path };
		});

		const gallery = new Gallery(items, engine, micrio, galleryConfig);
		gallery._gridString = gridData;
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

		if (aInfo.type === 'grid') {
			return Gallery.fromGrid(aInfo.archive!, engine, micrio, { ...config, path });
		}

		return Gallery.fromArchive(aInfo.archive!, path, engine, micrio, config);
	}

	// --- Static Helpers ---

	private static getArchiveIndex = async (id: string, path: string, _engine: Engine, _micrio: HTMLMicrioElement):
		Promise<{ delta?: number; images: Models.ImageInfo.ImageInfo[] }> =>
		archive.get<{ images: Models.ImageInfo.ImageInfo[] }>(`${path}${id}.json`)
			.then(r => { r.images.forEach(i => jsonCache.set(`${path}${i.id}/info.json`, i)); return r; });

	private static sortArchiveImages(sort: string | undefined): (a: Models.ImageInfo.ImageInfo, b: Models.ImageInfo.ImageInfo) => number {
		return sort == 'random' ? () => Math.random() - .5
			: sort == 'name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0
				: sort == '-name' ? (a, b) => !a.title || !b.title ? 0 : a.title < b.title ? 1 : a.title > b.title ? -1 : 0
					: sort == '-created' ? (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? 1 : a.created > b.created ? -1 : 0
						: (a, b) => !a.created || !b.created ? 0 : a.created < b.created ? -1 : a.created > b.created ? 1 : 0;
	}

	// --- Page Layout ---

	/** Compute the page layout for Gallery.svelte. Returns pages (camera views) and
	 *  the mapping from page index to image index(es). For strip-swipe galleries each
	 *  image fills the full viewport; for switch/grid the per-image `opts.area` is used
	 *  and spreads are merged into single pages. */
	getPageLayout(): { pages: Models.Camera.View[]; pageIdxes: number[][] } {
		const isSwitch = this.config.type == 'switch';
		const isSpread = !!this.config.isSpreads;
		const coverPages = this.config.coverPages ?? 0;
		const pages: Models.Camera.View[] = [];
		const pageIdxes: number[][] = [];

		if (!isSwitch) {
			for (let i = 0; i < this.images.length; i++) {
				pages.push([0, 0, 1, 1]);
				pageIdxes.push([i]);
			}
		} else {
			for (let i = 0; i < this.images.length; i++) {
				const area = this.images[i].opts?.area;
				if (!area) continue;
				const v: Models.Camera.View = [area[0], area[1], area[2], area[3]];
				pageIdxes.push([i]);

				if (isSpread && (i - coverPages >= 0 && ((i - coverPages) % 2 == 0)) && this.images[i + 1]) {
					const next = this.images[i + 1].opts?.area;
					if (!next) continue;
					i++;
					pageIdxes[pageIdxes.length - 1].push(i);
					v[2] = v[2] + next[2];
					v[3] = Math.max(v[3], next[3]);
				}
				pages.push(v);
			}
		}

		return { pages, pageIdxes };
	}

	// --- Instance Methods ---

	attach(parent: MicrioImage): void {
		this.parent = parent;
		(parent as any).__gallery = this;
	}

	detach(): void {
		if (this.parent) {
			delete (this.parent as any).__gallery;
			this.parent = null;
		}
	}

	destroy(): void {
		this.detach();
		if (this.swiper) {
			this.swiper.destroy();
			this.swiper = null;
		}
		this.grid = null;
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
