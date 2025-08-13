import Image from './image';
import Canvas from './canvas';
import { mod1, pyth } from './utils'

// --- Math Constants ---
export const PI:f64 = 3.14159265358979323846;
export const PIh:f64 = PI/2; // PI Half
export const PI2:f64 = PI*2; // PI Double

/** Structure to hold information about a specific tile to be drawn. */
export class DrawRect {
	/** Reference to the Image instance this tile belongs to. */
	public image!: Image;

	constructor(
		// --- Tile Rectangle Coordinates (relative to image, 0-1) ---
		public x0: f64 = 0,
		public y0: f64 = 0,
		public x1: f64 = 0,
		public y1: f64 = 0,
		// --- Tile Identity ---
		/** Index of the resolution layer this tile belongs to. */
		public layer: u32 = 0,
		/** Column index of the tile within its layer. */
		public x: u32 = 0,
		/** Row index of the tile within its layer. */
		public y: u32 = 0
	) {}
}

/** Represents the logical view rectangle within an image. */
export class View {
	/** Float64Array view of the new coordinates [centerX, centerY, width, height]. */
	readonly arr : Float64Array = new Float64Array(4);
	/** Flag indicating if true north correction should be applied during set(). */
	public correct : bool = false;
	/** Flag indicating if the view coordinates have changed since the last frame. */
	public changed : bool = false;
	/** Flag indicating if the view limits have changed. */
	public limitChanged : bool = false;
	/** Cached true north offset (0.5 - trueNorth setting). */
	public tnOffset:number = 0;


	constructor(
		private readonly canvas: Canvas,

		public centerX: f64 = 0.5,
		public centerY: f64 = 0.5,
		public width: f64 = 1,
		public height: f64 = 1,

		public lCenterX: f64 = 0.5,
		public lCenterY: f64 = 0.5,
		public lWidth: f64 = 1,
		public lHeight: f64 = 1,
	) {
		this.tnOffset = .5 - canvas.trueNorth;


		this.toArray();
	}

	// Legacy getters
	get x0(): f64 { 
		let cx = this.centerX;
		if (this.canvas.is360) cx = mod1(cx);
		return this.canvas.is360 ? mod1(cx - this.width / 2) : (cx - this.width / 2); 
	}
	get y0(): f64 { return this.centerY - this.height / 2; }
	get x1(): f64 { 
		let cx = this.centerX;
		if (this.canvas.is360) cx = mod1(cx);
		return this.canvas.is360 ? mod1(cx + this.width / 2) : (cx + this.width / 2); 
	}
	get y1(): f64 { return this.centerY + this.height / 2; }

	// Add legacy limit getters
	get lX0(): f64 { return this.lCenterX - this.lWidth / 2; }
	get lY0(): f64 { return this.lCenterY - this.lHeight / 2; }
	get lX1(): f64 { return this.lCenterX + this.lWidth / 2; }
	get lY1(): f64 { return this.lCenterY + this.lHeight / 2; }

	// Calculated properties using public props
	get yaw(): f64 { return (this.centerX - .5) * PI * 2 }
	get pitch() : f64 { return (this.centerY - .5) * PI }
	get aspect() : f64 { return this.width / this.height }
	get size() : f64 { return pyth(this.width, this.height) / pyth(1,1) }

	// Update setCenter to modify public props
	set(centerX: f64, centerY: f64, width: f64, height: f64, preserveAspect: bool = false): void {
		if (preserveAspect) {
			const cAr = min(1, this.width) / min(1, this.height);
			if (width / height > cAr * 1.5 && width < this.width) {
				height = width / cAr;
			}
		}

		const os = this.correct ? this.tnOffset : 0;
		this.centerX = centerX + os;
		this.centerY = centerY;
		this.width = width;
		this.height = height;

		this.toArray();
		this.changed = true;
	}

	/** Sets the relative View area of a MicrioImage to render to, animates by default. Used in grids. */
	setArea(x0: f64, y0: f64, x1: f64, y1: f64) : void {
		this.centerX = (x0 + x1) / 2;
		this.centerY = (y0 + y1) / 2;
		this.width = x1 - x0;
		this.height = y1 - y0;
		this.toArray();
	}

	// Update setLimit to set public limit props
	setLimit(lCenterX: f64, lCenterY: f64, lWidth: f64, lHeight: f64) : void {
		this.lCenterX = lCenterX;
		this.lCenterY = lCenterY;
		this.lWidth = lWidth;
		this.lHeight = lHeight;

		this.changed = true;
		this.limitChanged = true;
	}

	// Update copy to copy public props
	copy(v:View) : void {
		this.centerX = v.centerX;
		this.centerY = v.centerY;
		this.width = v.width;
		this.height = v.height;
		this.lCenterX = v.lCenterX;
		this.lCenterY = v.lCenterY;
		this.lWidth = v.lWidth;
		this.lHeight = v.lHeight;
		this.changed = true;
		this.toArray();
	}

	/** Calculates the perspective value needed to achieve this view height in 360 mode. */
	getPerspective(): f64 {
		const c = this.canvas;
		const webgl = c.webgl;
		// Reverse calculation based on how perspective affects view height
		return webgl.maxPerspective - (.5 / (this.height * c.height / c.el.height)) * PI / webgl.scaleY
	}

	/** Calculates the effective scale factor represented by this view. */
	getScale(): f64 {
		const c = this.canvas;
		// Scale is determined by the dimension that is most 'zoomed in' relative to the viewport
		return 1 / max(
			this.width * c.width / c.el.width,  // Horizontal scale factor
			this.height * c.height / c.el.height // Vertical scale factor
		);
	}

	/** Calculates a distance metric between this view and another view, used for animation duration. */
	getDistance(v: View, correctAspect:bool): f64 {
		// Optional aspect ratio correction before distance calculation
		if(correctAspect && this.canvas.currentArea.isFull()) {
			v.correctAspectRatio();
			this.correctAspectRatio();
		}
		// Calculate differences in centers and sizes
		const dCenterX = abs(this.centerX - v.centerX);
		const dCenterY = abs(this.centerY - v.centerY);
		const dWidth = abs(this.width - v.width);
		const dHeight = abs(this.height - v.height);
		// Simple average distance
		return (dCenterX + dCenterY + dWidth + dHeight) / 4;
	}

	// Update limit to use public limit props
	limit(correctZoom:bool, noLimit:bool = false, freeMove:bool = false): void {
		const c = this.canvas;
		const mS = c.camera.minSize;
		const s = this.getScale();

		// Underzoom handling using public width/height
		if(mS < 1 && s < c.camera.minScale && !noLimit) {
			const mWH = 1 / mS;
			const nW = min(mWH, this.width);
			const nH = min(mWH, this.height);
			this.centerX = 0.5;
			this.centerY = 0.5;
			this.width = nW;
			this.height = nH;
			this.toArray();
			return;
		}

		// Limit Scale
		const overZoom:f64 = correctZoom ? max(1, s / max(c.camera.minScale, c.maxScale / c.el.scale)) : 1;
		const maxVw:f64 = this.lWidth;
		const maxVh:f64 = this.lHeight;
		let vw:f64 = min(maxVw, this.width * overZoom);
		let vh:f64 = min(maxVh, this.height * overZoom);

		if(correctZoom && (overZoom > 1 || (noLimit && s < c.camera.minScale))) {
			vw = min(maxVw, vw / overZoom);
			vh = min(maxVh, vh / overZoom);
			this.width = vw;
			this.height = vh;
		}

		if(noLimit) return;

		// Limit Boundaries
		const halfW = min(1, this.width) / 2;
		const lHalfW = this.lWidth / 2;
		if (this.canvas.is360) {
			this.centerX = mod1(this.centerX);
		} else if (!freeMove) {
			this.centerX = max(this.lCenterX - lHalfW + halfW, min(this.centerX, this.lCenterX + lHalfW - halfW));
		}

		const halfH = min(1, this.height) / 2;
		const lHalfH = this.lHeight / 2;
		if (!freeMove) {
			this.centerY = max(this.lCenterY - lHalfH + halfH, min(this.centerY, this.lCenterY + lHalfH - halfH));
		}

		this.toArray();
	}

	// Update correctAspectRatio to use public props
	correctAspectRatio(): void {
		const c = this.canvas;
		if(c.is360) return;
		const s = this.getScale();
		const targetAspect = c.camera.cpw / c.camera.cph;
		const currentAspect = this.width / this.height;
		if (currentAspect > targetAspect) {
			this.height = this.width / targetAspect;
		} else {
			this.width = this.height * targetAspect;
		}
		this.toArray();
	}

	/** Updates the shared Float64Array with the computed legacy view coordinates. */
	toArray(): Float64Array {
		unchecked(this.arr[0] = this.centerX);
		unchecked(this.arr[1] = this.centerY);
		unchecked(this.arr[2] = this.width);
		unchecked(this.arr[3] = this.height);
		return this.arr;
	}

	/** Checks if this view is equal to another view. */
	equal(v:View) : bool {
		return this.centerX == v.centerX
			&& this.centerY == v.centerY
			&& this.width == v.width
			&& this.height == v.height;
	}

	/** Checks if this view represents the full image [0,0,1,1]. */
	isFull() : bool {
		return this.width == 1 && this.height == 1 && this.centerX == 0.5 && this.centerY == 0.5;
	}
}

/** Represents coordinates, either relative image coordinates or screen pixel coordinates. */
export class Coordinates {
	/** Float64Array view for efficient JS access [x, y, scale, w/depth, direction]. */
	readonly arr : Float64Array = new Float64Array(5); // Increased size to 5

	constructor(
		public x: f64 = .5,       // X coordinate (relative image or screen pixel)
		public y: f64 = .5,       // Y coordinate (relative image or screen pixel)
		public scale: f64 = 1,    // Scale factor (image scale or screen scale)
		public w: f64 = 0,        // Depth component (used in 360/Omni calculations)
		public direction: f64 = 0 // Direction component (used in 360 calculations)
	) {}

	/** Checks if the screen coordinate is potentially within the viewport bounds. */
	inView(v:Viewport): bool {
		// Check depth first (w < -1 likely means behind camera)
		// Then check if within screen bounds (w < 3 might be a heuristic for near-clipping)
		return this.w < -1 || (this.w < 3 && !(this.x < 0 || this.x > v.width || this.y < 0 || this.y > v.height));
	}

	/** Updates the shared Float64Array with the current coordinate values. */
	toArray(): Float64Array {
		unchecked(this.arr[0] = this.x);
		unchecked(this.arr[1] = this.y);
		unchecked(this.arr[2] = this.scale);
		unchecked(this.arr[3] = this.w);
		unchecked(this.arr[4] = this.direction); // Added direction
		return this.arr;
	}
}

/** Represents the screen viewport of a Canvas element. */
export class Viewport {
	/** Int32Array view for efficient JS access [width, height, left, top]. */
	readonly arr : Int32Array = new Int32Array(4);

	constructor(
		public width: f64 = 0,      // Width in screen pixels (scaled by ratio)
		public height: f64 = 0,     // Height in screen pixels (scaled by ratio)
		public left: f64 = 0,       // Left offset in screen pixels (scaled by ratio)
		public top: f64 = 0,        // Top offset in screen pixels (scaled by ratio)
		public areaWidth: f64 = 0,  // Width constraint for partial rendering (pixels)
		public areaHeight: f64 = 0, // Height constraint for partial rendering (pixels)
		public ratio: f64 = 1,      // Device pixel ratio
		public scale: f64 = 1,      // Global scale factor (usually 1)
		public isPortrait: bool = false // Is the viewport orientation portrait?
	) {}

	// --- Calculated Properties ---
	/** Center X coordinate in screen pixels. */
	get centerX(): f64 { return this.left + this.width/2 }
	/** Center Y coordinate in screen pixels. */
	get centerY(): f64 { return this.top + this.height/2 }
	/** Aspect ratio of the viewport (width / height). */
	get aspect(): f64 { return this.width == 0 ? 1 : this.height == 0 ? 1 : this.width / this.height } // Avoid division by zero

	/** Updates the shared Int32Array with the current viewport dimensions (integer pixels). */
	toArray(): Int32Array {
		unchecked(this.arr[0] = <i32>this.width);
		unchecked(this.arr[1] = <i32>this.height);
		unchecked(this.arr[2] = <i32>this.left);
		unchecked(this.arr[3] = <i32>this.top);
		return this.arr;
	}

	/**
	 * Sets the viewport properties, scaling by device pixel ratio.
	 * @returns True if any property changed, false otherwise.
	 */
	set(w: f64, h: f64, l: f64, t: f64, r: f64, s: f64, p: bool) : bool {
		// Check if any value has actually changed
		if(this.width == w*r && this.height == h*r && this.left == l && this.top == t &&
			this.ratio == r && this.scale == s && this.isPortrait == p) return false;
		// Update properties, applying device pixel ratio
		this.width = w*r;
		this.height = h*r;
		this.left = l*r;
		this.top = t*r;
		this.ratio = r;
		this.scale = s;
		this.isPortrait = p;
		return true; // Indicate that values changed
	}

	/** Copies properties from another Viewport object. */
	copy(v:Viewport) : void {
		this.set(v.width, v.height, v.left, v.top, v.ratio, v.scale, v.isPortrait);
	}
}
