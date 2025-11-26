/**
 * Manages the WebAssembly module, including loading, communication,
 * memory management, rendering loop, and tile handling.
 * @author Marcel Duin <marcel@micr.io>
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
import { WASM } from './globals'; // Contains WASM binary data (likely base64)

/**
 * In case there is no bundled B64 Wasm (default for published Micrio JS),
 * check if the script is the ".safe-wasm"-version, and use its co-published .wasm
 * binary. Otherwise, assume we are in development mode and use the local WASM binary.
 */
const selfJSSrc = document.currentScript?.getAttribute('src')?.toString();
const wasmBin = selfJSSrc?.includes('.safe-wasm.js') ? selfJSSrc.replace('.safe-wasm.js', '.wasm')
	: 'http://192.168.0.78:2000/build/optimized.wasm';

/** Promise for loading the Wasm binary (either from external source or embedded data). @internal */
const wasmPromise : Promise<ArrayBuffer|Uint8Array> | null = WASM.ugz ? WASM.ugz(WASM.b64,!0) // Use decompression function if available
	: fetch(wasmBin).then(response => response.arrayBuffer()); // Fallback to fetching dev build

/** Number of memory pages to allocate for Wasm (1 page = 64KB). @internal */
const numPages : number = 100; // ~6.4MB

/** Unified tile entry storing all state for a single tile. @internal */
interface TileEntry {
	texture?: WebGLTexture;
	/** Loading state: 0 = not loaded, 1 = loading, 2 = loaded, 3 = loaded and drawn */
	loadState: number;
	opacity: number;
	loadedAt?: number;
	deleteAt?: number;
	timeoutId?: number;
}

/**
 * The main WebAssembly controller class. Handles interaction between JavaScript
 * and the compiled C++ core of Micrio. Accessed via `micrio.wasm`.
 */
export class Wasm {

	// --- GENERAL ---

	/** Flag indicating if the Wasm module has been loaded and initialized. */
	ready:boolean = false;
	/** Shared WebAssembly memory instance. */
	private memory: WebAssembly.Memory = new self.WebAssembly.Memory({'initial': numPages,'maximum': numPages});
	/** Direct reference to the ArrayBuffer of the WebAssembly memory. @internal */
	private b: ArrayBuffer = this.memory.buffer;
	/** The exported functions from the loaded Wasm module. @internal */
	e!: MicrioWasmExports;
	/** Pointer to the main Micrio instance within Wasm memory. @internal */
	private i: number = -1;
	/** Pointer to the currently active canvas/image instance within Wasm memory. @internal */
	private c: number = -1;

	// --- RENDERING LOOP ---

	/** Timestamp of the current animation frame. @internal */
	private now: number = -1;
	/** ID returned by `requestAnimationFrame`. @internal */
	private raf: number = -1;
	/** Flag indicating if a draw operation is currently in progress within the animation frame. @internal */
	private drawing: boolean = false;

	// --- TILE LOGIC ---

	/** Array storing references to all MicrioImage instances (including embeds) managed by Wasm. @internal */
	images: Array<MicrioImage | Models.Omni.Frame> = [];
	/** Flag indicating if barebone mode (minimal tile loading) is active. @internal */
	private bareBone: boolean = false;
	/** Array storing the base tile index for each image in the `images` array. @internal */
	private baseTiles: number[] = [];
	/** Set storing the indices of tiles drawn in the current frame. @internal */
	private drawnSet: Set<number> = new Set();
	/** Set storing the indices of tiles drawn in the previous frame. @internal */
	private prevDrawnSet: Set<number> = new Set();
	/** Unified tile state storage. @internal */
	private tiles: Map<number, TileEntry> = new Map();
	/** Map tracking ongoing texture download requests (key: tile index, value: image src). @internal */
	private requests: Map<number, string> = new Map();
	/** Forget in-memory tiles after X seconds not drawn */
	private deleteAfterSeconds:number;

	/** Array storing Svelte store unsubscriber functions. @internal */
	private unsubscribe: Unsubscriber[] = [];

	// --- ANIMATION HOOKS ---
	/** Map storing Camera instances associated with Wasm image pointers. @internal */
	private cameras: Map<number, Camera> = new Map();

	// --- Internals ---

	/** Flag to prevent Wasm from automatically setting 360 direction (used during transitions). @internal */
	preventDirectionSet:boolean = false;

	// --- RENDER BUFFERS AND ARRAYS ---

	/** Shared Float32Array view into Wasm memory for standard tile vertex data. @internal */
	_vertexBuffer!: Float32Array;
	/** Static Float32Array holding texture coordinates for a standard quad. @internal */
	static readonly _textureBuffer: Float32Array = Wasm.getTextureBuffer(1,1);

	// --- 360 ---

	/** Number of horizontal segments used for 360 sphere geometry. @internal */
	static segsX: number;
	/** Number of vertical segments used for 360 sphere geometry. @internal */
	static segsY: number;

	/** Shared Float32Array view into Wasm memory for 360 tile vertex data. @internal */
	_vertexBuffer360!: Float32Array;
	/** Static Float32Array holding texture coordinates mapped to the 360 sphere geometry. @internal */
	static _textureBuffer360: Float32Array;

	/** Object storing Float32Array views into Wasm memory for perspective matrices, keyed by image pointer. @internal */
	private _pMatrices: { [key: number]: Float32Array } = {};

	/** Flag indicating if the current context is a gallery. @internal */
	private isGallery:boolean = false;

	/**
	 * Wasm import object, providing JavaScript functions callable from Wasm.
	 * @internal
	 */
	private imports:WebAssembly.Imports = {
		'env': { // Standard environment imports
			'memory': this.memory, // Provide shared memory
			'abort': console.error // Basic abort handler
		},
		'main': { // Custom functions exposed to Wasm
			'console.log': console.log, // Allow Wasm to log messages
			'console.log2': console.log, // (Multiple log functions likely for debugging different types/arity)
			'console.log3': console.log,
			'console.log4': console.log,
			'drawTile': this.drawTile.bind(this), // Callback to draw a specific tile
			'drawQuad': (opacity:number) : void => this.micrio.webgl.drawTile(undefined, opacity), // Callback to draw a simple quad (e.g., background)
			'aniAbort': (ptr:number) : void => { // Callback when a camera animation is aborted
				const c = this.cameras.get(ptr);
				if(!c) return;
				if(c.aniAbort) c.aniAbort(); // Call JS reject function
				c.aniDoneAdd.length = 0; // Clear queued callbacks
				c.aniAbort = c.aniDone = undefined; // Clear promise functions
			},
			'aniDone': (ptr:number) : void => { // Callback when a camera animation completes
				const c = this.cameras.get(ptr);
				if(!c) return;
				if(c.aniDone) c.aniDone(); // Call JS resolve function
				while(c.aniDoneAdd.length) c.aniDoneAdd.shift()?.(); // Execute queued callbacks
				c.aniAbort = c.aniDone = undefined; // Clear promise functions
			},
			'getTileOpacity': (i:number) : number => this.tiles.get(i)?.opacity || 0, // Get current opacity for a tile (for fading)
			'setTileOpacity': (i:number,direct:boolean=false,imageOpacity:number=1) : number => { // Calculate and set tile opacity during fade-in
				const tile = this.tiles.get(i);
				if(!tile) return 0;
				if(tile.opacity < 1) {
					tile.opacity = direct ? 1 : (tile.loadedAt && tile.loadedAt > 0 ? Math.min(1,(this.now - tile.loadedAt) / 250) * imageOpacity : 0);
				}
				return tile.opacity;
			},
			'setMatrix': (ptr:number) => this.micrio.webgl.gl.uniformMatrix4fv( // Set the perspective matrix uniform in WebGL
				this.micrio.webgl.pmLoc, false, this._pMatrices[ptr]),
			'setViewport': (left:number,bottom:number,w:number,h:number) => this.micrio.webgl.gl // Set the WebGL viewport
				.viewport(Math.floor(left), Math.floor(bottom), Math.ceil(w), Math.ceil(h)),
			'viewSet': (ptr:number) => this.cameras.get(ptr)?.viewChanged(), // Callback when the view changes in Wasm
			'viewportSet': (ptr:number,x:number,y:number,w:number,h:number) => { // Callback when the calculated viewport changes in Wasm
				const img = this.images.find(i => i.ptr == ptr);
				if(img && 'camera' in img) img.viewport.set([x,y,w,h]); // Update the Svelte store
			},
			// Callbacks to update the visibility store of an image
			'setVisible': (ptr:number,visible:number) => this.images.find(i => i.ptr == ptr)?.visible.set(visible===1),
			// setVisible2 kept for Wasm binary compatibility - same implementation as setVisible
			'setVisible2': (ptr:number,visible:number) => this.images.find(i => i.ptr == ptr)?.visible.set(visible===1)
		}
	}

	/**
	 * Generates a Float32Array containing texture coordinates for a quad,
	 * potentially subdivided for 360 projection.
	 * @internal
	 * @param segsX Number of horizontal segments.
	 * @param segsY Number of vertical segments.
	 * @returns Float32Array of texture coordinates [u0,v0, u1,v1, ...].
	 */
	private static getTextureBuffer(
		segsX:number,
		segsY:number
	) : Float32Array {
		const b = new Float32Array(2 * 6 * segsX * segsY); // 2 components (u,v) * 6 vertices per quad * segments
		const dX = 1 / segsX, dY = 1 / segsY; // Size of each segment
		// Generate coordinates for two triangles per segment
		for(let i=0,y=0;y<segsY;y++) for(let x=0;x<segsX;x++,i+=12) { // 12 values per quad (2 triangles * 3 vertices * 2 coords)
			// Triangle 1: (x, y+dY), (x+dX, y), (x, y)
			// Triangle 2: (x, y+dY), (x+dX, y+dY), (x+dX, y)
			// Order might be different depending on vertex order in Wasm/WebGL
			// This specific order seems optimized for TRIANGLE_STRIP or specific vertex ordering.
			// It generates coordinates for vertices: (x,y+dY), (x+dX,y), (x,y), (x+dX,y+dY) - likely for two triangles forming the quad.
			// TODO: Clarify the exact vertex order this corresponds to. It seems unusual.
			b[i+3] = b[i+7] = b[i+9] = (b[i+1] = b[i+5] = b[i+11] = y * dY) + dY; // V coordinates
			b[i+4] = b[i+8] = b[i+10] = (b[i+0] = b[i+2] = b[i+6] = x * dX) + dX; // U coordinates
		} return b;
	}

	/**
	 * Creates the Wasm controller instance.
	 * @param micrio The main HTMLMicrioElement instance.
	*/
	constructor(
		public micrio: HTMLMicrioElement
	) {
		// Duration in seconds for removing tiles from memory after they were last in the screen
		this.deleteAfterSeconds = Browser.iOS ? 5 : get(this.micrio.canvas.isMobile) ? 30 : 90;
		// Bind methods for use as callbacks
		this.render = this.render.bind(this);
		this.draw = this.draw.bind(this);
		// Subscribe to current image changes to update the active canvas in Wasm
		this.unsubscribe.push(micrio.current.subscribe(this.setCanvas.bind(this)));
	}

	/**
	 * Loads and instantiates the WebAssembly module.
	 * @returns A Promise that resolves when the Wasm module is ready.
	 * @throws Error if WebAssembly binary loading or instantiation fails
	*/
	async load():Promise<void> {
		if(this.i >= 0) return; // Already loaded
		this.i = 0; // Mark as loading
		const data = await wasmPromise; // Wait for binary data
		if(!((data instanceof Uint8Array) || (data instanceof ArrayBuffer))) {
			throw new Error('WebAssembly binary data is invalid. Expected ArrayBuffer or Uint8Array.');
		}

		// Instantiate the Wasm module with imports
		// WebAssembly.instantiate with BufferSource returns { instance, module }
		const result = await self.WebAssembly.instantiate(data as BufferSource, this.imports);
		this.e = result.instance.exports as MicrioWasmExports; // Store exports

		// Initialize the main Micrio instance in Wasm
		this.i = this.e.constructor();
		// Get static geometry segment counts
		Wasm.segsX = this.e.segsX.value;
		Wasm.segsY = this.e.segsY.value;
		// Generate static 360 texture buffer
		Wasm._textureBuffer360 = Wasm.getTextureBuffer(Wasm.segsX,Wasm.segsY);
		// Create Float32Array views into Wasm memory for vertex buffers
		this._vertexBuffer = new Float32Array(this.b, this.e.getVertexBuffer(this.i) + 32, 6 * 3); // Standard quad vertices
		this._vertexBuffer360 = new Float32Array(this.b, this.e.getVertexBuffer360(this.i) + 32, 6 * 3 * Wasm.segsX * Wasm.segsY); // 360 sphere vertices
		// Subscribe to barebone mode changes
		this.unsubscribe.push(this.micrio.barebone.subscribe(b => this.e.setBareBone(this.i, this.bareBone = b)));
	}

	/** Unbinds event listeners, stops rendering, and cleans up resources. */
	unbind():void{
		this.stop(); // Stop rendering loop
		while(this.unsubscribe.length) this.unsubscribe.shift()?.(); // Unsubscribe from stores
		// Abort any ongoing texture downloads
		this.requests.forEach(src => abortDownload(src));
		this.requests.clear();
		// Clear timeouts and delete all tiles
		for(const [idx, tile] of this.tiles.entries()) {
			if(tile.timeoutId) clearTimeout(tile.timeoutId);
			this.deleteTile(idx);
		}
		this.tiles.clear();
		// Reset Wasm state if initialized
		if(this.i > 0) this.e.reset(this.i);
	}

	/** Gets the pointer to the main Micrio instance in Wasm memory. @internal */
	getPtr() : number {return this.i}

	/**
	 * Adds a new image canvas instance to the Wasm module.
	 * Initializes the canvas in Wasm with image dimensions, settings, etc.
	 * @internal
	 * @param c The MicrioImage instance to add.
	 */
	private addCanvas(c:MicrioImage) : void {
		const i = c.$info;
		if(!i) return; // Info must be loaded
		if(c.error) { // Handle loading errors
			this.micrio.loading.set(false);
			return;
		}

		// Validate dimensions
		if(!c.noImage && (!i.width || !i.height)) throw 'Invalid Micrio image size';

		const settings = c.$settings; // Get current settings

		// Determine if part of a gallery or Omni object
		this.isGallery = !!i.gallery || c.isOmni;

		// Configure Wasm based on archive settings
		if(settings.gallery?.archive) this.e.setHasArchive(this.i, true, settings.gallery.archiveLayerOffset ?? 0);
		// Handle legacy version compatibility
		if(i.version && parseFloat(i.version) <= 3.1) this.e.setNoUnderzoom(this.i, true);

		// Determine cover limit/start settings
		if(i.is360) settings.limitToCoverScale = false;
		const coverLimit = !!settings.limitToCoverScale;
		const coverStart = coverLimit || settings.initType == 'cover';

		// If it's a virtual canvas, mark loading as complete
		if(c.noImage) this.micrio.loading.set(false);

		// Determine focus point
		const focus = [.5,.5];
		const f = settings.focus;
		const isSpaces = !!i.spacesId;
		if(f) {
			if(!isNaN(f[0]) && f[0] !== null) focus[0] = f[0];
			if(!isNaN(f[1]) && f[1] !== null) focus[1] = f[1];
		}

		// Set true north for 360 images
		if(i.is360) c.camera.trueNorth = settings._360?.trueNorth ?? .5;

		// Check for 360 video
		const vid360 = settings._360?.video;
		const is360Video = i.is360 && vid360 && (vid360.src || ('video' in vid360 && vid360['video']));

		// Determine if it's a gallery type where images overlap
		const gallerySwitch = !!this.isGallery && (settings.gallery?.type == 'switch'
			|| settings.gallery?.type == 'omni'
			|| settings.gallery?.type == 'swipe-full');

		// Get Omni layer count and start index
		const numOmniLayers = settings.omni?.layers?.length ?? 1;
		if(settings.omni) settings.omni.layerStartIndex = Math.min(numOmniLayers - 1, settings.omni?.layerStartIndex ?? 0);

		// Call Wasm constructor for the canvas instance
		c.ptr = this.e._constructor(
			this.i, // Main Micrio instance pointer
			i.width, i.height, i.tileSize ?? 1024,
			i.is360 ?? false,
			c.noImage, // Is it a virtual canvas?
			!!(i.isSingle || is360Video), // Is it a single texture (video/image)?
			c.opacity, // Initial opacity
			settings.freeMove ?? false, // Enable free camera movement?
			coverLimit, // Limit zoom out to cover?
			coverStart, // Start zoomed to cover?
			(settings.zoomLimit || 1), // Max zoom limit
			(settings.zoomLimitDPRFix !== false ? this.micrio.canvas.getRatio(c.$settings) : 1), // DPR fix multiplier
			settings.camspeed ?? 1, // Camera speed
			c.camera.trueNorth, // 360 true north offset
			gallerySwitch, // Is it an overlapping gallery type?
			!!settings.gallery?.isSpreads && settings.gallery.type == 'swipe', // Is it a swiping spreads gallery?
			c.isOmni, // Is it an Omni object?
			settings.pinchZoomOutLimit ?? false, // Limit pinch zoom out?
			numOmniLayers, // Number of Omni layers
			settings.omni?.layerStartIndex ?? 0, // Omni start layer index
		);

		// Bind camera buffers to Wasm memory
		this.bindCamera(c);

		// Set initial area if defined
		if(c.opts.area) c.camera.setArea(c.opts.area, {direct: true, noDispatch:true, noRender:true});

		// Set initial limit if defined
		if(settings?.restrict) c.camera.setLimit(settings.restrict);

		// Set custom durations if provided
		if(settings?.crossfadeDuration)
			this.e.setCrossfadeDuration(this.i, settings.crossfadeDuration);
		if(settings?.embedFadeDuration)
			this.e.setEmbedFadeDuration(this.i, settings.embedFadeDuration);
		if(settings?.dragElasticity !== undefined)
			this.e.setDragElasticity(this.i, settings.dragElasticity);
		if(settings?.skipBaseLevels)
			this.e.setSkipBaseLevels(this.i, settings.skipBaseLevels);

		// Apply Omni-specific settings
		if(settings?.omni) c.camera.setOmniSettings();
		// Apply limited rendering mode if attribute set
		if(this.micrio.hasAttribute('data-limited')) this.e._setLimited(c.ptr, true);

		// Add image to managed list
		this.images.push(c);
		// Request initial viewport calculation from Wasm
		this.e._sendViewport(c.ptr);

		// Track base tile index for this image
		const numTiles = this.e.getNumTiles(this.i);
		if(numTiles > 0) {
			const baseTileIdx = numTiles - 1;
			this.getTileEntry(baseTileIdx).opacity = 1; // Initialize base tile opacity
			this.baseTiles.push(baseTileIdx);
		}
		// Create Float32Array view for the perspective matrix
		const mPtr = this.e._getPMatrix(c.ptr);
		this._pMatrices[mPtr] = new Float32Array(this.b, mPtr + 32, 16);

		// Set initial view (from state, settings, or focus point)
		const v = get(c.state.view) || settings.view;
		if(v && !(v[0] == 0 && v[1] == 0 && v[2] == 1 && v[3] == 1)) { // If specific view is set
			this.e._setView(c.ptr, v[0]+v[2]/2, v[1]+v[3]/2, v[2], v[3], false, false, false);
		} else if((isSpaces || !i.is360) && focus && focus.toString() != '0.5,0.5') { // If focus point is set (and not default 360)
			this.e._setCoo(c.ptr, focus[0], focus[1], 0, 0, performance.now()); // Set view centered on focus point
			settings.focus = undefined; // Clear focus setting after applying
		}

		// Trigger render loop when 360 video starts playing
		c.video.subscribe(v => v && v.addEventListener('play', this.render));

		// Mark virtual canvases as visible immediately
		if(c.noImage) c.visible.set(true);

		// Set this canvas as the active one in Wasm
		this.setCanvas(c);
	}

	/**
	 * Binds a MicrioImage's Camera instance to the corresponding Wasm memory buffers.
	 * @internal
	 * @param img The MicrioImage instance.
	*/
	private bindCamera(img:MicrioImage) : void {
		this.cameras.set(img.ptr, img.camera); // Store camera instance by pointer
		// Assign FloatArray views into Wasm memory to the camera instance
		img.camera.assign(
			this.e,
			new Float64Array(this.b, this.e._getView(img.ptr) + 32, 4), // Now center-based view buffer
			new Float64Array(this.b, this.e._getXY(img.ptr, 0,0) + 32, 5), // XY buffer
			new Float64Array(this.b, this.e._getCoo(img.ptr, 0,0) + 32, 5), // Coo buffer
			new Float32Array(this.b, this.e._getMatrix(img.ptr) + 32, 16), // Matrix buffer
		)
	}

	/**
	 * Sets the currently active canvas/image instance in the Wasm module.
	 * Handles adding the canvas to Wasm if it's not already initialized.
	 * @param canvas The MicrioImage instance to set as active.
	*/
	setCanvas(canvas?:MicrioImage) : void {
		// Exit if no canvas provided or it's already the active one
		if(!canvas || (canvas.ptr > 0 && canvas.ptr == this.c)) return;

		// If canvas hasn't been added to Wasm yet, wait for its info then add it
		if(canvas.ptr < 0) once(canvas.info).then(info => { if(!info) return;
			// Ensure this canvas is still the intended target (relevant for async operations)
			if(!this.micrio.$current || (!info.isIIIF && !canvas.opts.secondaryTo && info.id != this.micrio.$current.id)) return;
			this.addCanvas(canvas); // Add canvas to Wasm
			// Add any embeds associated with this canvas
			if(canvas.embeds.length) canvas.embeds.forEach(e => this.addEmbed(e, canvas));
		});
		// If canvas already exists in Wasm, just set it as active
		else if(this.c != canvas.ptr) {
			// Preserve orientation when switching between 360 images
			const yaw = canvas.is360 && this.c >= 0 ? this.e._getYaw(this.c, true) : 0;
			const pitch = canvas.is360 && this.c >= 0 ? this.e._getPitch(this.c) : 0
			this.c = canvas.ptr; // Update active canvas pointer
			// Apply previous orientation if applicable (and not coming from waypoint)
			if(canvas.is360 && !this.preventDirectionSet && yaw && pitch)
				this.e._setDirection(this.c, yaw + (.5-(canvas.$settings?._360?.trueNorth||0))*Math.PI*2, pitch, true);
			// Fade in if it was previously faded out
			if(this.e._getTargetOpacity(canvas.ptr) == 0) this.e._fadeIn(canvas.ptr);
			// Set initial Omni layer if applicable
			if(canvas.$settings.omni?.layerStartIndex) canvas.state.layer.set(canvas.$settings.omni.layerStartIndex);
			this.preventDirectionSet = false; // Reset flag
			this.ready = true; // Mark Wasm as ready for rendering this canvas
			this.render(); // Trigger render loop
		}
	}

	/** Removes a canvas instance from the Wasm module. */
	removeCanvas(c:MicrioImage) : void {
		if(c.ptr < 0) throw 'Canvas is not placed yet';
		this.e._remove(c.ptr); // Call Wasm remove function
		this.render(); // Trigger render to update display
	}

	/** Requests the next animation frame to trigger the `draw` method. */
	render() : void {
		// Request frame only if not already requested
		if(this.raf < 0) this.raf = this.micrio.webgl.display.requestAnimationFrame(this.draw);
	}

	/**
	 * The main drawing loop, called by `requestAnimationFrame`.
	 * Checks if rendering is needed, calls the Wasm draw function,
	 * dispatches events, and cleans up unused tiles.
	 * @internal
	 * @param now Timestamp provided by `requestAnimationFrame`.
	 */
	private draw(now:number = performance.now()) : void {
		if(!this.micrio.isConnected) return; // Exit if element disconnected

		this.raf = -1; // Reset RAF ID
		this.drawing = false; // Reset drawing flag
		this.now = now; // Store current timestamp

		// Check if Wasm indicates drawing is needed or if forced
		if(this.e.shouldDraw(this.i, now) == 1
			|| this.micrio.keepRendering // Forced continuous rendering
			|| this.micrio.events.isNavigating // User is interacting
			|| this.micrio._current?._video?.paused === false) // Video is playing
		{
			this.render(); // Request the next frame
		}

		// Prepare for drawing (e.g., clear canvas if gallery)
		if(this.isGallery) this.drawStart();
		this.drawnSet.clear(); // Clear set of drawn tiles for this frame
		this.e.draw(this.i); // Call the main Wasm draw function

		this.micrio.events.dispatch('draw'); // Dispatch 'draw' event

		this.cleanup(); // Clean up unused tiles

		this.micrio.webgl.drawEnd(); // Finalize WebGL drawing state
	}

	/** Stops the rendering loop by canceling the animation frame request. @internal */
	private stop(){
		if(this.raf < 0) return;
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
	 * Callback function called from Wasm for each tile that needs to be drawn.
	 * Handles loading the tile texture if necessary and calls the WebGL draw function.
	 * @internal
	 * @returns True if the tile texture is ready and drawn, false otherwise.
	 */
	private drawTile(
		imgIdx: number, // Index of the MicrioImage in the `images` array
		i: number, // Global tile index
		layer: number, // Zoom level index
		x: number, // Tile X coordinate
		y: number, // Tile Y coordinate
		opacity: number, // Current opacity (for fading)
		animating: boolean, // Is the camera currently animating?
		targetLayer: boolean // Is this tile part of the target resolution layer?
	) : boolean {
		this.drawnSet.add(i); // Mark tile as drawn this frame
		const tile = this.getTileEntry(i);
		tile.deleteAt = undefined; // Cancel pending deletion if drawn again

		const numLoading = runningThreads(); // Get number of active texture downloads
		const c = this.images[imgIdx]; // Get the image/frame object
		// Determine if it's a video or 360 image
		const isVideo = 'camera' in c && c.isVideo;
		const is360 = 'camera' in c && c.is360;
		// Get the actual MicrioImage instance (might be the object itself or its parent)
		const img = 'camera' in c ? c : c.image;
		// Get frame number if it's an Omni frame object
		const frame = 'frame' in c ? c.frame : undefined;

		// --- Texture Loading Logic ---
		// If tile is not loaded and workers are available
		if(tile.loadState === 0 && numLoading < numThreads) {
			// Prioritization: Delay loading high-res tiles during animation if workers busy,
			// or if in barebone mode and many workers are busy.
			if(this.bareBone ? numLoading > 2 && animating : targetLayer && animating && numLoading > 0) return false;

			// Handle video textures (create texture immediately, update later)
			if(isVideo && !is360) { // Exclude 360 videos (handled differently?)
				tile.loadState = 2; // Mark as loaded (texture created, content pending)
				tile.texture = this.micrio.webgl.getTexture(); // Create empty WebGL texture
			}
			// Handle standard image tiles
			else {
				tile.loadState = 1; // Mark as loading
				const src = img.getTileSrc(layer, x, y, frame); // Get tile URL
				if(src) this.getTexture(i, src, animating, { // Start loading via texture loader
					noSmoothing: '$info' in c && c.$settings.noSmoothing // Pass smoothing option
				});
				else {
					tile.loadState = 0; // Reset state if no src
					return false;
				}
			}
		}
		// If tile texture is ready (state >= 2)
		else if(tile.loadState >= 2) {
			// Clear canvas only on the first draw operation of the frame
			if(!this.drawing) this.drawStart();

			if(tile.texture) { // Check if texture exists
				if(isVideo) { // Handle video texture update
					// Check if video element exists and is ready to play
					if(!img._video || !img._video.dataset.playing) return false; // Video not ready
					this.micrio.webgl.updateTexture(tile.texture, img._video); // Update texture with current video frame
				}
				// Draw the tile using WebGL controller
				this.micrio.webgl.drawTile(tile.texture, opacity, is360);
			}

			// Tile is loaded and ready
			if(tile.loadState === 2) {
				tile.loadState = 3;
				tile.loadedAt = this.now;
			}

			return true; // Indicate tile was drawn
		}
		return false; // Tile not ready or not drawn
	}

	/** Prepares the WebGL context for drawing a new frame (clears canvas). @internal */
	private drawStart() : void {
		if(this.drawing) return;
		this.micrio.webgl.drawStart(); // Call WebGL controller's start function
		this.drawing = true; // Set drawing flag
	}

	/**
	 * Initiates loading of a texture using the texture loader utility.
	 * Handles queuing and prioritization.
	 * @internal
	 * @param i Global tile index.
	 * @param src URL of the texture image.
	 * @param ani Is the camera currently animating?
	 * @param opts Texture options (e.g., noSmoothing).
	 */
	getTexture(i:number, src:string, ani:boolean, opts: {
		force?:boolean;
		noSmoothing?:boolean
	} = {}) : void {
		const tile = this.tiles.get(i);
		if(tile?.texture || this.requests.has(i) || (!opts.force && runningThreads() >= numThreads)) return;
		const inArchive = archive.db.has(src);
		if(!inArchive) this.micrio.loading.set(true);
		this.requests.set(i, src);
		(inArchive ? archive.getImage(src) : loadTexture(src))
			.then((img) => this.gotTexture(i, img, ani, opts.noSmoothing))
			.catch(() => this.deleteRequest(i));
	}

	/**
	 * Callback executed when a texture bitmap is successfully loaded.
	 * Creates/updates the WebGL texture and schedules cleanup.
	 * @internal
	 * @param i Global tile index.
	 * @param img Loaded texture bitmap (ImageBitmap or HTMLImageElement).
	 * @param ani Was the camera animating when the load was initiated?
	 * @param noSmoothing Don't smooth the texture on MAG
	 */
	private gotTexture(
		i:number,
		img:TextureBitmap,
		ani:boolean,
		noSmoothing?:boolean
	) : void {
		const tile = this.getTileEntry(i);
		// Create or update WebGL texture
		tile.texture = this.micrio.webgl.getTexture(img, tile.texture, noSmoothing);
		if(self.ImageBitmap != undefined && img instanceof ImageBitmap && img['close'] instanceof Function) img['close']();
		tile.loadState = 2; // Mark as loaded

		// Schedule deletion after a delay if not drawn recently and not animating
		tile.timeoutId = setTimeout(() => {
			this.deleteRequest(i);
		}, ani ? 150 : 50) as unknown as number;
	}

	/** Removes a request from the tracking map. @internal */
	private deleteRequest(i:number) : void {
		this.requests.delete(i);
		const tile = this.tiles.get(i);
		if(tile?.timeoutId) {
			clearTimeout(tile.timeoutId);
			tile.timeoutId = undefined;
		}

		if(!this.requests.size) this.micrio.loading.set(false);
	}

	/** Deletes a WebGL texture and associated state. @internal */
	private deleteTile(idx:number) : void {
		const tile = this.tiles.get(idx);
		if(tile) {
			if(tile.texture) this.micrio.webgl.gl.deleteTexture(tile.texture); // Delete WebGL texture
			if(tile.timeoutId) clearTimeout(tile.timeoutId);
			this.tiles.delete(idx);
		}
	}

	/**
	 * Performs cleanup after each frame.
	 * Identifies unused tiles and schedules them for deletion.
	 * Deletes tiles marked for deletion if they haven't been reused.
	 * @internal
	 */
	private cleanup() : void {
		const now = performance.now();

		// Identify tiles drawn last frame but not this frame
		for (const idx of this.prevDrawnSet) {
			if (this.drawnSet.has(idx)) continue; // Still being drawn
			if (this.baseTiles.includes(idx)) continue; // Base tile, keep

			const tile = this.tiles.get(idx);
			if (!tile || tile.loadState === 0) continue;

			tile.opacity = 0;

			switch(tile.loadState) {
				case 1: // still downloading, abort
					const request = this.requests.get(idx);
					if(request) abortDownload(request);
					tile.loadState = 0;
				break;

				case 2: // Loaded, but never drawn
					if(this.requests.has(idx)) {
						this.deleteRequest(idx);
					}
					this.deleteTile(idx);
				break;

				case 3: // Loaded and drawn earlier, but not anymore
					if(!tile.deleteAt) tile.deleteAt = now;
					break;
			}
		}

		// Store currently drawn tiles for the next frame's comparison
		this.prevDrawnSet = new Set(this.drawnSet);

		// Delete tiles marked for deletion longer than X seconds ago
		for(const [idx, tile] of this.tiles.entries()) {
			if(tile.deleteAt && (now - tile.deleteAt) / 1000 > this.deleteAfterSeconds) {
				this.deleteTile(idx);
			}
		}
	}

	/**
	 * Resizes the WebGL viewport and updates Wasm dimensions.
	 * @internal
	 * @param c The new canvas view rectangle.
	 */
	resize(c: Models.Canvas.ViewRect) : void {
		// Notify Wasm of resize
		this.e.resize(this.i, c.width, c.height, c.left, c.top, c.ratio, c.scale, c.portrait);
		if(this.ready) { this.stop(); this.draw(); } // Trigger render
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
		image.baseTileIdx = this.e.getNumTiles(this.i) - 1;
		this.getTileEntry(image.baseTileIdx).opacity = 1;
		this.baseTiles.push(image.baseTileIdx);
	})

	/**
	 * Adds an embedded MicrioImage instance to Wasm.
	 * @internal
	 * @param img The embed MicrioImage instance.
	 * @param parent The parent MicrioImage instance.
	 * @param opts Embedding options.
	 */
	addEmbed(image:MicrioImage|Models.Omni.Frame, parent:MicrioImage, opts:Models.Embeds.EmbedOptions = {}) : Promise<void>|void {
		if('camera' in image && opts.asImage) return this.addImage(image, parent, true, opts.opacity ?? 1);
		else {
			const i = '$info' in image ? image.$info : parent.$info;
			if(!i) return;
			this.images.push(image);
			const a = image.opts.area ?? [0,0,1,1];
			const _360 = image instanceof MicrioImage ? image.$settings._360 ?? {} : {};
			image.ptr = this.e._addImage(parent.ptr, a[0], a[1], a[2], a[3], i.width, i.height, i.tileSize||1024, i.isSingle ?? false, i.isVideo ?? false, opts.opacity ?? 1, _360.rotX??0, _360.rotY??0, _360.rotZ??0, _360.scale??1, opts.fromScale ?? 0);
			image.baseTileIdx = this.e.getNumTiles(this.i) - 1;
			this.getTileEntry(image.baseTileIdx).opacity = 1;
			this.baseTiles.push(image.baseTileIdx);
		}
	}

	/** Add a child independent canvas to the current canvas, used for grid images
	 * @param image The image
	 * @param parent The parent image
	 * @returns Promise when the image is added
	 */
	addChild = (image:MicrioImage, parent:MicrioImage) => this.addImage(image, parent);

	/**
	 * Sets the active image frame index for an Omni object.
	 * @internal
	 * @param ptr Wasm pointer to the Omni image instance.
	 * @param idx Target frame index.
	 * @param num Optional number of frames to blend (for smooth transitions).
	 */
	setActiveImage(ptr:number, idx:number, num?:number) : void {
		this.e._setActiveImage(ptr, idx, num ?? 0);
	}

	/**
	 * Sets the active layer index for an Omni object.
	 * @internal
	 * @param ptr Wasm pointer to the Omni image instance.
	 * @param idx Target layer index.
	 */
	setActiveLayer(ptr:number, idx:number) : void {
		this.e._setActiveLayer(ptr, idx);
	}

	/**
	 * Fades an image (main or embed) to a target opacity.
	 * @internal
	 * @param ptr Wasm pointer to the image instance.
	 * @param opacity Target opacity (0-1).
	 * @param direct If true, sets opacity instantly without animation.
	 */
	 fadeImage(ptr:number, opacity:number, direct:boolean = false) : void {
		// Is main canvas image
		if(this.cameras.has(ptr)) this.e._fadeTo(ptr, opacity, direct);
		// Is embedded sub-image
		else this.e._fadeImage(ptr, opacity, direct);
		this.render();
	}

	/**
	 * Sets the focus point for zoom operations.
	 * @internal
	 * @param ptr Wasm pointer to the image instance.
	 * @param v View rectangle [x0, y0, x1, y1] defining the focus area.
	 * @param noLimit If true, allows focus outside image bounds.
	 */
	setFocus(ptr:number, v:Models.Camera.ViewRect, noLimit:boolean=false) : void {
		this.e._setFocus(ptr, v[0], v[1], v[2], v[3], noLimit);
	}

}
