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
 *  The slot is defined in normalized coordinates [x0,y0,x1,y1] within a virtual container
 *  of `containerWidth`×`containerHeight` pixels. Returns a centered sub-area that contains
 *  the image without stretching.
 */
function fitArea(
	slot: Models.Camera.ViewRect,
	containerWidth: number,
	containerHeight: number,
	imageWidth: number,
	imageHeight: number
): Models.Camera.ViewRect {
	const [x0, y0, x1, y1] = slot;
	const slotW = (x1 - x0) * containerWidth;
	const slotH = (y1 - y0) * containerHeight;
	const scale = Math.min(slotW / imageWidth, slotH / imageHeight);
	const renderW = (imageWidth * scale) / containerWidth;
	const renderH = (imageHeight * scale) / containerHeight;
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	return [cx - renderW / 2, cy - renderH / 2, cx + renderW / 2, cy + renderH / 2];
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

	/** Max width for the virtual container canvas (switch/swipe-full/omni galleries). */
	containerWidth: number = 0;
	/** Max height for the virtual container canvas (switch/swipe-full/omni galleries). */
	containerHeight: number = 0;

	get type(): Models.GalleryConfig['type'] { return this.config.type; }

	constructor(items: Models.GalleryItem[], engine: Engine, micrio: HTMLMicrioElement, config: Models.GalleryConfig) {
		this.engine = engine;
		this.micrio = micrio;
		this.config = config;

		const path = config.settings?.gallery && 'path' in config.settings.gallery
			? (config.settings.gallery as any).path
			: undefined;

		const isSwitch = config.type == 'switch' || config.type == 'swipe-full' || config.type == 'omni';
		const isSpreads = config.isSpreads;
		const coverPages = isSpreads ? (config.coverPages ?? 0) : 0;

		if (isSwitch) {
			this.containerHeight = Math.max(...items.map(p => p.height));
			this.containerWidth = Math.max(...items.map(p => p.width * (isSpreads ? 2 : 1)));
		}

		this.images = items.map((c, i) => {
			// Check config.revisions for per-image revision data
			const revision = config.revisions?.[c.id] ?? c.revision;
			// Check config.settings?.gallery?.revisions as fallback
			const galleryRevisions = (config.settings?.gallery as any)?.revisions;
			const rev = revision ?? galleryRevisions?.[c.id];

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

				let slot: Models.Camera.ViewRect;

				if (!isSpreads) {
					slot = [0, 0, 1, 1];
				} else {
					slot = i - coverPages < 0 || (i == items.length - 1 && (i - coverPages) % 2 == 0)
						? [0.25, 0, 0.75, 1]
						: (i - coverPages) % 2 == 0
							? [0, 0, 0.5, 1]
							: [0.5, 0, 1, 1];
				}

				opts.area = fitArea(slot, this.containerWidth, this.containerHeight, c.width, c.height);
			} else {
				opts.area = [i, 0, i + 1, 1];
			}

			return new MicrioImage(engine, {
				id: c.id,
				path: c.path ?? path as string,
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

	/** Result from fromIIIF: gallery + the raw response for single-image fallback */
	static async fromIIIF(url: string, engine: Engine, micrio: HTMLMicrioElement): Promise<{ gallery: Gallery | null; response: any }> {
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

			if (images.length === 1)
				return { gallery: null, response: resp };

			return {
				gallery: new Gallery(images, engine, micrio, { type: 'swipe', settings: {} }),
				response: resp
			};
		}

		// Raw IIIF Image API response — single image, not a gallery
		return { gallery: null, response: resp };
	}

	/** Extract single-image info from a raw IIIF Image API JSON response */
	static singleIIIFInfo(resp: any, url: string): Models.GalleryItem {
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

	static async fromArchive(archiveId: string, path: string, engine: Engine, micrio: HTMLMicrioElement, config?: Partial<Models.GalleryConfig> & { isArchive?: boolean }): Promise<Gallery> {
		const galleryConfig: Models.GalleryConfig = {
			type: 'swipe',
			...config
		};

		const useArchiveIndex = config?.isArchive ?? false;
		let entries: string[];

		if (useArchiveIndex) {
			const index = await Gallery.getArchiveIndex(archiveId.split('.')[0], path, engine, micrio);
			galleryConfig.archiveLayerOffset = index.delta;
			const sorted = index.images.sort(Gallery.sortArchiveImages(galleryConfig.sort));
			entries = sorted.map(i =>
				`${i.id},${i.width},${i.height},${i.isDeepZoom ? 'd' : ''},${i.isPng ? 'p' : i.isWebP ? 'w' : ''},${i.tileSize || ''}`.replace(/\,+$/, '')
			);
		} else {
			entries = archiveId.split(';').map(t => t.trim());
			const promises = entries.filter(t => t.startsWith('http')).map(u => fetchJson<Partial<Models.ImageInfo.ImageInfo>>(u));
			if (promises.length) {
				await Promise.all(promises).then(r => r.forEach((d, i: number) => {
					if (!d) return;
					entries[i] = `${(d as any)['@id'] || d.id},${d.width},${d.height}`;
				}));
			}
		}

		const pages = entries.map((e: string): any[] =>
			e.split(',').map((v: any) => isNaN(v) ? v : Number(v))
		);
		pages.forEach((p, i) => { if (i > 0 && !p[2]) p.push(...pages[i - 1].slice(1)); });

		if (!galleryConfig.type) galleryConfig.type = 'swipe';

		const items: Models.GalleryItem[] = pages.map(c => ({
			id: c[0],
			path,
			width: c[1],
			height: c[2],
			isDeepZoom: c[3] == 'd',
			isPng: c[4] == 'p',
			isWebP: c[4] == 'w',
			tileSize: c[5] || 1024,
			revision: galleryConfig.revisions?.[c[0]]
		}));

		return new Gallery(items, engine, micrio, galleryConfig);
	}

	static async fromGrid(gridData: string, engine: Engine, micrio: HTMLMicrioElement, config?: Partial<Models.GalleryConfig & { path?: string }>): Promise<{ gallery: Gallery; gridInfo?: { images: Models.ImageInfo.ImageInfo[] }; gridString?: string } | null> {
		const galleryConfig: Models.GalleryConfig = {
			type: 'grid',
			...config
		};

		if (!galleryConfig.settings) galleryConfig.settings = {};
		galleryConfig.settings.zoomLimit = 15;
		galleryConfig.settings.minimap = false;
		const path = config?.path ?? BASEPATH_V5;

		let gridInfo: { images: Models.ImageInfo.ImageInfo[] } | undefined;
		if (galleryConfig.archive && galleryConfig.archive == gridData) {
			gridInfo = await Gallery.getArchiveIndex(gridData.split('.')[0], path, engine, micrio);
			const s = galleryConfig.sort;
			if (s && gridInfo?.images) gridInfo.images.sort(Gallery.sortArchiveImages(s));
			gridData = gridInfo.images.map(i =>
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
		return { gallery, gridInfo };
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
			const result = await Gallery.fromGrid(aInfo.archive!, engine, micrio, { ...config, path });
			return result?.gallery ?? null;
		}

		return Gallery.fromArchive(aInfo.archive!, path, engine, micrio, { ...config, isArchive: true });
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
