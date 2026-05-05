/**
 * Main controller class for the Micrio engine.
 * Manages all canvases, global settings, and host callbacks.
 * @author Marcel Duin <marcel@micr.io>
 */

import { Viewport } from './shared';
import { segsX, segsY } from './globals';
import Canvas from './canvas';
import type Image from './image';
import { easeInOut, Bicubic } from './utils'

/**
 * Main controller class for the Micrio engine.
 * Manages all canvases, global settings, and the render loop.
 * Host callbacks are set as assignable properties by the JS host.
 */
export class Main {
	/** Viewport representing the main HTML element (<micr-io>). */
	readonly el: Viewport = new Viewport;

	/** Vertex buffer for rendering 2D image tiles (quads). */
	readonly vertexBuffer: Float32Array = new Float32Array(6 * 3);
	/** Vertex buffer for rendering 360 sphere geometry. */
	readonly vertexBuffer360: Float32Array = new Float32Array(6 * 3 * segsX * segsY);

	/** Array holding all active Canvas instances managed by this engine. */
	readonly canvases: Canvas[] = [];

	/** Total number of tiles across all images in all canvases. */
	numTiles: number = 0;
	/** Total number of Image instances across all canvases. */
	numImages: number = 0;

	/** Timestamp of the current frame (performance.now()). */
	now: number = 0;
	/** Flag indicating if any animation is active in any canvas this frame. */
	animating: boolean = false;
	/** Overall loading progress (0-1) based on tiles drawn vs tiles needed. */
	progress: number = 0;
	/** Total number of tiles needed across all canvases this frame. */
	toDrawTotal: number = 0;
	/** Total number of tiles successfully drawn (or already loaded) across all canvases this frame. */
	doneTotal: number = 0;

	/** Default duration (seconds) for crossfade between canvases. */
	crossfadeDuration: number = .25;
	/** Default duration (seconds) for grid item transitions. */
	gridTransitionDuration: number = .5;
	/** Default easing function for grid transitions. */
	gridTransitionTimingFunction: Bicubic = easeInOut;
	/** Default duration (seconds) for transitions between 360 spaces. */
	spacesTransitionDuration: number = .5;
	/** Default duration (seconds) for fading embedded images/videos. */
	embedFadeDuration: number = .5;

	/** Elasticity factor for kinetic dragging (higher = more movement). */
	dragElasticity: number = 1;

	/** Flag indicating if a binary archive is being used. */
	hasArchive: boolean = false;
	/** Layer offset when using an archive. */
	archiveLayerOffset: number = 0;

	/** Number of "underzoom" levels. */
	underzoomLevels: number = 4;

	/** Number of lowest resolution layers to skip loading initially. */
	skipBaseLevels: number = 0;

	/** Flag for barebone mode (minimal texture loading). */
	bareBone: boolean = false;

	/** Flag indicating if the current context is a swipe gallery. */
	isSwipe: boolean = false;

	/** Flag to disable panning during pinch gestures. */
	noPinchPan: boolean = false;

	/** Target direction for 360 transition. */
	direction: number = 0;
	/** Horizontal distance for 360 transition. */
	distanceX: number = 0;
	/** Vertical distance for 360 transition. */
	distanceY: number = 0;

	/** Estimated time per frame in seconds (used for animation speed normalization). */
	frameTime: number = 1 / 60;

	// --- Host Callbacks (set by JS host after construction) ---
	drawTile: (imgIdx: number, idx: number, layer: number, x: number, y: number, opacity: number, animating: boolean, isTargetLayer: boolean) => boolean = () => false;
	drawQuad: (opacity: number) => void = () => {};
	getTileOpacity: (idx: number) => number = () => 0;
	setTileOpacity: (idx: number, direct: boolean, imageOpacity: number) => number = () => 0;
	setMatrix: (arr: Float32Array) => void = () => {};
	setViewport: (x: number, y: number, width: number, height: number) => void = () => {};
	aniDone: (c: Canvas) => void = () => {};
	aniAbort: (c: Canvas) => void = () => {};
	viewSet: (c: Canvas) => void = () => {};
	viewportSet: (c: Canvas, x: number, y: number, w: number, h: number) => void = () => {};
	setVisible: (c: Canvas, visible: boolean) => void = () => {};
	setVisible2: (c: Image, visible: boolean) => void = () => {};

	shouldDraw(now: number): boolean {
		this.frameTime = 1000 / Math.min(33, now - this.now);
		this.now = now;
		this.doneTotal = 0;
		this.toDrawTotal = 0;
		this.animating = false;
		for (let i = 0; i < this.canvases.length; i++) this.canvases[i].shouldDraw();
		return this.animating || this.progress < 1;
	}

	draw(): void { for (let i = 0; i < this.canvases.length; i++) this.canvases[i].draw(); }

	reset(): void { for (let i = 0; i < this.canvases.length; i++) this.canvases[i].reset(); }

	aniStop(): void { for (let i = 0; i < this.canvases.length; i++) this.canvases[i].aniStop(); }

	/**
	 * Updates the main element's viewport dimensions and triggers resize on all canvases.
	 */
	resize(w: number, h: number, l: number, t: number, r: number, s: number, p: boolean): void {
		this.el.set(w, h, l, t, r, s, p);
		for (let i = 0; i < this.canvases.length; i++) this.canvases[i].resize();
	}

	/** Removes a specific Canvas instance from the managed list. */
	remove(c: Canvas): void {
		for (let i = 0; i < this.canvases.length; i++) if (this.canvases[i] === c) {
			this.canvases.splice(i, 1);
			return;
		}
	}
}
