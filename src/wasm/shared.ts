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
	/** Float64Array view of the legacy coordinates [x0, y0, x1, y1] for compatibility. */
	readonly arr : Float64Array = new Float64Array(4);
	/** Flag indicating if true north correction should be applied during set(). */
	public correct : bool = false;
	/** Flag indicating if the view coordinates have changed since the last frame. */
	public changed : bool = false;
	/** Flag indicating if the view limits have changed. */
	public limitChanged : bool = false;
	/** Cached true north offset (0.5 - trueNorth setting). */
	public tnOffset:number = 0;

	// New primary storage
	private _centerX: f64 = 0.5;
	private _centerY: f64 = 0.5;
	private _width: f64 = 1;
	private _height: f64 = 1;

	// Navigation limits remain in legacy format for now
	public lX0: f64 = 0;
	public lY0: f64 = 0;
	public lX1: f64 = 1;
	public lY1: f64 = 1;

	constructor(
		private readonly canvas: Canvas, // Reference to the parent Canvas

		// Accept legacy coordinates and convert
		x0: f64 = 0,
		y0: f64 = 0,
		x1: f64 = 1,
		y1: f64 = 1,

		// Limits
		lX0: f64 = 0,
		lY0: f64 = 0,
		lX1: f64 = 1,
		lY1: f64 = 1,
	) {
		// Pre-calculate true north offset
		this.tnOffset = .5 - canvas.trueNorth;

		// Set initial values using legacy setter logic
		this.set(x0, y0, x1, y1);
		this.setLimit(lX0, lY0, lX1, lY1);
	}

	// --- Legacy Getters (computed) ---
	get x0(): f64 { 
		let cx = this._centerX;
		if (this.canvas.is360) cx = mod1(cx);
		return mod1(cx - this._width / 2); 
	}
	get y0(): f64 { return this._centerY - this._height / 2; }
	get x1(): f64 { 
		let cx = this._centerX;
		if (this.canvas.is360) cx = mod1(cx);
		return mod1(cx + this._width / 2); 
	}
	get y1(): f64 { return this._centerY + this._height / 2; }

	// --- Calculated Properties ---
	/** Calculated width of the view, handling 360 wrap-around. */
	get width(): f64 { return this._width; }
	/** Calculated height of the view. */
	get height(): f64 { return this._height; }
	/** Calculated center X coordinate. */
	get centerX(): f64 { return this.canvas.is360 ? mod1(this._centerX) : this._centerX; }
	/** Calculated center Y coordinate. */
	get centerY(): f64 { return this._centerY; }
	/** Calculated yaw (horizontal angle) in radians for 360 view. */
	get yaw(): f64 { return (this.centerX - .5) * PI * 2 }
	/** Calculated pitch (vertical angle) in radians for 360 view. */
	get pitch() : f64 { return (this.centerY - .5) * PI }
	/** Calculated aspect ratio of the view. */
	get aspect() : f64 { return this.width / this.height }
	/** Calculated diagonal size of the view relative to a unit square. */
	get size() : f64 { return pyth(this.width,this.height) / pyth(1,1) }

	/** Sets the view using legacy coordinates, converting to new model. */
	set(x0:f64, y0:f64, x1:f64, y1:f64, preserveAspect: bool = false) : void {
		let w = x1 - x0;
		let h = y1 - y0;
		let cx = x0 + w / 2;
		let cy = y0 + h / 2;

		if(preserveAspect) {
			const cAr = min(1, this.width) / min(1, this.height); // Current aspect ratio
			// Adjust height if width is limiting and aspect ratio differs significantly
			if(w / h > cAr * 1.5 && w < this.width) { h = w * cAr; cy = y0 + h/2; } // Adjusted to use y0 + h/2
		}

		// Apply true north offset if correction is enabled
		const os = this.correct ? this.tnOffset : 0;
		cx += os;

		// Set new properties
		this._centerX = cx;
		this._centerY = cy;
		this._width = w;
		this._height = h;

		// Update the shared array and mark as changed
		this.toArray();
		this.changed = true;
	}

	/** Sets the view using the new center-based model. */
	setCenter(centerX: f64, centerY: f64, width: f64, height: f64, preserveAspect: bool = false): void {
		if (preserveAspect) {
			// Similar logic as above, adapted for centers
			const cAr = min(1, this.width) / min(1, this.height);
			if (width / height > cAr * 1.5 && width < this.width) {
				height = width / cAr; // Adjust height to match aspect
			}
		}

		const os = this.correct ? this.tnOffset : 0;
		this._centerX = centerX + os;
		this._centerY = centerY;
		this._width = width;
		this._height = height;

		this.toArray();
		this.changed = true;
	}

	/** Sets the navigation limit boundaries (legacy format). */
	setLimit(x0: f64, y0: f64, x1: f64, y1: f64) : void {
		this.lX0 = x0;
		this.lY0 = y0;
		this.lX1 = x1;
		this.lY1 = y1;
		this.changed = true; // Mark view as potentially changed due to limits
		this.limitChanged = true; // Mark limits as changed
	}

	/** Copies coordinates from another View object. */
	copy(v:View) : void {
		this._centerX = v._centerX;
		this._centerY = v._centerY;
		this._width = v._width;
		this._height = v._height;
		this.lX0 = v.lX0;
		this.lY0 = v.lY0;
		this.lX1 = v.lX1;
		this.lY1 = v.lY1;
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

	/** Applies navigation limits to the view coordinates. */
	limit(correctZoom:bool, noLimit:bool = false, freeMove:bool = false): void {
		const c = this.canvas;
		const mS = c.camera.minSize; // Minimum screen size factor
		const s = this.getScale(); // Current effective scale

		// --- Handle Underzoom ---
		// If underzoomed (below minScale * minSize) and not explicitly allowed, center the view
		if(mS < 1 && s < c.camera.minScale && !noLimit) {
			const mWH = 1 / mS; // Maximum relative size when underzoomed
			const nW = min(mWH, this.width); // New width, clamped by max size
			const nH = min(mWH, this.height); // New height, clamped by max size
			// Center the view
			this._centerX = 0.5;
			this._centerY = 0.5;
			this._width = nW;
			this._height = nH;
			this.toArray();
			return; // Exit after centering
		}

		// --- Limit Scale ---
		// Calculate potential overzoom factor relative to max allowed scale
		const overZoom:f64 = correctZoom ? max(1, s / max(c.camera.minScale, c.maxScale / c.el.scale)) : 1;
		// Calculate maximum allowed view width/height based on limits and overzoom
		const maxVw:f64 = this.lX1 - this.lX0;
		const maxVh:f64 = this.lY1 - this.lY0;
		let vw:f64 = min(maxVw, this.width * overZoom);
		let vh:f64 = min(maxVh, this.height * overZoom);

		// If zoom needs correction (over max scale or under min scale without noLimit)
		if(correctZoom && (overZoom > 1 || (noLimit && s < c.camera.minScale))) {
			// Clamp width and height
			vw = min(maxVw, vw / overZoom); // Adjust back if overzoomed
			vh = min(maxVh, vh / overZoom);
			this._width = vw;
			this._height = vh;
		}

		// Exit if boundary limits should not be applied
		if(noLimit) return;

		// --- Limit Boundaries using centers ---
		// For X (horizontal, with 360 wrap)
		const lCenterX = (this.lX0 + this.lX1) / 2;
		const lWidth = this.lX1 - this.lX0;
		const halfW = this._width / 2;
		if (this.canvas.is360) {
			this._centerX = mod1(this._centerX);
		} else if (!freeMove) {
			this._centerX = max(this.lX0 + halfW, min(this._centerX, this.lX1 - halfW));
		}

		// For Y (vertical, no wrap)
		const halfH = this._height / 2;
		if (!freeMove) {
			this._centerY = max(this.lY0 + halfH, min(this._centerY, this.lY1 - halfH));
		}

		this.toArray();
	}

	/** Adjusts the view rectangle to match the canvas aspect ratio, preventing stretching. */
	correctAspectRatio(): void {
		const c = this.canvas;
		if(c.is360) return; // Not applicable for 360
		const s = this.getScale();
		// Calculate target aspect
		const targetAspect = c.camera.cpw / c.camera.cph; // Assuming cpw and cph are canvas proportions
		const currentAspect = this.width / this.height;
		if (currentAspect > targetAspect) {
			// Too wide, increase height
			this._height = this.width / targetAspect;
		} else {
			// Too tall, increase width
			this._width = this.height * targetAspect;
		}
		this.toArray();
	}

	/** Updates the shared Float64Array with the computed legacy view coordinates. */
	toArray(): Float64Array {
		unchecked(this.arr[0] = this.x0);
		unchecked(this.arr[1] = this.y0);
		unchecked(this.arr[2] = this.x1);
		unchecked(this.arr[3] = this.y1);
		return this.arr;
	}

	/** Returns a Float64Array of the legacy [x0, y0, x1, y1]. */
	toLegacy(): Float64Array {
		const arr = new Float64Array(4);
		unchecked(arr[0] = this.x0);
		unchecked(arr[1] = this.y0);
		unchecked(arr[2] = this.x1);
		unchecked(arr[3] = this.y1);
		return arr;
	}

	/** Checks if this view is equal to another view. */
	equal(v:View) : bool {
		return this._centerX == v._centerX
			&& this._centerY == v._centerY
			&& this._width == v._width
			&& this._height == v._height;
	}

	/** Checks if this view represents the full image [0,0,1,1]. */
	isFull() : bool {
		return this._width == 1 && this._height == 1 && this.centerX == 0.5 && this.centerY == 0.5;
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
