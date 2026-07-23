/**
 * Manages the Micrio compute engine, render loop, tile loading, and WebGL integration.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { TextureBitmap } from './textures';
import type { HTMLMicrioElement } from '$core/element';
import type { Unsubscriber } from '$core/store';
import type { Camera } from '$core/camera';
import type { Models } from '$types/models';

import { MicrioImage } from '$core/image';
import { DEFAULT_TILE_SIZE } from '$core/globals';
import { get } from '$core/store';
import { archive } from '$utils/archive';
import { Browser } from '$utils/browser';
import { loadTexture, runningThreads, numThreads, abortDownload } from './textures';

import { TileCanvas } from './tile-canvas';
import type Image from './tile-image';
import { segsX, segsY } from './constants';
import { type Bicubic, easeInOut } from './easing';
import { Viewport } from './shared';

interface TileEntry {
	texture?: WebGLTexture;
	loadState: number;
	opacity: number;
	loadedAt?: number;
	deleteAt?: number;
	timeoutId?: number;
}

interface CanvasEntry {
	canvas: TileCanvas;
	micrioImage: MicrioImage | Models.Omni.Frame;
	/** The public Camera instance, present only for full canvases (not embeds). */
	camera?: Camera;
}

/**
 * The main Micrio compute controller class. Handles the engine lifecycle,
 * render loop, tile management, and WebGL integration.
 * Accessed via `micrio.engine`.
 */
export class Engine {

	ready: boolean = false;

	/** Viewport for the main HTML element. */
	readonly el: Viewport = new Viewport;

	/** Shared Float32Array for standard tile vertex data. */
	readonly _vertexBuffer: Float32Array = new Float32Array(6 * 3);
	/** Shared Float32Array for 360 tile vertex data. */
	readonly _vertexBuffer360: Float32Array = new Float32Array(6 * 3 * segsX * segsY);

	/** Array holding all instantiated TileCanvas instances managed by this engine. */
	readonly _canvases: TileCanvas[] = [];

	/** Total number of tiles across all images in all canvases. */
	_numTiles: number = 0;
	/** Total number of Image instances across all canvases. */
	_numImages: number = 0;

	/** Timestamp of the current frame (performance.now()). */
	now: number = 0;
	/** Flag indicating if any animation is active in any canvas this frame. */
	_animating: boolean = false;
	/** Overall loading progress (0-1) based on tiles drawn vs tiles needed. */
	_progress: number = 0;
	/** Total number of tiles needed across all canvases this frame. */
	_toDrawTotal: number = 0;
	/** Total number of tiles successfully drawn (or already loaded) across all canvases this frame. */
	_doneTotal: number = 0;

	/** Default duration (seconds) for crossfade between canvases. */
	_crossfadeDuration: number = .25;
	/** Default duration (seconds) for grid item transitions. */
	_gridTransitionDuration: number = .5;
	/** Default easing function for grid transitions. */
	_gridTransitionTimingFunction: Bicubic = easeInOut;
	/** Default duration (seconds) for transitions between 360 spaces. */
	_spacesTransitionDuration: number = .5;
	/** Default duration (seconds) for fading embedded images/videos. */
	_embedFadeDuration: number = .5;

	/** Elasticity factor for kinetic dragging (higher = more movement). */
	_dragElasticity: number = 1;

	/** Flag indicating if a binary archive is being used. */
	_hasArchive: boolean = false;
	/** Layer offset when using an archive. */
	_archiveLayerOffset: number = 0;

	/** Number of "underzoom" levels. */
	_underzoomLevels: number = 4;
	/** Number of lowest resolution layers to skip loading initially. */
	_skipBaseLevels: number = 0;

	/** Flag for barebone mode (minimal texture loading). */
	_bareBone: boolean = false;

	/** Flag indicating if the current context is a swipe gallery. */
	_isSwipe: boolean = false;

	/** Flag to disable panning during pinch gestures. */
	_noPinchPan: boolean = false;

	/** Target direction for 360 transition. */
	_direction: number = 0;
	/** Horizontal distance for 360 transition. */
	_distanceX: number = 0;
	/** Vertical distance for 360 transition. */
	_distanceY: number = 0;

	/** Estimated time per frame in seconds (used for animation speed normalization). */
	_frameTime: number = 1 / 60;

	/** Array storing references to all MicrioImage instances managed by the engine. @internal */
	#images: Array<MicrioImage | Models.Omni.Frame> = [];
	/** Flag indicating if barebone mode is active. @internal */
	#bareBoneSetting: boolean = false;
	/** Array storing the base tile index for each image. @internal */
	#baseTiles: number[] = [];
	/** Set storing the indices of tiles drawn in the current frame. @internal */
	#drawnSet: Set<number> = new Set();
	/** Set storing the indices of tiles drawn in the previous frame. @internal */
	#prevDrawnSet: Set<number> = new Set();
	/** Double-buffer peer for prevDrawnSet to avoid per-frame allocation. @internal */
	#prevDrawnSetSwap: Set<number> = new Set();
	/** Unified tile state storage. @internal */
	#tiles: Map<number, TileEntry> = new Map();
	/** Map tracking ongoing texture download requests. @internal */
	#requests: Map<number, string> = new Map();
	/** Forget in-memory tiles after X seconds not drawn. */
	#deleteAfterSeconds: number;

	/** Array storing store unsubscriber functions. @internal */
	#unsubscribe: Unsubscriber[] = [];

	/** Maps engine-level Image instances to their MicrioImage for embedded images. @internal */
	#engImageToMicrio: Map<Image, MicrioImage | Models.Omni.Frame> = new Map();
	/** Reverse map: MicrioImage → engine Image for O(1) lookup in video callbacks. @internal */
	#micrioToEngImage: Map<MicrioImage | Models.Omni.Frame, Image> = new Map();

	/** If true, prevents the engine from auto-setting direction during 360 transitions. */
	_preventDirectionSet: boolean = false;

	/** Static Float32Array holding texture coordinates for a standard quad. */
	static readonly _textureBuffer: Float32Array = Engine.#getTextureBuffer(1, 1);
	/** Static Float32Array holding texture coordinates for the 360 sphere. */
	static _textureBuffer360: Float32Array;

	/** Flag indicating if the current context is a gallery. @internal */
	#isGallery: boolean = false;

	#raf: number = -1;
	#drawing: boolean = false;

	/** The currently active canvas entry. @internal */
	#activeCanvasEntry: CanvasEntry | null = null;
	/** Map from MicrioImage/Frame → canvas entry (O(1) direct lookup). @internal */
	#entryByImage: Map<MicrioImage | Models.Omni.Frame, CanvasEntry> = new Map();

	/** Returns the engine TileCanvas for a MicrioImage, or undefined. @internal */
	getCanvas(img: MicrioImage | Models.Omni.Frame): TileCanvas | undefined {
		return this.#entryByImage.get(img)?.canvas;
	}

	/** Stores a canvas entry in the lookup maps. @internal */
	#setEntry(entry: CanvasEntry): void {
		this.#entryByImage.set(entry.micrioImage, entry);
	}

	/** The main HTMLMicrioElement instance. */
	micrio: HTMLMicrioElement;

	constructor(
		micrio: HTMLMicrioElement
	) {
		this.micrio = micrio;
		this.#deleteAfterSeconds = Browser.iOS ? 5 : get(this.micrio.canvas.isMobile) ? 30 : 90;
		this.render = this.render.bind(this);
		this.#unsubscribe.push(micrio.current.subscribe(this.setCanvas.bind(this)));
	}

	/**
	 * Generates a Float32Array containing texture coordinates for a quad.
	 * @internal
	 */
	static #getTextureBuffer(
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
	 * Initializes the engine and prepares the 360 texture buffer.
	 */
	load(): void {
		if (this.ready) return;

		Engine._textureBuffer360 = Engine.#getTextureBuffer(segsX, segsY);

		this.ready = true;

		this.#unsubscribe.push(this.micrio.barebone.subscribe(b => {
			this._bareBone = b;
			this.#bareBoneSetting = b;
		}));
	}

	/**
	 * Callback for the engine to request drawing a tile.
	 * @returns True if the tile texture is ready and drawn, false otherwise.
	 */
	drawTile = (imgIdx: number, i: number, layer: number, x: number, y: number, opacity: number, animating: boolean, targetLayer: boolean): boolean => {
		this.#drawnSet.add(i);
		const tile = this.#getTileEntry(i);
		tile.deleteAt = undefined;

		const numLoading = runningThreads();
		const c = this.#images[imgIdx];
		const hasCamera = 'camera' in c;
		const isVideo = hasCamera && c.isVideo;
		const is360 = hasCamera && c.is360;
		const img = hasCamera ? c : c.image;
		const frame = 'frame' in c ? c.frame : undefined;
		const noSmoothing = hasCamera && c.$settings.noSmoothing;

		if (tile.loadState === 0 && numLoading < numThreads) {
			if (this.#bareBoneSetting ? numLoading > 2 && animating : targetLayer && animating && numLoading > 0) return false;

			if (isVideo && !is360) {
				tile.loadState = 2;
				tile.texture = this.micrio.webgl.getTexture();
			}
			else {
				tile.loadState = 1;
				const src = img.getTileSrc(layer, x, y, frame);
				if (src) this.getTexture(i, src, animating, { noSmoothing });
				else {
					tile.loadState = 0;
					return false;
				}
			}
		}
		else if (tile.loadState >= 2) {
			if (!this.#drawing) this.#drawStart();

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

	/** @internal */
	getTileOpacity = (i: number): number => { return this.#tiles.get(i)?.opacity || 0; }

	/** @internal */
	setTileOpacity = (i: number, direct: boolean = false, imageOpacity: number = 1): number => {
		const tile = this.#tiles.get(i);
		if (!tile) return 0;
		if (tile.opacity < 1) {
			tile.opacity = direct ? 1 : (tile.loadedAt && tile.loadedAt > 0 ? Math.min(1, (this.now - tile.loadedAt) / 250) * imageOpacity : 0);
		}
		return tile.opacity;
	}

	/** @internal */
	setImageVisible = (img: Image, visible: boolean): void => {
		const micrioImage = this.#engImageToMicrio.get(img);
		if (micrioImage && 'visible' in micrioImage) micrioImage.visible.set(visible);
	}

	/** Unbinds event listeners, stops rendering, and cleans up resources. */
	unbind(): void {
		this.#stop();
		while (this.#unsubscribe.length) this.#unsubscribe.pop()?.();
		this.#requests.forEach(src => abortDownload(src));
		this.#requests.clear();
		for (const [idx, tile] of this.#tiles.entries()) {
			if (tile.timeoutId) clearTimeout(tile.timeoutId);
			this.#deleteTile(idx);
		}
		this.#tiles.clear();
		this.reset();
	}

	/**
	 * Adds a new image canvas instance to the engine.
	 * @internal
	 */
	#addCanvas(c: MicrioImage): void {
		const i = c.$info;
		if (!i) return;
		if (c.error) {
			this.micrio.loading.set(false);
			return;
		}

		if (!c.noImage && (!i.width || !i.height)) throw new Error('Invalid Micrio image size');

		const settings = c.$settings;

		this.#isGallery = !!get(this.micrio.gallery) || c.isOmni;

		if (settings.gallery?.archive) {
			this._hasArchive = true;
			this._archiveLayerOffset = settings.gallery.archiveLayerOffset ?? 0;
		}
		if (i.version && parseFloat(i.version) <= 3.1) this._underzoomLevels = 8;

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

		const gallerySwitch = !!this.#isGallery && settings.gallery?.type == 'switch';

		const numOmniLayers = settings.omni?.layers?.length ?? 1;
		if (settings.omni) settings.omni.layerStartIndex = Math.min(numOmniLayers - 1, settings.omni?.layerStartIndex ?? 0);

		const canvas = new TileCanvas(
			this,
			i.width, i.height,
			c.opacity,
			coverLimit,
			i.tileSize ?? DEFAULT_TILE_SIZE,
			i.is360 ?? false,
			c.noImage,
			!!i.isDeepZoom,
			settings.freeMove ?? false,
			coverStart,
			settings.zoomLimit || 1,
			settings.zoomLimitDPRFix !== false ? this.micrio.canvas.getRatio(c.$settings) : 1,
			settings.camspeed ?? 1,
			c.camera.rotationY,
			gallerySwitch,
			!!settings.gallery?.isSpreads && settings.gallery.type == 'swipe',
			c.isOmni,
			settings.pinchZoomOutLimit ?? false,
			numOmniLayers,
			!!(i.isSingle || is360Video),
			settings.omni?.layerStartIndex ?? 0,
			false,
		);

		c.placed = true;
		canvas._micrioImage = c;
		this.#setEntry({ canvas, micrioImage: c, camera: c.camera });
		this.#images.push(c);

		this.#bindCamera(c);

		if (c.opts.area) c.camera.setArea(c.opts.area, { direct: true, noDispatch: true, noRender: true });

		if (settings?.restrict) c.camera.setLimit(settings.restrict);

		if (settings?.crossfadeDuration)
			this._crossfadeDuration = settings.crossfadeDuration;
		if (settings?.embedFadeDuration)
			this._embedFadeDuration = settings.embedFadeDuration;
		if (settings?.dragElasticity !== undefined)
			this._dragElasticity = settings.dragElasticity;
		if (settings?.skipBaseLevels)
			this._skipBaseLevels = settings.skipBaseLevels;

		if (settings?.omni) {
			canvas._omniDistance = -(settings.omni.distance ?? 0);
			canvas._omniFieldOfView = settings.omni.fieldOfView ?? 0;
			canvas._omniVerticalAngle = settings.omni.verticalAngle ?? 0;
			canvas._omniOffsetX = settings.omni.offsetX ?? 0;
			c.state.view.set([0, 0, 1, 1]);
		}
		if (this.micrio.hasAttribute('data-limited') && c.canvas) c.canvas._limited = true;

		canvas._sendViewport();

		if (this._numTiles > 0) this.#registerBaseTile(this._numTiles - 1);

		const v = get(c.state.view) || settings.view;
		if (v && !(v[0] == 0 && v[1] == 0 && v[2] == 1 && v[3] == 1)) {
			canvas.setView(v[0] + v[2] / 2, v[1] + v[3] / 2, v[2], v[3], false, false, false, false);
		} else if ((isSpaces || !i.is360) && focus && focus.toString() != '0.5,0.5') {
			canvas.camera.setCoo(focus[0], focus[1], 0);
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
	#bindCamera(img: MicrioImage): void {
		const canvas = this.#entryByImage.get(img)!.canvas;
		img.camera.bindEngineCanvas(canvas);
	}

	setCanvas(canvas?: MicrioImage): void {
		if (!canvas || (canvas.placed && canvas === this.#activeCanvasEntry?.micrioImage)) return;

		if (!canvas.placed) {
			if (!get(this.micrio.current) || (!canvas.$info.isIIIF && canvas.$info.id != get(this.micrio.current)!.id)) return;
			this.#addCanvas(canvas);
			if (canvas.embeds.length) canvas.embeds.forEach(e => this.addEmbed(e, canvas));
		}
		else if (canvas !== this.#activeCanvasEntry?.micrioImage) {
			const entry = this.#entryByImage.get(canvas);
			if (!entry) return;
			if (entry.canvas._hasParent) return;


			const pitch = canvas.is360 && this.#activeCanvasEntry ? this.#activeCanvasEntry.canvas._camera360._pitch : 0;
			this.#activeCanvasEntry = entry;

			if (canvas.is360 && !this._preventDirectionSet) {
				const reversedYaw = ((this._direction + 0.5) % 1) * Math.PI * 2;
				entry.canvas._setDirection(reversedYaw - canvas.camera.rotationY, pitch, true);
			}

			if (entry.canvas._targetOpacity === 0) entry.canvas._fadeIn();

			if (canvas.$settings.omni?.layerStartIndex) canvas.state.layer.set(canvas.$settings.omni.layerStartIndex);
			this._preventDirectionSet = false;
			this.ready = true;
			this.render();
		}
	}

	/** Removes a canvas instance from the engine. @internal */
	removeCanvas(c: MicrioImage): void {
		if (!c.placed) throw new Error('Canvas is not placed yet');
		const entry = this.#entryByImage.get(c);
		if (!entry) return;
		entry.canvas.remove();
		this.#entryByImage.delete(c);
		this.render();
	}

	/** Requests the next animation frame. */
	render(): void {
		if (this.#raf < 0) this.#raf = this.micrio.webgl.display.requestAnimationFrame(this.#draw);
	}

	#draw = (now: number = performance.now()): void => {
		if (!this.micrio.isConnected || !this.micrio.$current) return;

		this.#raf = -1;
		this.#drawing = false;

		if (this._shouldDraw(now)
			|| this.micrio.keepRendering
			|| this.micrio.events.isNavigating
			|| this.micrio.$current?._video?.paused === false) {
			this.render();
		}

		if (this.#isGallery) this.#drawStart();
		this.#drawnSet.clear();
		for (let i = 0; i < this._canvases.length; i++) this._canvases[i]._draw();

		this.micrio.events.dispatch('draw');

		this.#cleanup();

		this.micrio.webgl.drawEnd();
	}

	_shouldDraw(now: number): boolean {
		this._frameTime = 1000 / Math.min(33, now - this.now);
		this.now = now;
		this._doneTotal = 0;
		this._toDrawTotal = 0;
		this._animating = false;
		for (let i = 0; i < this._canvases.length; i++) this._canvases[i]._shouldDraw();
		return this._animating || this._progress < 1;
	}

	#stop(): void {
		if (this.#raf < 0) return;
		this.micrio.webgl.display.cancelAnimationFrame(this.#raf);
		this.#raf = -1;
	}

	/** Gets or creates a tile entry for the given index. @internal */
	#getTileEntry(i: number): TileEntry {
		let tile = this.#tiles.get(i);
		if (!tile) {
			tile = { loadState: 0, opacity: 0 };
			this.#tiles.set(i, tile);
		}
		return tile;
	}

	/** Registers a base tile index (mark loaded, cache in set). @internal */
	#registerBaseTile(idx: number): void {
		this.#getTileEntry(idx).opacity = 1;
		this.#baseTiles.push(idx);
	}

	/** Prepares the WebGL context for drawing a new frame. @internal */
	#drawStart(): void {
		if (this.#drawing) return;
		this.micrio.webgl.drawStart();
		this.#drawing = true;
	}

	/**
	 * Initiates loading of a texture using the texture loader utility.
	 * @internal
	 */
	getTexture(i: number, src: string, ani: boolean, opts: {
		force?: boolean;
		noSmoothing?: boolean
	} = {}): void {
		const tile = this.#tiles.get(i);
		if (tile?.texture || this.#requests.has(i) || (!opts.force && runningThreads() >= numThreads)) return;
		const inArchive = archive.db.has(src);
		if (!inArchive) this.micrio.loading.set(true);
		this.#requests.set(i, src);
		(inArchive ? archive.getImage(src) : loadTexture(src))
			.then((img) => this.#gotTexture(i, img, ani, opts.noSmoothing))
			.catch(() => this.#deleteRequest(i));
	}

	/** @internal */
	#gotTexture(
		i: number,
		img: TextureBitmap,
		ani: boolean,
		noSmoothing?: boolean
	): void {
		const tile = this.#getTileEntry(i);
		tile.texture = this.micrio.webgl.getTexture(img, tile.texture, noSmoothing);
		if (self.ImageBitmap !== undefined && img instanceof ImageBitmap && img.close instanceof Function) img.close();
		tile.loadState = 2;

		tile.timeoutId = setTimeout(() => {
			this.#deleteRequest(i);
		}, ani ? 150 : 50) as unknown as number;
	}

	/** @internal */
	#deleteRequest(i: number): void {
		this.#requests.delete(i);
		const tile = this.#tiles.get(i);
		if (tile?.timeoutId) {
			clearTimeout(tile.timeoutId);
			tile.timeoutId = undefined;
		}

		if (!this.#requests.size) this.micrio.loading.set(false);
	}

	/** @internal */
	#deleteTile(idx: number): void {
		const tile = this.#tiles.get(idx);
		if (tile) {
			if (tile.texture) this.micrio.webgl.gl.deleteTexture(tile.texture);
			if (tile.timeoutId) clearTimeout(tile.timeoutId);
			this.#tiles.delete(idx);
		}
	}

	/**
	 * Performs cleanup after each frame.
	 * @internal
	 */
	#cleanup(): void {
		const now = performance.now();

		for (const idx of this.#prevDrawnSet) {
			if (this.#drawnSet.has(idx)) continue;
			if (this.#baseTiles.includes(idx)) continue;

			const tile = this.#tiles.get(idx);
			if (!tile || tile.loadState === 0) continue;

			tile.opacity = 0;

			switch (tile.loadState) {
				case 1:
					const request = this.#requests.get(idx);
					if (request) abortDownload(request);
					tile.loadState = 0;
					break;

				case 2:
					if (this.#requests.has(idx)) {
						this.#deleteRequest(idx);
					}
					this.#deleteTile(idx);
					break;

				case 3:
					if (!tile.deleteAt) tile.deleteAt = now;
					break;
			}
		}

		// Swap double-buffered sets to avoid per-frame Set allocation
		const tmp = this.#prevDrawnSet;
		this.#prevDrawnSet = this.#prevDrawnSetSwap;
		this.#prevDrawnSetSwap = tmp;
		this.#prevDrawnSetSwap.clear();
		for (const idx of this.#drawnSet) this.#prevDrawnSet.add(idx);

		for (const [idx, tile] of this.#tiles.entries()) {
			if (tile.deleteAt && (now - tile.deleteAt) / 1000 > this.#deleteAfterSeconds) {
				this.#deleteTile(idx);
			}
		}
	}

	/**
	 * Resizes the viewport and updates engine dimensions.
	 * @internal
	 */
	resize(c: Models.Canvas.ViewRect): void {
		this.el.set(c.width, c.height, c.left, c.top, c.ratio, c.scale, c.portrait);
		for (let i = 0; i < this._canvases.length; i++) this._canvases[i].resize();
		if (this.ready) { this.#stop(); this.#draw(); }
	}

	/** Add a child image to the current canvas, either embed or independent canvas. @internal */
	#addImage = (
		image: MicrioImage | Models.Omni.Frame,
		parent: MicrioImage,
		isEmbed: boolean = false,
		opacity: number = 1,
		fromScale?: number,
	): void => {
		this.#images.push(image);
		this.#placeOnCanvas(image, parent, isEmbed, opacity, fromScale);
	}

	/** @internal */
	#placeOnCanvas = (
		image: MicrioImage | Models.Omni.Frame,
		parent: MicrioImage,
		isEmbed: boolean,
		opacity: number,
		fromScale?: number,
	): void => {
		const i = '$info' in image ? image.$info : parent.$info;
		if (!i) return;

		const a = image.opts.area ?? [0, 0, 1, 1];
		const _360 = image instanceof MicrioImage ? image.$settings._360 ?? {} : {};
		const parentEntry = this.#entryByImage.get(parent);
		if (!parentEntry) return;

		let canvas: TileCanvas;
		if (!isEmbed) {
			if (!(image instanceof MicrioImage)) return;
			const isGallery = !!(image.$settings.gallery?.archive || image.$settings.gallery?.type);
			let childOpts: { coverLimit?: boolean; coverStart?: boolean } = {};
			if (isGallery) {
				childOpts = { coverLimit: false, coverStart: false };
			} else {
				childOpts = {
					coverLimit: !!image.$settings?.limitToCoverScale || !!parent.$settings?.limitToCoverScale,
					coverStart: !!(image.$settings?.limitToCoverScale || image.$settings?.initType == 'cover' || parent.$settings?.initType == 'cover')
				};
			}
			canvas = parentEntry.canvas._addChild(a[0], a[1], a[0] + a[2], a[1] + a[3], i.width, i.height, childOpts);
			canvas._micrioImage = image;
		} else {
			const engImage = parentEntry.canvas._addImage(a[0], a[1], a[0] + a[2], a[1] + a[3], i.width, i.height, i.tileSize ?? DEFAULT_TILE_SIZE, i.isSingle ?? false, i.isDeepZoom ?? false, i.isVideo ?? false, opacity, _360.rotX ?? 0, _360.rotY ?? 0, _360.rotZ ?? 0, _360.scale ?? 1, fromScale ?? 0);
			this.#engImageToMicrio.set(engImage, image);
			this.#micrioToEngImage.set(image, engImage);
			image.placed = true;
			this.#setEntry({ canvas: parentEntry.canvas, micrioImage: image });

			image.baseTileIdx = this._numTiles - 1;
			this.#registerBaseTile(image.baseTileIdx);
			return;
		}

		image.placed = true;
		this.#setEntry({ canvas, micrioImage: image, camera: image.camera });

		if (!isEmbed) {
			this.#bindCamera(image as MicrioImage);
			const focus = (image as MicrioImage).$settings.focus;
			if (focus) (canvas as TileCanvas).camera.setCoo(focus[0], focus[1], 0);
			const v = (image.$info as any)['view'];
			if (v && v.toString() != '0,0,1,1') canvas.setView(v[0], v[1], v[2], v[3], false, false, false, false);
			else if (canvas._hasParent) canvas.setView(canvas.view.centerX, canvas.view.centerY, canvas.view.width, canvas.view.height, false, false);

			canvas._sendViewport();
		}

		image.baseTileIdx = this._numTiles - 1;
		this.#registerBaseTile(image.baseTileIdx);
	}

	/** Adds an embedded MicrioImage instance. @internal */
	addEmbed(image: MicrioImage | Models.Omni.Frame, parent: MicrioImage, opts: Models.Embeds.EmbedOptions = {}): Promise<void> | void {
		if (image.placed) return;
		this.#addImage(image, parent, true, opts.opacity ?? 1, 'camera' in image && opts.asImage ? undefined : opts.fromScale);
	}

	/** Add a child independent canvas to the current canvas. @internal */
	addChild = (image: MicrioImage, parent: MicrioImage) => this.#addImage(image, parent);

	/** Fades an image (main or embed) to a target opacity. @internal */
	fadeImage(img: MicrioImage | Models.Omni.Frame, opacity: number, direct: boolean = false): void {
		const entry = this.#entryByImage.get(img);
		const c = entry?.canvas;
		if (!c) return;
		if (entry.camera) {
			c._targetOpacity = opacity;
		} else {
			const images = c.images;
			for (let i = 0; i < images.length; i++) {
				const im = images[i];
				if (im.localIdx > 0) {
					im.tOpacity = opacity;
					if (direct) im.opacity = opacity;
				}
			}
		}
		this.render();
	}


	// --- Facade methods (delegates to TileCanvas via getCanvas) ---
	// Most facade methods have been replaced by MicrioImage.canvas getter.

	setImageVideoPlaying(img: MicrioImage | Models.Omni.Frame, playing: boolean): void {
		const engImage = this.#micrioToEngImage.get(img);
		if (engImage) engImage.isVideoPlaying = playing;
	}

	/** Resets all canvases. @internal */
	reset(): void {
		for (let i = 0; i < this._canvases.length; i++) this._canvases[i].reset();
	}

	/** Removes a TileCanvas from the managed list. @internal */
	remove(c: TileCanvas): void {
		for (let i = 0; i < this._canvases.length; i++) if (this._canvases[i] === c) {
			this._canvases.splice(i, 1);
			return;
		}
	}
}
