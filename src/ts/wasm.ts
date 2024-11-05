/**
 * The WebAssembly module
 * @author Marcel Duin <marcel@micr.io>
 * @copyright Q42 Internet BV, Micrio, 2015 - 2024
 * @link https://micr.io/ , https://q42.nl/en/
*/

import type { TextureBitmap } from './textures';
import type { HTMLMicrioElement } from './element';
import type { Unsubscriber } from 'svelte/store';
import type { Camera } from './camera';
import type { Models } from '../types/models';
import type { MicrioWasmExports } from '../types/wasm';

import { MicrioImage } from './image';
import { get } from 'svelte/store';
import { archive } from './archive';
import { Browser, once } from './utils';
import { loadTexture, runningThreads, numThreads, abortDownload } from './textures';
import { WASM } from './globals';

/** The dev loadable binary promise */
const wasmPromise : Promise<ArrayBuffer|Uint8Array> | null = WASM.ugz ? WASM.ugz(WASM.b64,!0)
	: fetch('http://localhost:2000/build/optimized.wasm').then(response => response.arrayBuffer());

/** Every memory page is 64KB and can hold about 8 MicrioImage[] */
const numPages : number = 100;

/** The WebAssembly class */
export class Wasm {

	// GENERAL

	/** Wasm inited */
	ready:boolean = false;
	/** Shared WebAssembly memory -- 1 page is 64KB */
	private memory: WebAssembly.Memory = new self.WebAssembly.Memory({'initial': numPages,'maximum': numPages});
	/** The actual WebAssembly memory buffer -- only call here since memory won't grow */
	private b: ArrayBuffer = this.memory.buffer;
	/** The WebAssembly exports
	 * @internal
	*/
	e!: MicrioWasmExports;
	/** The WebAssembly main instance memory pointer */
	private i: number = -1;
	/** The WebAssembly current canvas instance memory pointer */
	private c: number = -1;

	// RENDERING LOOP

	/** The current frame's timestamp */
	private now: number = -1;
	/** RequestAnimationFrame pointer */
	private raf: number = -1;
	/** Is currently drawing */
	private drawing: boolean = false;

	// TILE LOGIC

	/** Array of images for tile references, including embeds
	 * @internal
	*/
	images: (MicrioImage|Models.Omni.Frame)[] = [];
	/** Barebone mode, minimal tile downloading */
	private bareBone: boolean = false;
	/** Number of tiles per image */
	private baseTiles: number[] = [];
	/** Array of tile indices drawn this frame */
	private drawn: number[] = [];
	/** Array of tile indices drawn last frame */
	private prevDrawn: number[] = [];
	/** Tile indices to be deleted */
	private toDelete: { [key: number]: number } = {};
	/** Tile textures */
	private textures: { [key: number]: WebGLTexture } = {};
	/** Running texture download threads */
	private requests: Map<number, string> = new Map;
	/** Timeout after texture loads */
	private timeouts: { [key: number]: number } = {};
	/** Tile loaded timestamp */
	private tileLoaded: { [key: number]: number } = {};
	/** Tile opacity */
	private tileOpacity: { [key: number]: number } = {};
	/** Tile load states */
	private loadStates: { [key: number]: number } = {};

	/** Svelte watch subscriptions */
	private unsubscribe: Unsubscriber[] = [];

	// ANIMATION HOOKS
	private cameras: Map<number, Camera> = new Map();

	// Internals

	/** @internal */
	preventDirectionSet:boolean = false;

	// RENDER BUFFERS AND ARRAYS

	/** The tile vertex buffer */
	_vertexBuffer!: Float32Array;
	/** The tile texture buffer */
	static readonly _textureBuffer: Float32Array = Wasm.getTextureBuffer(1,1);

	// 360

	/** Number of X geometry segments per tile */
	static segsX: number;
	/** Number of Y geometry segments per tile */
	static segsY: number;

	/** The tile vertex buffer for 360 */
	_vertexBuffer360!: Float32Array;
	/** The tile texture buffer for 360 */
	static _textureBuffer360: Float32Array;

	/** Camera perspective matrix from WebAssembly */
	private _pMatrices: { [key: number]: Float32Array } = {};

	/** Is paged */
	private isGallery:boolean = false;

	/** Wasm imports */
	private imports:WebAssembly.Imports = {
		'env': {
			'memory': this.memory,
			'abort': console.error
		},
		'main': {
			'console.log': console.log,
			'console.log2': console.log,
			'console.log3': console.log,
			'console.log4': console.log,
			'drawTile': this.drawTile.bind(this),
			'drawQuad': (opacity:number) : void => this.micrio.webgl.drawTile(undefined, opacity),
			'aniAbort': (ptr:number) : void => {
				const c = this.cameras.get(ptr);
				if(!c) return;
				if(c.aniAbort) c.aniAbort();
				c.aniDoneAdd.length = 0;
				c.aniAbort = c.aniDone = undefined;
			},
			'aniDone': (ptr:number) : void => {
				const c = this.cameras.get(ptr);
				if(!c) return;
				if(c.aniDone) c.aniDone();
				while(c.aniDoneAdd.length) c.aniDoneAdd.shift()?.();
				c.aniAbort = c.aniDone = undefined;
			},
			'getTileOpacity': (i:number) : number => this.tileOpacity[i],
			'setTileOpacity': (i:number,direct:boolean=false,imageOpacity:number=1) : number => {
				const o = this.tileOpacity, l = this.tileLoaded;
				if(!o[i] || o[i] < 1) o[i] = direct ? 1 : l[i] > 0 ? Math.min(1,(this.now - l[i]) / 250) * imageOpacity : 0;
				return o[i] || 0;
			},
			'setMatrix': (ptr:number) => this.micrio.webgl.gl.uniformMatrix4fv(
				this.micrio.webgl.pmLoc, false, this._pMatrices[ptr]),
			'setViewport': (left:number,bottom:number,w:number,h:number) => this.micrio.webgl.gl
				.viewport(Math.floor(left), Math.floor(bottom), Math.ceil(w), Math.ceil(h)),
			'viewSet': (ptr:number) => this.cameras.get(ptr)?.viewChanged(),
			'viewportSet': (ptr:number,x:number,y:number,w:number,h:number) => {
				const img = this.images.find(i => i.ptr == ptr);
				if(img && 'camera' in img) img.viewport.set([x,y,w,h]);
			},
			'setVisible': (ptr:number,visible:number) => this.images.find(i => i.ptr == ptr)?.visible.set(visible===1),
			'setVisible2': (ptr:number,visible:number) => this.images.find(i => i.ptr == ptr)?.visible.set(visible===1)
		}
	}
	
	/** Build the static tile texture coord buffer */
	private static getTextureBuffer(
		/** The number of horizontal segments */
		segsX:number,
		/** The number of vertical segments */
		segsY:number
	) : Float32Array {
		const b = new Float32Array(2 * 6 * segsX * segsY), dX = 1 / segsX, dY = 1 / segsY;
		for(let i=0,y=0;y<segsY;y++) for(let x=0;x<segsX;x++,i+=12) {
			b[i+3] = b[i+7] = b[i+9] = (b[i+1] = b[i+5] = b[i+11] = y * dY) + dY;
			b[i+4] = b[i+8] = b[i+10] = (b[i+0] = b[i+2] = b[i+6] = x * dX) + dX;
		} return b;
	}

	/** Create the WebAssembly instance
	 * @param micrio The main <micr-io> instance
	*/
	constructor(
		public micrio: HTMLMicrioElement
	) {
		this.render = this.render.bind(this);
		this.draw = this.draw.bind(this);
		this.unsubscribe.push(micrio.current.subscribe(this.setCanvas.bind(this)));
	}

	/** Load the WebAssembly module
	 * @returns The promise when loading is complete
	*/
	async load():Promise<void> {
		if(this.i >= 0) return;
		this.i = 0;
		const data = await wasmPromise;
		if(!((data instanceof Uint8Array) || (data instanceof ArrayBuffer)))
			throw 'Wasm binary is no array buffer!';

		const e = this.e = (await self.WebAssembly.instantiate(data, this.imports)).instance.exports as MicrioWasmExports;

		this.i = e.constructor();
		Wasm.segsX = this.e.segsX.value;
		Wasm.segsY = this.e.segsY.value;
		Wasm._textureBuffer360 = Wasm.getTextureBuffer(Wasm.segsX,Wasm.segsY);
		this._vertexBuffer = new Float32Array(this.b, e.getVertexBuffer(this.i) + 32, 6 * 3);
		this._vertexBuffer360 = new Float32Array(this.b, e.getVertexBuffer360(this.i) + 32, 6 * 3 * Wasm.segsX * Wasm.segsY);
		this.unsubscribe.push(this.micrio.barebone.subscribe(b => e.setBareBone(this.i, this.bareBone = b)));
	}

	/** Unbind this module */
	unbind():void{
		this.stop();
		while(this.unsubscribe.length) this.unsubscribe.shift()?.();
		this.requests.forEach(src => abortDownload(src));
		this.requests.clear();
		for(let key in this.timeouts) clearTimeout(this.timeouts[key]);
		this.timeouts = {};
		this.loadStates = {};
		this.tileLoaded = {};
		this.tileOpacity = {};
		for(let i in this.tileLoaded) this.deleteTile(Number(i));
		if(this.i > 0) this.e.reset(this.i);
	}

	/** The the Wasm ptr
	 * @internal
	*/
	getPtr() : number {return this.i}

	/** Add a new rendering canvas */
	private addCanvas(c:MicrioImage) : void {
		const i = c.$info;
		// Not available yet
		if(!i) return;
		// Loading error with info.json
		if(c.error) {
			this.micrio.loading.set(false);
			return;
		}

		if(!c.noImage && (!i.width || !i.height)) throw 'Invalid Micrio image size';

		const settings = c.$settings;

		this.isGallery = !!i.gallery || c.isOmni;

		if(settings.gallery?.archive) this.e.setHasArchive(this.i, true, settings.gallery.archiveLayerOffset ?? 0);
		if(i.version && Number(i.version) <= 3.1) this.e.setNoUnderzoom(this.i, true);

		const coverLimit = !!settings.limitToCoverScale;
		const coverStart = coverLimit || settings.initType == 'cover';

		if(c.noImage) this.micrio.loading.set(false);

		const focus = [.5,.5];
		const f = settings.focus;
		const isSpaces = !!i.spacesId;
		if(f) {
			if(!isNaN(f[0]) && f[0] !== null) focus[0] = f[0];
			if(!isNaN(f[1]) && f[1] !== null) focus[1] = f[1];
		}

		if(i.is360) c.camera.trueNorth = settings._360?.trueNorth ?? .5;


		const vid360 = settings._360?.video;
		const is360Video = i.is360 && vid360 &&
			(vid360.src || ('video' in vid360 && vid360['video']));

		const gallerySwitch = !!this.isGallery && (settings.gallery?.type == 'switch'
			|| settings.gallery?.type == 'omni'
			|| settings.gallery?.type == 'swipe-full');

		// Initialize Wasm Canvas
		c.ptr = this.e._constructor(
			this.i,
			i.width,
			i.height,
			i.tileSize ?? 1024,
			i.is360 ?? false,
			c.noImage,
			!!(i.isSingle || is360Video),
			c.opacity,
			settings.freeMove ?? false,
			coverLimit,
			coverStart,
			(settings.zoomLimit || 1) * (settings.zoomLimitDPRFix !== false ? this.micrio.canvas.getRatio(c.$settings) : 1),
			settings.camspeed ?? 1,
			c.camera.trueNorth,
			gallerySwitch,
			!!settings.gallery?.isSpreads && settings.gallery.type == 'swipe',
			c.isOmni,
			settings.pinchZoomOutLimit ?? false,
			settings.omni?.layers?.length ?? 1
		);

		this.bindCamera(c);

		if(c.opts.area) c.camera.setArea(c.opts.area, {direct: true, noDispatch:true, noRender:true});

		if(settings?.crossfadeDuration)
			this.e.setCrossfadeDuration(this.i, settings.crossfadeDuration);

		if(settings?.embedFadeDuration)
			this.e.setEmbedFadeDuration(this.i, settings.embedFadeDuration);

		if(settings?.dragElasticity !== undefined)
			this.e.setDragElasticity(this.i, settings.dragElasticity);

		if(settings?.skipBaseLevels)
			this.e.setSkipBaseLevels(this.i, settings.skipBaseLevels);

		if(settings?.omni) c.camera.setOmniSettings();
		if(this.micrio.hasAttribute('data-limited')) this.e._setLimited(c.ptr, true);

		this.images.push(c);
		this.e._sendViewport(c.ptr);

		const numTiles = this.e.getNumTiles(this.i);
		if(numTiles > 0) {
			this.tileOpacity[numTiles-1] = 1;
			this.baseTiles.push(numTiles-1);
		}
		const mPtr = this.e._getPMatrix(c.ptr);
		this._pMatrices[mPtr] = new Float32Array(this.b, mPtr + 32, 16);

		const v = get(c.state.view) || settings.view;
		if(v && v.toString() != '0,0,1,1') {
			this.e._setView(c.ptr, v[0], v[1], v[2], v[3], false, false, false);
		} else if((isSpaces || !i.is360) && focus && focus.toString() != '0.5,0.5') {
			this.e._setCoo(c.ptr, focus[0], focus[1], 0, 0, performance.now());
			settings.focus = undefined;
		}

		// When a 360 video starts playing, trigger render
		c.video.subscribe(v => v && v.addEventListener('play', this.render));

		if(c.noImage) c.visible.set(true);

		this.setCanvas(c);
	}

	/** Bind the camera to the individual FloatArrays
	 * @internal
	*/
	private bindCamera(img:MicrioImage) : void {
		this.cameras.set(img.ptr, img.camera);
		img.camera.assign(
			this.e,
			new Float64Array(this.b, this.e._getView(img.ptr) + 32, 4),
			new Float64Array(this.b, this.e._getXY(img.ptr, 0,0) + 32, 5),
			new Float64Array(this.b, this.e._getCoo(img.ptr, 0,0) + 32, 5),
			new Float32Array(this.b, this.e._getMatrix(img.ptr) + 32, 16),
			new Float32Array(this.b, this.e._getQuad(img.ptr, 0,0,0,0,0,0) + 32, 16)
		)
	}

	/** Set the specified canvas as active
	 * @param canvas The Image to add
	*/
	setCanvas(canvas?:MicrioImage) : void {
		if(!canvas || (canvas.ptr > 0 && canvas.ptr == this.c)) return;

		// If unknown, subscribe to info set
		if(canvas.ptr < 0) once(canvas.info).then(info => { if(!info) return;
			if(!this.micrio.$current || (!info.isIIIF && !canvas.opts.secondaryTo && info.id != this.micrio.$current.id)) return;
			this.addCanvas(canvas);
			if(canvas.embeds.length) canvas.embeds.forEach(e => this.addEmbed(e, canvas));
		});
		else if(this.c != canvas.ptr) {
			const yaw = canvas.is360 && this.c >= 0 ? this.e._getYaw(this.c) : 0;
			const pitch = canvas.is360 && this.c >= 0 ? this.e._getPitch(this.c) : 0
			const v = canvas.$settings.view;
			this.c = canvas.ptr;
			// In case of 360, inherit current camera yaw and reset perspective
			// but only if no specific start view has been set and not end of tour
			if(canvas.is360 && !this.preventDirectionSet && yaw && pitch)
				this.e._setDirection(this.c, yaw, pitch, true);
			// Was faded out before
			if(this.e._getTargetOpacity(canvas.ptr) == 0) this.e._fadeIn(canvas.ptr);
			this.preventDirectionSet = false;
			this.ready = true;
			this.render();
		}
	}

	/** Remove a canvas */
	removeCanvas(c:MicrioImage) : void {
		if(c.ptr < 0) throw 'Canvas is not placed yet';
		this.e._remove(c.ptr);
		this.render();
	}

	/** Request a next frame to draw */
	render() : void {
		if(this.raf < 0) this.raf = this.micrio.webgl.display.requestAnimationFrame(this.draw);
	}

	/** Draw an actual frame */
	private draw(now:number = performance.now()) : void {
		if(!this.micrio.isConnected) return;

		this.raf = -1;
		this.drawing = false;
		this.now = now;

		// If needed, request another frame
		if(this.e.shouldDraw(this.i, now) == 1
			|| this.micrio.keepRendering
			|| this.micrio.events.isNavigating
			|| this.micrio._current?._video?.paused === false) this.render();

		// Draw actual tiles
		if(this.isGallery) this.drawStart();
		this.drawn.length = 0;
		this.e.draw(this.i);

		this.micrio.events.dispatch('draw');

		this.cleanup();
	}

	/** Cancel the current requestAnimationFrame request */
	private stop(){
		if(this.raf < 0) return;
		this.micrio.webgl.display.cancelAnimationFrame(this.raf);
		this.raf = -1;
	}

	/** Tile drawing function called from inside Wasm
	 * @returns True when the tile is downloaded and ready to drawn
	 */
	private drawTile(
		/** The image index */
		imgIdx: number,
		/** The tile texture index */
		i: number,
		/** The layer index */
		layer: number,
		/** The tile X coordinate */
		x: number,
		/** The tile Y coordinate */
		y: number,
		/** The tile opacity */
		opacity: number,
		/** The camera is currently animating */
		animating: boolean,
		/** The tile is the current >=100% sharpness target layer */
		targetLayer: boolean
	) : boolean {
		this.drawn.push(i);
		if(i in this.toDelete) delete this.toDelete[i];

		const numLoading = runningThreads();
		const c = this.images[imgIdx],
			isVideo = 'camera' in c && c.isVideo,
			is360 = 'camera' in c && c.is360,
			img = 'camera' in c ? c : c.image,
			frame = 'frame' in c ? c.frame : undefined;

		// Only start downloading tiles of active Micrio
		if(!this.loadStates[i] && numLoading < numThreads) {
			// Prioritize lower-level tiles for animating
			if(this.bareBone ? numLoading > 2 && animating : targetLayer && animating && numLoading > 0) return false;

			// Don't download embedded image video thumb first
			if(isVideo && !is360) {
				this.loadStates[i] = 2;
				this.textures[i] = this.micrio.webgl.getTexture();
			}
			else {
				this.loadStates[i] = 1;
				const src = img.getTileSrc(layer, x, y, frame);
				if(src) this.getTexture(i, src, animating, {
					noSmoothing: '$info' in c && c.$settings.noSmoothing
				});
			}
		}

		else if(this.loadStates[i]>=2) {
			// Only clear canvas if there is something to draw
			if(!this.drawing) this.drawStart();

			const texture = this.textures[i];
			if(texture != null) {
				if(isVideo) {
					// Video not playable yet
					if(!img._video || !img._video.dataset.playing) return false;
					this.micrio.webgl.updateTexture(texture, img._video);
				}
				this.micrio.webgl.drawTile(texture, opacity, is360);
			}

			// Tile is loaded and ready
			if(this.loadStates[i] == 2) {
				this.loadStates[i] = 3;
				this.tileLoaded[i] = this.now;
				return true;
			}
		}

		return false;
	}

	/** Clear the canvas for drawing */
	private drawStart() : void {
		if(this.drawing) return;
		this.micrio.webgl.drawStart();
		this.drawing = true;
	}

	/** Download a texture
	 * @internal
	 * @param i The texture index
	 * @param src The texture image source url
	 * @param ani The camera is currently animating
	 * @param force Even download when thread limit exceeded (for archived)
	 */
	 getTexture(i:number, src:string, ani:boolean, opts: {
			force?:boolean;
			noSmoothing?:boolean
	 } = {}) : void {
		if(this.textures[i] || this.requests.has(i) || (!opts.force && runningThreads() >= numThreads)) return;
		const inArchive = archive.db.has(src);
		if(!inArchive) this.micrio.loading.set(true);
		this.requests.set(i, src);
		(inArchive ? archive.getImage(src) : loadTexture(src))
			.then((img) => this.gotTexture(i, img, ani, opts.noSmoothing))
			.catch(() => this.deleteRequest(i));
	}

	/** Received the texture data */
	private gotTexture(
		/** The texture image index */
		i:number,
		/** The texture image object */
		img:TextureBitmap,
		/** The camera is currently animating */
		ani:boolean,
		/** Don't smooth the texture on MAG */
		noSmoothing?:boolean
	) : void {
		this.textures[i] = this.micrio.webgl.getTexture(img, noSmoothing);
		if(self.ImageBitmap != undefined && img instanceof ImageBitmap && img['close'] instanceof Function) img['close']();
		this.loadStates[i] = 2;
		this.timeouts[i] = <any>(setTimeout(() => {
			this.deleteRequest(i);
		}, ani ? 150 : 50)) as number;
	}

	/** Delete an ended or cancelled request */
	private deleteRequest(
		/** The tile index */
		i:number
	) : void {
		this.requests.delete(i);
		clearTimeout(this.timeouts[i]);
		delete this.timeouts[i];

		if(!this.requests.size) this.micrio.loading.set(false);
	}

	/** Delete a tile */
	private deleteTile(
		/** The tile index */
		idx: number
	) : void {
		const txt = this.textures[idx];
		if(!txt) return;
		this.micrio.webgl.gl.deleteTexture(txt);
		delete this.textures[idx];
		delete this.toDelete[idx]
		delete this.loadStates[idx];
		delete this.tileOpacity[idx];
		delete this.tileLoaded[idx];
	}

	/** Do a general cleanup */
	private cleanup() : void {
		const removed = this.prevDrawn.filter(i => this.drawn.indexOf(i) < 0 && this.loadStates[i] > 0 && this.baseTiles.indexOf(i) < 0);
		const now = performance.now();

		for(let i=0;i<removed.length;i++) {
			const idx = removed[i];
			this.tileOpacity[i] = 0;

			switch(this.loadStates[idx]) {
				case 1: // still downloading, abort
					const request = this.requests.get(idx);
					if(request) abortDownload(request);
					delete this.loadStates[idx];
				break;

				case 2: // Loaded, but never drawn
					if(this.requests.has(idx)) {
						this.deleteRequest(idx);
					}
					delete this.loadStates[idx];
					this.deleteTile(idx);
				break;

				case 3: // Loaded and drawn earlier, but not anymore
					if(!(idx in this.toDelete))
						this.toDelete[idx] = now;
					break;
			}

		}

		this.prevDrawn = this.drawn.slice(0);

		const deleteAfterSeconds = Browser.iOS ? 5 : 30;

		for(let key in this.toDelete) {
			if((now - this.toDelete[key]) / 1000 > deleteAfterSeconds)
				this.deleteTile(Number(key));
		}
	}

	// WASM external functions

	/** Resize the internal canvas
	 * @param c The viewport rect
	*/
	resize(c: Models.Canvas.ViewRect) : void {
		this.e.resize(this.i, c.width, c.height, c.left, c.top, c.ratio, c.scale, c.portrait);
		if(this.ready) { this.stop(); this.draw(); }
	}

	/** Add a child image to the current canvas, either embed or independent canvas */
	private addImage = async (
		/** The image */
		image:MicrioImage,
		/** The parent image */
		parent:MicrioImage,
		/** The image is an embed, not an independent Canvas */
		isEmbed:boolean = false,
		/** The starting opacity */
		opacity:number=1
	) : Promise<void> => once(image.info).then((i):void => { if(!i) return;
		this.images.push(image);

		const a = image.opts.area ?? [0,0,1,1];
		const _360 = image.$settings._360 ?? {};

		image.ptr = !isEmbed ? this.e._addChild(parent.ptr, a[0], a[1], a[2], a[3], i.width, i.height)
			: this.e._addImage(parent.ptr, a[0], a[1], a[2], a[3], i.width, i.height, i.tileSize||1024, i.isSingle??false, i.isVideo??false, opacity, _360.rotX??0, _360.rotY??0, _360.rotZ??0, _360.scale??1, 0);

		if(!isEmbed) {
			this.bindCamera(image);
			if(image.$settings.focus) this.e._setCoo(image.ptr, image.$settings.focus[0], image.$settings.focus[1], 0, 0, performance.now());
			const mPtr = this.e._getPMatrix(image.ptr);
			this._pMatrices[mPtr] = new Float32Array(this.b, mPtr + 32, 16);

			/** @ts-ignore -- Grid starting viewport backwards compatibility */
			const v = image.$info['view'];
			if(v && v.toString() != '0,0,1,1') this.e._setView(image.ptr, v[0], v[1], v[2], v[3]);

			this.e._sendViewport(image.ptr);
		}

		// Set opacity of last tile to 1
		this.tileOpacity[image.baseTileIdx = this.e.getNumTiles(this.i) - 1] = 1;
		this.baseTiles.push(image.baseTileIdx);
	})

	/** Add a child image to the current canvas
	 * @param image The image
	 * @param parent The parent image
	 * @param opts Embedding options
	 * @returns Promise when the image is added
	 */
	addEmbed = (image:MicrioImage|Models.Omni.Frame, parent:MicrioImage, opts: Models.Embeds.EmbedOptions = {}) => {
		if('camera' in image && opts.asImage) return this.addImage(image, parent, true, opts.opacity ?? 1);
		else {
			const i = '$info' in image ? image.$info : parent.$info;
			if(!i) return;
			this.images.push(image);
			const a = image.opts.area ?? [0,0,1,1];
			const _360 = image instanceof MicrioImage ? image.$settings._360 ?? {} : {};
			image.ptr = this.e._addImage(parent.ptr, a[0], a[1], a[2], a[3], i.width, i.height, i.tileSize||1024, i.isSingle ?? false, i.isVideo ?? false, opts.opacity ?? 1, _360.rotX??0, _360.rotY??0, _360.rotZ??0, _360.scale??1, opts.fromScale ?? 0);
			this.tileOpacity[image.baseTileIdx = this.e.getNumTiles(this.i) - 1] = 1;
			this.baseTiles.push(image.baseTileIdx);
		}
	}

	/** Add a child independent canvas to the current canvas, used for grid images
	 * @param image The image
	 * @param parent The parent image
	 * @returns Promise when the image is added
	 */
	addChild = (image:MicrioImage, parent:MicrioImage) => this.addImage(image, parent);

	/** Set an active gallery image
	 * @internal
	 * @param ptr The image pointer
	 * @param idx The sub-image index
	 * @param num Additional next image to also show
	*/
	setActiveImage(ptr:number, idx:number, num?:number) : void {
		this.e._setActiveImage(ptr, idx, num ?? 0);
	}

	/** Set an image layer
	 * @internal
	 * @param ptr The image pointer
	 * @param idx The layer index
	 */
	setActiveLayer(ptr:number, idx:number) : void {
		this.e._setActiveLayer(ptr, idx);
	}

	/** Simple image fader
	 * @param ptr The child image mem pointer
	 * @param opacity The target opacity
	 * @param direct Set immediately
	 */
	 fadeImage(ptr:number, opacity:number, direct:boolean = false) : void {
		// Is main canvas image
		if(this.cameras.has(ptr)) this.e._fadeTo(ptr, opacity, direct);
		// Is embedded sub-image
		else this.e._fadeImage(ptr, opacity, direct);
		this.render();
	}

	/** Set an active gallery image
	 * @internal
	 * @param ptr The image pointer
	 * @param view The viewport to be made active
	 * @param noLimit Don't update zoom limits
	*/
	setFocus(ptr:number, v:Models.Camera.View, noLimit:boolean=false) : void {
		this.e._setFocus(ptr, v[0], v[1], v[2], v[3], noLimit);
	}

}
