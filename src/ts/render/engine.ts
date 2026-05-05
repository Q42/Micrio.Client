/**
 * Manages the Micrio compute engine, render loop, tile loading, and WebGL integration.
 * Hosts the pure TypeScript engine from src/engine/ and bridges it to the DOM/WebGL layer.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { TextureBitmap } from './textures';
import type { HTMLMicrioElement } from '$ts/element';
import type { Unsubscriber } from 'svelte/store';
import type { Camera } from '$ts/camera';
import type { Models } from '$types/models';

import { MicrioImage } from '$ts/image';
import { get } from 'svelte/store';
import { archive } from './archive';
import { Browser, once } from '$ts/utils';
import { loadTexture, runningThreads, numThreads, abortDownload } from './textures';

import { Main } from '$engine/main';
import TileCanvas from '$engine/canvas/canvas';
import type Image from '$engine/canvas/image';
import { segsX, segsY } from '$engine/globals';
import { easeInOut, easeIn, easeOut, linear } from '$engine/utils/utils';

/** Unified tile entry storing all state for a single tile. @internal */
interface TileEntry {
	texture?: WebGLTexture;
	loadState: number;
	opacity: number;
	loadedAt?: number;
	deleteAt?: number;
	timeoutId?: number;
}

/** Engine instance ID → canvas mapping. @internal */
interface CanvasEntry {
	canvas: TileCanvas;
	micrioImage: MicrioImage;
}

/**
 * The main Micrio compute controller class. Handles the engine lifecycle,
 * render loop, tile management, and WebGL integration.
 * Accessed via `micrio.engine`.
 */
export class Engine {

	ready: boolean = false;

	/** Array storing references to all MicrioImage instances managed by the engine. @internal */
	images: Array<MicrioImage | Models.Omni.Frame> = [];
	/** Flag indicating if barebone mode is active. @internal */
	private bareBone: boolean = false;
	/** Array storing the base tile index for each image. @internal */
	private baseTiles: number[] = [];
	/** Set storing the indices of tiles drawn in the current frame. @internal */
	private drawnSet: Set<number> = new Set();
	/** Set storing the indices of tiles drawn in the previous frame. @internal */
	private prevDrawnSet: Set<number> = new Set();
	/** Unified tile state storage. @internal */
	private tiles: Map<number, TileEntry> = new Map();
	/** Map tracking ongoing texture download requests. @internal */
	private requests: Map<number, string> = new Map();
	/** Forget in-memory tiles after X seconds not drawn */
	private deleteAfterSeconds: number;

	/** Array storing Svelte store unsubscriber functions. @internal */
	private unsubscribe: Unsubscriber[] = [];

	/** Map storing Camera instances associated with ptr. @internal */
	private cameras: Map<number, Camera> = new Map();
	/** O(1) ptr-to-image lookup for hot-path callbacks. @internal */
	private ptrToImage: Map<number, MicrioImage | Models.Omni.Frame> = new Map();

	preventDirectionSet: boolean = false;

	/** Shared Float32Array for standard tile vertex data. */
	_vertexBuffer!: Float32Array;
	/** Static Float32Array holding texture coordinates for a standard quad. */
	static readonly _textureBuffer: Float32Array = Engine.getTextureBuffer(1, 1);

	/** Shared Float32Array for 360 tile vertex data. */
	_vertexBuffer360!: Float32Array;
	/** Static Float32Array holding texture coordinates for the 360 sphere. */
	static _textureBuffer360: Float32Array;

	/** Flag indicating if the current context is a gallery. */
	private isGallery: boolean = false;

	private now: number = -1;
	private raf: number = -1;
	private drawing: boolean = false;

	/** The TS engine main controller. @internal */
	private engine!: Main;
	/** The currently active canvas entry. @internal */
	private activeCanvasEntry: CanvasEntry | null = null;
	/** Map from ptr → canvas entry. @internal */
	private canvasById: Map<number, CanvasEntry> = new Map();
	/** Map from TileCanvas → canvas entry (O(1) reverse lookup). @internal */
	private canvasToEntry: Map<TileCanvas, CanvasEntry> = new Map();
	/** Unique ptr counter. @internal */
	private nextPtr: number = 1;

	/** Returns the engine TileCanvas for a MicrioImage, or undefined. */
	getCanvas(img: MicrioImage | Models.Omni.Frame): TileCanvas | undefined {
		return this.canvasById.get(img.ptr)?.canvas;
	}

	/** Stores a canvas entry in both lookup maps. @internal */
	private setEntry(ptr: number, entry: CanvasEntry): void {
		this.canvasById.set(ptr, entry);
		if (!this.canvasToEntry.has(entry.canvas)) this.canvasToEntry.set(entry.canvas, entry);
	}

	constructor(
		public micrio: HTMLMicrioElement
	) {
		this.deleteAfterSeconds = Browser.iOS ? 5 : get(this.micrio.canvas.isMobile) ? 30 : 90;
		this.render = this.render.bind(this);
		this.draw = this.draw.bind(this);
		this.unsubscribe.push(micrio.current.subscribe(this.setCanvas.bind(this)));
	}

	/**
	 * Generates a Float32Array containing texture coordinates for a quad.
	 * @internal
	 */
	private static getTextureBuffer(
		segsX: number,
		segsY: number
	): Float32Array {
		const b = new Float32Array(2 * 6 * segsX * segsY);
		const dX = 1 / segsX, dY = 1 / segsY;
		for (let i = 0, y = 0; y < segsY; y++) for (let x = 0; x < segsX; x++, i += 12) {
			b[i + 3] = b[i + 7] = b[i + 9] = (b[i + 1] = b[i + 5] = b[i + 11] = y * dY) + dY;
			b[i + 4] = b[i + 8] = b[i + 10] = (b[i + 0] = b[i + 2] = b[i + 6] = x * dX) + dX;
		} return b;
	}

	/**
	 * Initializes the engine (replaces WebAssembly loading).
	 * @throws Error if engine initialization fails
	 */
	async load(): Promise<void> {
		if (this.engine) return;

		const engine = new Main({
			drawTile: this.drawTile.bind(this),
			drawQuad: this._hostDrawQuad.bind(this),
			getTileOpacity: this._hostGetTileOpacity.bind(this),
			setTileOpacity: this._hostSetTileOpacity.bind(this),
			setMatrix: this._hostSetMatrix.bind(this),
			setViewport: this._hostSetViewport.bind(this),
			aniDone: this._hostAniDone.bind(this),
			aniAbort: this._hostAniAbort.bind(this),
			viewSet: this._hostViewSet.bind(this),
			viewportSet: this._hostViewportSet.bind(this),
			setVisible: this._hostSetVisible.bind(this),
			setVisible2: this._hostSetVisible2.bind(this),
		});

		this._vertexBuffer = engine.vertexBuffer;
		this._vertexBuffer360 = engine.vertexBuffer360;
		Engine._textureBuffer360 = Engine.getTextureBuffer(segsX, segsY);

		this.engine = engine;

		this.unsubscribe.push(this.micrio.barebone.subscribe(b => {
			this.bareBone = b;
			this.engine.bareBone = b;
		}));
	}

	/** Finds the public Camera instance associated with an engine Canvas. @internal */
	private findCamera(c: TileCanvas): Camera | undefined {
		const entry = this.canvasToEntry.get(c);
		return entry ? this.cameras.get(entry.micrioImage.ptr) : undefined;
	}

	/** Finds the canvas entry associated with an engine Canvas or Image. @internal */
	private findEntry(c: TileCanvas | Image): CanvasEntry | undefined {
		if (c instanceof TileCanvas) return this.canvasToEntry.get(c);
		return undefined;
	}

	private _hostDrawQuad(opacity: number): void { this.micrio.webgl.drawTile(undefined, opacity); }
	private _hostGetTileOpacity(i: number): number { return this.tiles.get(i)?.opacity || 0; }
	private _hostSetTileOpacity(i: number, direct: boolean = false, imageOpacity: number = 1): number {
		const tile = this.tiles.get(i);
		if (!tile) return 0;
		if (tile.opacity < 1) {
			tile.opacity = direct ? 1 : (tile.loadedAt && tile.loadedAt > 0 ? Math.min(1, (this.now - tile.loadedAt) / 250) * imageOpacity : 0);
		}
		return tile.opacity;
	}
	private _hostSetMatrix(arr: Float32Array): void {
		this.micrio.webgl.gl.uniformMatrix4fv(this.micrio.webgl.pmLoc, false, arr);
	}
	private _hostSetViewport(left: number, bottom: number, w: number, h: number): void {
		this.micrio.webgl.gl.viewport(Math.floor(left), Math.floor(bottom), Math.ceil(w), Math.ceil(h));
	}
	private _hostAniDone(c: TileCanvas): void {
		const cam = this.findCamera(c);
		if (!cam) return;
		if (cam.aniDone) cam.aniDone();
		while (cam.aniDoneAdd.length) cam.aniDoneAdd.shift()?.();
		cam.aniAbort = cam.aniDone = undefined;
	}
	private _hostAniAbort(c: TileCanvas): void {
		const cam = this.findCamera(c);
		if (!cam) return;
		if (cam.aniAbort) cam.aniAbort();
		cam.aniDoneAdd.length = 0;
		cam.aniAbort = cam.aniDone = undefined;
	}
	private _hostViewSet(c: TileCanvas): void { this.findCamera(c)?.viewChanged(); }
	private _hostViewportSet(c: TileCanvas, x: number, y: number, w: number, h: number): void {
		const entry = this.findEntry(c);
		if (entry && 'viewport' in entry.micrioImage) {
			(entry.micrioImage as MicrioImage).viewport.set([x, y, w, h]);
		}
	}
	private _hostSetVisible(c: TileCanvas, visible: boolean): void {
		this.findEntry(c)?.micrioImage?.visible?.set(visible);
	}
	private _hostSetVisible2(img: Image, visible: boolean): void {
		this.findEntry(img)?.micrioImage?.visible?.set(visible);
	}

	/** Unbinds event listeners, stops rendering, and cleans up resources. */
	unbind(): void {
		this.stop();
		while (this.unsubscribe.length) this.unsubscribe.shift()?.();
		this.requests.forEach(src => abortDownload(src));
		this.requests.clear();
		for (const [idx, tile] of this.tiles.entries()) {
			if (tile.timeoutId) clearTimeout(tile.timeoutId);
			this.deleteTile(idx);
		}
		this.tiles.clear();
		if (this.engine) this.engine.reset();
	}

	/**
	 * Adds a new image canvas instance to the engine.
	 * @internal
	 */
	private addCanvas(c: MicrioImage): void {
		const i = c.$info;
		if (!i) return;
		if (c.error) {
			this.micrio.loading.set(false);
			return;
		}

		if (!c.noImage && (!i.width || !i.height)) throw 'Invalid Micrio image size';

		const settings = c.$settings;

		this.isGallery = !!i.gallery || c.isOmni;

		if (settings.gallery?.archive) {
			this.engine.hasArchive = true;
			this.engine.archiveLayerOffset = settings.gallery.archiveLayerOffset ?? 0;
		}
		if (i.version && parseFloat(i.version) <= 3.1) this.engine.underzoomLevels = 8;

		if (i.is360) settings.limitToCoverScale = false;
		const coverLimit = !!settings.limitToCoverScale;
		const coverStart = coverLimit || settings.initType == 'cover';

		if (c.noImage) this.micrio.loading.set(false);

		const focus = [.5, .5];
		const f = settings.focus;
		const isSpaces = !!i.spacesId;
		if (f) {
			if (!isNaN(f[0]) && f[0] !== null) focus[0] = f[0];
			if (!isNaN(f[1]) && f[1] !== null) focus[1] = f[1];
		}

		const vid360 = settings._360?.video;
		const is360Video = i.is360 && vid360 && (vid360.src || ('video' in vid360 && vid360.video));

		const gallerySwitch = !!this.isGallery && (settings.gallery?.type == 'switch'
			|| settings.gallery?.type == 'omni'
			|| settings.gallery?.type == 'swipe-full');

		const numOmniLayers = settings.omni?.layers?.length ?? 1;
		if (settings.omni) settings.omni.layerStartIndex = Math.min(numOmniLayers - 1, settings.omni?.layerStartIndex ?? 0);

		const canvas = new TileCanvas(
			this.engine,
			i.width, i.height,
			c.opacity,
			coverLimit,
			{
				tileSize: i.tileSize ?? 1024,
				is360: i.is360 ?? false,
				noImage: c.noImage,
				isSingle: !!(i.isSingle || is360Video),
				freeMove: settings.freeMove ?? false,
				coverStart,
				maxScale: settings.zoomLimit || 1,
				scaleMultiplier: settings.zoomLimitDPRFix !== false ? this.micrio.canvas.getRatio(c.$settings) : 1,
				camSpeed: settings.camspeed ?? 1,
				rotationY: c.camera.rotationY,
				isGallerySwitch: gallerySwitch,
				pagesHaveBackground: !!settings.gallery?.isSpreads && settings.gallery.type == 'swipe',
				isOmni: c.isOmni,
				pinchZoomOutLimit: settings.pinchZoomOutLimit ?? false,
				omniNumLayers: numOmniLayers,
				omniStartLayer: settings.omni?.layerStartIndex ?? 0,
			},
			false,
		);

		const ptr = this.nextPtr++;
		c.ptr = ptr;
		this.setEntry(ptr, { canvas, micrioImage: c });
		this.images.push(c);
		this.ptrToImage.set(c.ptr, c);
		this.cameras.set(c.ptr, c.camera);

		this.bindCamera(c);

		if (c.opts.area) c.camera.setArea(c.opts.area, { direct: true, noDispatch: true, noRender: true });

		if (settings?.restrict) c.camera.setLimit(settings.restrict);

		if (settings?.crossfadeDuration)
			this.setCrossfadeDuration(settings.crossfadeDuration);
		if (settings?.embedFadeDuration)
			this.engine.embedFadeDuration = settings.embedFadeDuration;
		if (settings?.dragElasticity !== undefined)
			this.engine.dragElasticity = settings.dragElasticity;
		if (settings?.skipBaseLevels)
			this.engine.skipBaseLevels = settings.skipBaseLevels;

		if (settings?.omni) c.camera.setOmniSettings();
		if (this.micrio.hasAttribute('data-limited')) this.setLimited(c.ptr, true);

		canvas.sendViewport();

		const numTiles = this.engine.numTiles;
		if (numTiles > 0) {
			const baseTileIdx = numTiles - 1;
			this.getTileEntry(baseTileIdx).opacity = 1;
			this.baseTiles.push(baseTileIdx);
		}

		const v = get(c.state.view) || settings.view;
		if (v && !(v[0] == 0 && v[1] == 0 && v[2] == 1 && v[3] == 1)) {
			canvas.setView(v[0] + v[2] / 2, v[1] + v[3] / 2, v[2], v[3], false, false, false, false);
		} else if ((isSpaces || !i.is360) && focus && focus.toString() != '0.5,0.5') {
			canvas.camera.setCoo(focus[0], focus[1], 0, 0, 0, false, 0, performance.now());
			settings.focus = undefined;
		}

		c.video.subscribe(v => v && v.addEventListener('play', this.render));

		if (c.noImage) c.visible.set(true);

		this.setCanvas(c);
	}

	/**
	 * Binds a MicrioImage's Camera instance to the engine canvas and typed arrays.
	 * @internal
	 */
	private bindCamera(img: MicrioImage): void {
		const canvas = this.canvasById.get(img.ptr)!.canvas;
		this.cameras.set(img.ptr, img.camera);
		img.camera.bindEngineCanvas(canvas);
		if (canvas.is360) {
			img.camera.assign(
				canvas.view.arr,
				canvas.webgl.coo.arr,
				canvas.webgl.coo.arr,
				canvas.webgl.iMatrix.arr,
			);
		} else {
			img.camera.assign(
				canvas.view.arr,
				canvas.camera.xy.arr,
				canvas.camera.coo.arr,
				canvas.webgl.pMatrix.arr,
			);
		}
	}

	/**
	 * Sets the currently active canvas/image instance in the engine.
	 */
	setCanvas(canvas?: MicrioImage): void {
		if (!canvas || (canvas.ptr > 0 && canvas.ptr === this.activeCanvasEntry?.micrioImage.ptr)) return;

		if (canvas.ptr < 0) once(canvas.info).then(info => {
			if (!info) return;
			if (!this.micrio.$current || (!info.isIIIF && !canvas.opts.secondaryTo && info.id != this.micrio.$current.id)) return;
			this.addCanvas(canvas);
			if (canvas.embeds.length) canvas.embeds.forEach(e => this.addEmbed(e, canvas));
		});
		else if (canvas.ptr !== this.activeCanvasEntry?.micrioImage.ptr) {
			const entry = this.canvasById.get(canvas.ptr);
			if (!entry) return;

			const pitch = canvas.is360 && this.activeCanvasEntry ? this.activeCanvasEntry.canvas.webgl.pitch : 0;
			this.activeCanvasEntry = entry;

			if (canvas.is360 && !this.preventDirectionSet) {
				const reversedYaw = ((this.engine.direction + 0.5) % 1) * Math.PI * 2;
				entry.canvas.setDirection(reversedYaw - canvas.camera.rotationY, pitch, true);
			}

			if (entry.canvas.targetOpacity === 0) entry.canvas.fadeIn();

			if (canvas.$settings.omni?.layerStartIndex) canvas.state.layer.set(canvas.$settings.omni.layerStartIndex);
			this.preventDirectionSet = false;
			this.ready = true;
			this.render();
		}
	}

	/** Removes a canvas instance from the engine. */
	removeCanvas(c: MicrioImage): void {
		if (c.ptr < 0) throw 'Canvas is not placed yet';
		const entry = this.canvasById.get(c.ptr);
		if (!entry) return;
		entry.canvas.remove();
		this.canvasById.delete(c.ptr);
		this.render();
	}

	/** Requests the next animation frame. */
	render(): void {
		if (this.raf < 0) this.raf = this.micrio.webgl.display.requestAnimationFrame(this.draw);
	}

	/**
	 * The main drawing loop, called by requestAnimationFrame.
	 * @internal
	 */
	private draw(now: number = performance.now()): void {
		if (!this.micrio.isConnected || !this.micrio.$current) return;

		this.raf = -1;
		this.drawing = false;
		this.now = now;

		if (this.engine.shouldDraw(now)
			|| this.micrio.keepRendering
			|| this.micrio.events.isNavigating
			|| this.micrio._current?._video?.paused === false) {
			this.render();
		}

		if (this.isGallery) this.drawStart();
		this.drawnSet.clear();
		this.engine.draw();

		this.micrio.events.dispatch('draw');

		this.cleanup();

		this.micrio.webgl.drawEnd();
	}

	/** Stops the rendering loop. @internal */
	private stop(): void {
		if (this.raf < 0) return;
		this.micrio.webgl.display.cancelAnimationFrame(this.raf);
		this.raf = -1;
	}

	/**
	 * Gets or creates a tile entry for the given index.
	 * @internal
	 */
	private getTileEntry(i: number): TileEntry {
		let tile = this.tiles.get(i);
		if (!tile) {
			tile = { loadState: 0, opacity: 0 };
			this.tiles.set(i, tile);
		}
		return tile;
	}

	/**
	 * Callback for the engine to request drawing a tile.
	 * @returns True if the tile texture is ready and drawn, false otherwise.
	 */
	private drawTile(
		imgIdx: number,
		i: number,
		layer: number,
		x: number,
		y: number,
		opacity: number,
		animating: boolean,
		targetLayer: boolean
	): boolean {
		this.drawnSet.add(i);
		const tile = this.getTileEntry(i);
		tile.deleteAt = undefined;

		const numLoading = runningThreads();
		const c = this.images[imgIdx];
		const isVideo = 'camera' in c && c.isVideo;
		const is360 = 'camera' in c && c.is360;
		const img = 'camera' in c ? c : c.image;
		const frame = 'frame' in c ? c.frame : undefined;

		if (tile.loadState === 0 && numLoading < numThreads) {
			if (this.bareBone ? numLoading > 2 && animating : targetLayer && animating && numLoading > 0) return false;

			if (isVideo && !is360) {
				tile.loadState = 2;
				tile.texture = this.micrio.webgl.getTexture();
			}
			else {
				tile.loadState = 1;
				const src = img.getTileSrc(layer, x, y, frame);
				if (src) this.getTexture(i, src, animating, {
					noSmoothing: '$info' in c && c.$settings.noSmoothing
				});
				else {
					tile.loadState = 0;
					return false;
				}
			}
		}
		else if (tile.loadState >= 2) {
			if (!this.drawing) this.drawStart();

			if (tile.texture) {
				if (isVideo) {
					if (!img._video || !img._video.dataset.playing) return false;
					this.micrio.webgl.updateTexture(tile.texture, img._video);
				}
				this.micrio.webgl.drawTile(tile.texture, opacity, is360);
			}

			if (tile.loadState === 2) {
				tile.loadState = 3;
				tile.loadedAt = this.now;
			}

			return true;
		}
		return false;
	}

	/** Prepares the WebGL context for drawing a new frame. @internal */
	private drawStart(): void {
		if (this.drawing) return;
		this.micrio.webgl.drawStart();
		this.drawing = true;
	}

	/**
	 * Initiates loading of a texture using the texture loader utility.
	 * @internal
	 */
	getTexture(i: number, src: string, ani: boolean, opts: {
		force?: boolean;
		noSmoothing?: boolean
	} = {}): void {
		const tile = this.tiles.get(i);
		if (tile?.texture || this.requests.has(i) || (!opts.force && runningThreads() >= numThreads)) return;
		const inArchive = archive.db.has(src);
		if (!inArchive) this.micrio.loading.set(true);
		this.requests.set(i, src);
		(inArchive ? archive.getImage(src) : loadTexture(src))
			.then((img) => this.gotTexture(i, img, ani, opts.noSmoothing))
			.catch(() => this.deleteRequest(i));
	}

	/**
	 * Callback executed when a texture bitmap is successfully loaded.
	 * @internal
	 */
	private gotTexture(
		i: number,
		img: TextureBitmap,
		ani: boolean,
		noSmoothing?: boolean
	): void {
		const tile = this.getTileEntry(i);
		tile.texture = this.micrio.webgl.getTexture(img, tile.texture, noSmoothing);
		if (self.ImageBitmap !== undefined && img instanceof ImageBitmap && img.close instanceof Function) img.close();
		tile.loadState = 2;

		tile.timeoutId = setTimeout(() => {
			this.deleteRequest(i);
		}, ani ? 150 : 50) as unknown as number;
	}

	/** Removes a request from the tracking map. @internal */
	private deleteRequest(i: number): void {
		this.requests.delete(i);
		const tile = this.tiles.get(i);
		if (tile?.timeoutId) {
			clearTimeout(tile.timeoutId);
			tile.timeoutId = undefined;
		}

		if (!this.requests.size) this.micrio.loading.set(false);
	}

	/** Deletes a WebGL texture and associated state. @internal */
	private deleteTile(idx: number): void {
		const tile = this.tiles.get(idx);
		if (tile) {
			if (tile.texture) this.micrio.webgl.gl.deleteTexture(tile.texture);
			if (tile.timeoutId) clearTimeout(tile.timeoutId);
			this.tiles.delete(idx);
		}
	}

	/**
	 * Performs cleanup after each frame.
	 * @internal
	 */
	private cleanup(): void {
		const now = performance.now();

		for (const idx of this.prevDrawnSet) {
			if (this.drawnSet.has(idx)) continue;
			if (this.baseTiles.includes(idx)) continue;

			const tile = this.tiles.get(idx);
			if (!tile || tile.loadState === 0) continue;

			tile.opacity = 0;

			switch (tile.loadState) {
				case 1:
					const request = this.requests.get(idx);
					if (request) abortDownload(request);
					tile.loadState = 0;
					break;

				case 2:
					if (this.requests.has(idx)) {
						this.deleteRequest(idx);
					}
					this.deleteTile(idx);
					break;

				case 3:
					if (!tile.deleteAt) tile.deleteAt = now;
					break;
			}
		}

		this.prevDrawnSet = new Set(this.drawnSet);

		for (const [idx, tile] of this.tiles.entries()) {
			if (tile.deleteAt && (now - tile.deleteAt) / 1000 > this.deleteAfterSeconds) {
				this.deleteTile(idx);
			}
		}
	}

	/**
	 * Resizes the viewport and updates engine dimensions.
	 * @internal
	 */
	resize(c: Models.Canvas.ViewRect): void {
		this.engine.resize(c.width, c.height, c.left, c.top, c.ratio, c.scale, c.portrait);
		if (this.ready) { this.stop(); this.draw(); }
	}

	/** Add a child image to the current canvas, either embed or independent canvas */
	private addImage = async (
		image: MicrioImage,
		parent: MicrioImage,
		isEmbed: boolean = false,
		opacity: number = 1
	): Promise<void> => once(image.info).then((i): void => {
		if (!i) return;
		this.images.push(image);

		const a = image.opts.area ?? [0, 0, 1, 1];
		const _360 = image.$settings._360 ?? {};
		const parentEntry = this.canvasById.get(parent.ptr);
		if (!parentEntry) return;

		let canvas: TileCanvas;
		if (!isEmbed) {
			canvas = parentEntry.canvas.addChild(a[0], a[1], a[2], a[3], i.width, i.height);
		} else {
			parentEntry.canvas.addImage(a[0], a[1], a[2], a[3], i.width, i.height, i.tileSize || 1024, i.isSingle ?? false, i.isVideo ?? false, opacity, _360.rotX ?? 0, _360.rotY ?? 0, _360.rotZ ?? 0, _360.scale ?? 1, 0);
			const ptr = this.nextPtr++;
			image.ptr = ptr;
			this.setEntry(ptr, { canvas: parentEntry.canvas, micrioImage: image });
			this.ptrToImage.set(ptr, image);

			image.baseTileIdx = this.engine.numTiles - 1;
			this.getTileEntry(image.baseTileIdx).opacity = 1;
			this.baseTiles.push(image.baseTileIdx);
			return;
		}

		const ptr = this.nextPtr++;
		image.ptr = ptr;
		this.setEntry(ptr, { canvas, micrioImage: image });
		this.ptrToImage.set(ptr, image);

		if (!isEmbed) {
			this.bindCamera(image);
			if (image.$settings.focus) canvas.camera.setCoo(image.$settings.focus[0], image.$settings.focus[1], 0, 0, 0, false, 0, performance.now());
			/** @ts-ignore */
			const v = image.$info['view'];
			if (v && v.toString() != '0,0,1,1') canvas.setView(v[0], v[1], v[2], v[3], false, false, false, false);

			canvas.sendViewport();
		}

		image.baseTileIdx = this.engine.numTiles - 1;
		this.getTileEntry(image.baseTileIdx).opacity = 1;
		this.baseTiles.push(image.baseTileIdx);
	})

	/**
	 * Adds an embedded MicrioImage instance.
	 * @internal
	 */
	addEmbed(image: MicrioImage | Models.Omni.Frame, parent: MicrioImage, opts: Models.Embeds.EmbedOptions = {}): Promise<void> | void {
		if ('camera' in image && opts.asImage) return this.addImage(image, parent, true, opts.opacity ?? 1);
		else {
			const i = '$info' in image ? image.$info : parent.$info;
			if (!i) return;
			this.images.push(image);
			const a = image.opts.area ?? [0, 0, 1, 1];
			const _360 = image instanceof MicrioImage ? image.$settings._360 ?? {} : {};
			const parentEntry = this.canvasById.get(parent.ptr);
			if (!parentEntry) return;
			parentEntry.canvas.addImage(a[0], a[1], a[2], a[3], i.width, i.height, i.tileSize || 1024, i.isSingle ?? false, i.isVideo ?? false, opts.opacity ?? 1, _360.rotX ?? 0, _360.rotY ?? 0, _360.rotZ ?? 0, _360.scale ?? 1, opts.fromScale ?? 0);
			const ptr = this.nextPtr++;
			image.ptr = ptr;
			this.setEntry(ptr, { canvas: parentEntry.canvas, micrioImage: image as MicrioImage });
			this.ptrToImage.set(ptr, image);
			image.baseTileIdx = this.engine.numTiles - 1;
			this.getTileEntry(image.baseTileIdx).opacity = 1;
			this.baseTiles.push(image.baseTileIdx);
		}
	}

	/** Add a child independent canvas to the current canvas */
	addChild = (image: MicrioImage, parent: MicrioImage) => this.addImage(image, parent);

	/** Sets the active image frame index for an Omni object. @internal */
	setActiveImage(ptr: number, idx: number, num?: number): void {
		this.getCanvas(this.ptrToImage.get(ptr)!)?.setActiveImage(idx, num ?? 0);
	}

	/** Sets the active layer index for an Omni object. @internal */
	setActiveLayer(ptr: number, idx: number): void {
		this.getCanvas(this.ptrToImage.get(ptr)!)?.setActiveLayer(idx);
	}

	/**
	 * Fades an image (main or embed) to a target opacity.
	 * @internal
	 */
	fadeImage(ptr: number, opacity: number, direct: boolean = false): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (!c) return;
		if (this.cameras.has(ptr)) {
			c.targetOpacity = opacity;
		} else {
			const images = c.images;
			for (let i = 0; i < images.length; i++) {
				const img = images[i];
				if (img.localIdx > 0) {
					img.tOpacity = opacity;
					if (direct) img.opacity = opacity;
				}
			}
		}
		this.render();
	}

	/**
	 * Sets the focus point for zoom operations.
	 * @internal
	 */
	setFocus(ptr: number, v: Models.Camera.ViewRect, noLimit: boolean = false): void {
		this.getCanvas(this.ptrToImage.get(ptr)!)?.setFocus(v[0], v[1], v[2], v[3], noLimit);
	}

	// --- Facade methods (delegate to engine) ---

	setZIndex(ptr: number, z: number): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (c) c.zIndex = z;
	}
	setGridTransitionDuration(dur: number): void { this.engine.gridTransitionDuration = dur; }
	setGridTransitionTimingFunction(fn: number): void {
		this.engine.gridTransitionTimingFunction = fn === 0 ? easeInOut : fn === 1 ? easeIn : fn === 2 ? easeOut : fn === 3 ? linear : easeInOut;
	}
	setCrossfadeDuration(dur: number): void { this.engine.crossfadeDuration = dur; }
	fadeTo(ptr: number, opacity: number, direct: boolean): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (!c) return;
		c.targetOpacity = opacity;
		if (direct) c.opacity = opacity;
	}
	fadeIn(ptr: number): void { this.getCanvas(this.ptrToImage.get(ptr)!)?.fadeIn(); }
	fadeOut(ptr: number): void { this.getCanvas(this.ptrToImage.get(ptr)!)?.fadeOut(); }
	areaAnimating(ptr: number): boolean { return this.getCanvas(this.ptrToImage.get(ptr)!)?.areaAnimating() ?? false; }
	getActiveImageIdx(ptr: number): number { return this.getCanvas(this.ptrToImage.get(ptr)!)?.activeImageIdx ?? -1; }
	setNoPinchPan(v: boolean): void { this.engine.noPinchPan = v; }
	setIsSwipe(v: boolean): void { this.engine.isSwipe = v; }
	ease(p: number): number { return easeInOut.get(p); }
	panStart(ptr: number): void { this.getCanvas(this.ptrToImage.get(ptr)!)?.kinetic.stop(); }
	panStop(ptr: number): void { this.getCanvas(this.ptrToImage.get(ptr)!)?.kinetic.start(); }
	pinchStart(ptr: number): void { this.getCanvas(this.ptrToImage.get(ptr)!)?.camera.pinchStart(); }
	pinch(ptr: number, x0: number, y0: number, x1: number, y1: number): void {
		this.getCanvas(this.ptrToImage.get(ptr)!)?.camera.pinch(x0, y0, x1, y1);
	}
	pinchStop(ptr: number, t: number): void {
		this.getCanvas(this.ptrToImage.get(ptr)!)?.camera.pinchStop(t);
	}
	setLimited(ptr: number, v: boolean): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (c) c.limited = v;
	}
	set360Orientation(d: number, dX: number, dY: number): void {
		this.engine.direction = d;
		this.engine.distanceX = dX;
		this.engine.distanceY = dY;
	}
	setCanvasArea(w: number, h: number): void {
		this.engine.el.areaWidth = w;
		this.engine.el.areaHeight = h;
	}
	setImageVideoPlaying(ptr: number, playing: boolean): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (!c) return;
		const images = c.images;
		for (let i = 0; i < images.length; i++) {
			if (images[i].isVideo) { images[i].isVideoPlaying = playing; break; }
		}
	}
	setImageRotation(ptr: number, rotX: number, rotY: number, rotZ: number): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (!c) return;
		const images = c.images;
		for (let i = 0; i < images.length; i++) {
			const im = images[i];
			if (im.localIdx > 0) { im.rotX = rotX; im.rotY = rotY; im.rotZ = rotZ; break; }
		}
	}
	setOmniSettings(ptr: number, d: number, fov: number, vA: number, oX: number): void {
		const c = this.getCanvas(this.ptrToImage.get(ptr)!);
		if (!c) return;
		c.omniDistance = d;
		c.omniFieldOfView = fov;
		c.omniVerticalAngle = vA;
		c.omniOffsetX = oX;
	}
}
