import { Viewport } from './shared';
import { segsX, segsY } from './globals';
import Canvas from './canvas';
import Image from './image';
import { easeInOut, Bicubic } from './utils'

/**
 * Called by Wasm when a camera animation completes successfully.
 * @param c The Canvas instance whose animation finished.
 */
export declare function aniDone(c:Canvas) : void;

/**
 * Called by Wasm when a camera animation is aborted (e.g., by user interaction).
 * @param c The Canvas instance whose animation was aborted.
 */
export declare function aniAbort(c:Canvas) : void;

/**
 * Requests the JS host to draw a specific image tile.
 * The host (JS/WebGL) is responsible for texture loading and rendering.
 * @param imgIdx The global index of the Image instance.
 * @param idx The global index of the tile within the texture atlas.
 * @param layer The resolution layer index of the tile.
 * @param x The column index of the tile within its layer.
 * @param y The row index of the tile within its layer.
 * @param opacity The calculated opacity for this tile (0-1).
 * @param animating Whether a camera animation is currently running.
 * @param isTargetLayer Whether this tile belongs to the ideal resolution layer for the current view.
 * @returns `true` if the tile was successfully drawn (or is already loaded/cached), `false` otherwise. Used by Wasm to track base layer loading.
 */
export declare function drawTile(imgIdx:u32, idx:u32, layer:u32, x:u32, y:u32, opacity:f64, animating:bool, isTargetLayer:bool) : bool;

/**
 * Requests the JS host to draw a background quad (likely for gallery pages).
 * @param opacity The opacity of the quad.
 * @returns Likely indicates success, though usage seems specific.
 */
export declare function drawQuad(opacity:f64) : bool;

/**
 * Gets the current opacity of a tile, as managed by the JS host (reflects loading state/fade).
 * @param idx The global index of the tile.
 * @returns The tile's current opacity (0-1).
 */
export declare function getTileOpacity(idx:u32) : f32;

/**
 * Sets the target opacity for a tile, managed by the JS host (for fading effects).
 * @param idx The global index of the tile.
 * @param direct If true, set opacity immediately; otherwise, initiate a fade.
 * @param imageOpacity The overall opacity of the parent Image instance.
 * @returns The resulting opacity (likely the target opacity).
 */
export declare function setTileOpacity(idx:u32, direct: bool, imageOpacity: f64) : f32;

/**
 * Sends a transformation matrix (likely projection or model-view) to the JS host/WebGL.
 * @param arr The matrix data as a Float32Array.
 */
export declare function setMatrix(arr:Float32Array) : void;

/**
 * Sets the WebGL viewport dimensions.
 * @param x The x offset.
 * @param y The y offset.
 * @param width The viewport width.
 * @param height The viewport height.
 */
export declare function setViewport(x:number,y:number,width:number,height:number) : void;

/**
 * Notifies the JS host that the calculated view (logical viewport) of a Canvas has changed.
 * @param c The Canvas instance whose view changed. JS uses this to update its corresponding MicrioImage state store.
 */
export declare function viewSet(c:Canvas) : void;

/**
 * Notifies the JS host that the calculated screen viewport (position and size) of a Canvas has changed.
 * @param c The Canvas instance whose screen viewport changed.
 * @param x The new screen x position (pixels).
 * @param y The new screen y position (pixels).
 * @param w The new screen width (pixels).
 * @param h The new screen height (pixels).
 */
export declare function viewportSet(c:Canvas,x:number,y:number,w:number,h:number) : void;

/**
 * Notifies the JS host about a change in the visibility state of a Canvas.
 * @param c The Canvas instance.
 * @param visible The new visibility state.
 */
export declare function setVisible(c:Canvas,visible:bool) : void;

/**
 * Notifies the JS host about a change in the visibility state of an Image within a Canvas.
 * @param c The Image instance. (Note: Parameter name 'c' might be confusing, it's an Image).
 * @param visible The new visibility state.
 */
export declare function setVisible2(c:Image,visible:bool) : void;

// Debugging functions
export declare namespace console {
	export function log(a: f64) : void;
	export function log2(a: f64, b:f64) : void;
	export function log3(a: f64, b:f64, c:f64) : void;
	export function log4(a: f64, b:f64, c:f64, d:f64) : void;
}

/**
	* Main controller class for the Wasm module instance.
	* Manages all canvases, global settings, and the render loop.
	*/
export class Main {
	/** Viewport representing the main HTML element (<micr-io>). */
	readonly el : Viewport = new Viewport;

	// --- Vertex Buffers (Memory allocated here, accessed by JS) ---
	/** Vertex buffer for rendering 2D image tiles (quads). Layout: [x,y,z, x,y,z, ...] for 2 triangles. */
	readonly vertexBuffer : Float32Array = new Float32Array(6 * 3); // 6 vertices * 3 coordinates
	/** Vertex buffer for rendering 360 sphere geometry. Layout: [x,y,z, x,y,z, ...] */
	readonly vertexBuffer360 : Float32Array = new Float32Array(6 * 3 * segsX * segsY); // 6 verts * 3 coords * segments

	// --- Canvas Management ---
	/** Array holding all active Canvas instances managed by this Wasm instance. */
	readonly canvases : Canvas[] = [];

	// --- Global Counters (Exported to JS) ---
	/** Total number of tiles across all images in all canvases. */
	numTiles : u32 = 0;
	/** Total number of Image instances across all canvases. */
	numImages : u32 = 0;

	// --- Per-Frame State ---
	/** Timestamp of the current frame (performance.now()). */
	now : f32 = 0;
	/** Flag indicating if any animation is active in any canvas this frame. */
	animating : bool = false;
	/** Overall loading progress (0-1) based on tiles drawn vs tiles needed. */
	progress : f64 = 0;
	/** Total number of tiles needed across all canvases this frame. */
	toDrawTotal : f32 = 0;
	/** Total number of tiles successfully drawn (or already loaded) across all canvases this frame. */
	doneTotal : f32 = 0;

	// --- Global Animation/Transition Settings ---
	/** Default duration (seconds) for crossfade between canvases. */
	crossfadeDuration: f64 = .25;
	/** Default duration (seconds) for grid item transitions. */
	gridTransitionDuration:f64 = .5;
	/** Default easing function for grid transitions. */
	gridTransitionTimingFunction:Bicubic = easeInOut;
	/** Default duration (seconds) for transitions between 360 spaces. */
	spacesTransitionDuration:f64 = .5;
	/** Default duration (seconds) for fading embedded images/videos. */
	embedFadeDuration:f64 = .5;

	// --- Global Navigation Settings ---
	/** Elasticity factor for kinetic dragging (higher = more movement). */
	dragElasticity: f64 = 1;

	// --- Global Image Loading Settings ---
	/** Flag indicating if a binary archive is being used. */
	hasArchive: bool = false;
	/** Layer offset when using an archive. */
	archiveLayerOffset : u8 = 0;

	/** Number of "underzoom" levels (affects tile loading for older image formats). */
	underzoomLevels : u8 = 4;

	/** Number of lowest resolution layers to skip loading initially. */
	skipBaseLevels : i8 = 0;

	/** Flag for barebone mode (minimal texture loading). */
	bareBone: bool = false;

	// --- Gallery Settings ---
	/** Flag indicating if the current context is a swipe gallery. */
	isSwipe: bool = false;

	// --- Interaction Settings ---
	/** Flag to disable panning during pinch gestures. */
	noPinchPan: bool = false;

	// --- 360 Spaces Transition Variables ---
	/** Target direction for 360 transition. */
	direction : f64 = 0;
	/** Horizontal distance for 360 transition. */
	distanceX : f64 = 0;
	/** Vertical distance for 360 transition. */
	distanceY : f64 = 0;

	// --- Frame Timing ---
	/** Estimated time per frame in seconds (used for animation speed normalization). */
	frameTime: f64 = 1/60; // Assume 60fps initially

	/**
	 * Called each frame by the JS host to determine if a redraw is needed.
	 * Steps animations, calculates needed tiles, and updates progress.
	 * @param now Current timestamp (performance.now()).
	 * @returns True if a redraw should occur (animating or still loading), false otherwise.
	 */
	shouldDraw(now: f32) : bool {
		// Calculate frame time, capping at ~30fps minimum for normalization
		this.frameTime = 1000 / min(33, now - this.now);
		this.now = now;
		// Reset frame counters
		this.doneTotal = 0;
		this.toDrawTotal = 0;
		this.animating = false;
		// Call shouldDraw for each managed canvas
		this.canvases.forEach(c => { c.shouldDraw() });
		// Return true if any canvas is animating or overall progress is not 1
		return this.animating || this.progress < 1;
	}

	/** Called each frame by the JS host to execute drawing commands for all canvases. */
	draw() : void { this.canvases.forEach(c => { c.draw() }); }

	/** Resets the state of all managed canvases. */
	reset() : void { this.canvases.forEach(c => { c.reset() }); }

	/** Stops animations in all managed canvases. */
	aniStop() : void { this.canvases.forEach(c => { c.aniStop() }); }

	/**
	 * Updates the main element's viewport dimensions and triggers resize on all canvases.
	 * @param w Width in CSS pixels.
	 * @param h Height in CSS pixels.
	 * @param l Left offset in CSS pixels.
	 * @param t Top offset in CSS pixels.
	 * @param r Device pixel ratio.
	 * @param s Global scale factor (usually 1).
	 * @param p Is portrait orientation.
	 */
	resize(w: u16, h: u16, l: i32, t: i32, r: f64, s: f64, p: bool) : void {
		// Update main viewport state
		this.el.set(w, h, l, t, r, s, p);
		// Trigger resize on all canvases
		this.canvases.forEach(c => { c.resize() });
	}

	/** Sets a rendering area constraint (used for partial screen rendering). */
	setArea(_w: i32, _h: i32) : void { this.el.areaWidth = _w; this.el.areaHeight = _h; }

	/** Removes a specific Canvas instance from the managed list. */
	remove(c:Canvas) : void {
		// Find the canvas in the array and remove it
		for(let i=0;i<this.canvases.length;i++) if(unchecked(this.canvases[i] == c)) {
			this.canvases.splice(i, 1);
			return;
		}
	}
}
