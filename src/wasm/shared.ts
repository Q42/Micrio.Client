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
	/** Float64Array view of the coordinates [x0, y0, x1, y1] for efficient JS access. */
	readonly arr : Float64Array = new Float64Array(4);
	/** Flag indicating if true north correction should be applied during set(). */
	public correct : bool = false;
	/** Flag indicating if the view coordinates have changed since the last frame. */
	public changed : bool = false;
	/** Flag indicating if the view limits have changed. */
	public limitChanged : bool = false;
	/** Cached center X coordinate (especially for 360 wrap-around). */
	private _cX360:number = 0.5;
	/** Cached center Y coordinate. */
	private _cY360:number = 0.5;
	/** Cached true north offset (0.5 - trueNorth setting). */
	public tnOffset:number = 0;

	constructor(
		private readonly canvas: Canvas, // Reference to the parent Canvas

		// --- Logical View Coordinates (relative to image, 0-1) ---
		public x0: f64 = 0,
		public y0: f64 = 0,
		public x1: f64 = 1,
		public y1: f64 = 1,

		// --- Navigation Limit Coordinates (relative to image, 0-1) ---
		public lX0: f64 = 0,
		public lY0: f64 = 0,
		public lX1: f64 = 1,
		public lY1: f64 = 1,
	) {
		// Pre-calculate true north offset
		this.tnOffset = .5-canvas.trueNorth;
	}

	// --- Calculated Properties ---
	/** Calculated width of the view, handling 360 wrap-around. */
	get width(): f64 { return this.x0 > this.x1 ? (1.0 - this.x0) + this.x1 : this.x1-this.x0 } // Handle wrap around
	/** Calculated height of the view. */
	get height(): f64 { return this.y1-this.y0 }
	/** Calculated center X coordinate. */
	get centerX(): f64 { return this.canvas.is360 ? this._cX360 : this.x0 + this.width/2 }
	/** Calculated center Y coordinate. */
	get centerY(): f64 { return this.canvas.is360 ? this._cY360 : this.y0 + this.height/2 }
	/** Calculated yaw (horizontal angle) in radians for 360 view. */
	get yaw(): f64 { return (this.centerX - .5) * PI * 2 }
	/** Calculated pitch (vertical angle) in radians for 360 view. */
	get pitch() : f64 { return (this.centerY - .5) * PI }
	/** Calculated aspect ratio of the view. */
	get aspect() : f64 { return this.width / this.height }
	/** Calculated diagonal size of the view relative to a unit square. */
	get size() : f64 { return pyth(this.width,this.height) / pyth(1,1) }

	/** Sets the view coordinates, optionally applying true north correction and preserving aspect ratio. */
	set(x0:f64, y0:f64, x1:f64, y1:f64, preserveAspect: bool = false) : void {
		// Optional aspect ratio preservation (seems complex and potentially unused)
		if(preserveAspect) {
			const w = x1 - x0;
			let h = y1 - y0;
			const cY = y0 + h / 2;
			const cAr = min(1, this.width) / min(1, this.height); // Current aspect ratio
			// Adjust height if width is limiting and aspect ratio differs significantly
			if(w / h > cAr * 1.5 && w < this.width) { h = w * cAr; y0 = cY - h/2; y1 = cY + h/2 }
		}

		// Apply true north offset if correction is enabled
		const os = this.correct ? this.tnOffset : 0;

		// Set coordinates
		this.x0 = x0 + os;
		this.y0 = y0;
		this.x1 = x1 + os;
		this.y1 = y1;
		// Update cached center coordinates
		this._cX360 = this.x0 + this.width/2;
		this._cY360 = this.y0 + this.height/2;

		// Update the shared array and mark as changed
		this.toArray();
		this.changed = true;
	}

	/** Sets the navigation limit boundaries. */
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
		this.set(v.x0, v.y0, v.x1, v.y1);
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
		// Calculate average absolute difference between corresponding corners
		const dx0 = abs(min(v.x0,v.x1) - min(this.x0,this.x1)), dy0 = abs(v.y0 - this.y0),
			dx1 = abs(max(v.x0,v.x1) - max(this.x0,this.x1)), dy1 = abs(v.y1 - this.y1);
		// Normalize by difference in diagonal size to make distance less sensitive to pure zoom changes
		return (dx0+dy0+dx1+dy1)/4 / (1 + abs(this.size-v.size));
	}

	/** Updates the view coordinates based on the current 360 camera state (yaw, pitch, perspective). */
	from360(): void {
		const c = this.canvas;
		const webgl = c.webgl;
		// Calculate view height based on perspective and vertical scaling
		const height:f64 = webgl.perspective / PI / webgl.scaleY;
		// Calculate view width based on height and aspect ratios
		const width:f64 = height * (c.el.width == 0 ? 1 : .5 * sqrt(c.el.aspect)) / (c.aspect/2);

		// Calculate center coordinates based on yaw/pitch and true north offset
		this._cX360 = mod1(webgl.yaw / (PI * 2) - c.trueNorth); // Center X (longitude)
		this._cY360 = (webgl.pitch/webgl.scaleY) % (PI * 2) / PI + .5; // Center Y (latitude)
		// Calculate view boundaries based on center and width/height
		this.x0 = mod1(this._cX360 - width / 2);
		this.y0 = this._cY360 - height / 2;
		this.x1 = mod1(this._cX360 + width / 2);
		this.y1 = this._cY360 + height / 2;

		// Handle horizontal wrap-around
		if(this.x0 > this.x1) this.x1++;

		this.changed = true; // Mark view as changed
	}

	/** Applies navigation limits to the view coordinates. */
	limit(correctZoom:bool, noLimit:bool = false): void {
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
			this.x1 = (this.x0 = .5 - nW/2) + nW;
			this.y1 = (this.y0 = .5 - nH/2) + nH;
			return; // Exit after centering
		}

		// --- Limit Scale ---
		// Calculate potential overzoom factor relative to max allowed scale
		const overZoom:f64 = correctZoom ? max(1, s / max(c.camera.minScale, c.maxScale / c.el.scale)) : 1;
		// Calculate maximum allowed view width/height based on limits and overzoom
		const vw:f64 = min(this.lX1-this.lX0, this.width * overZoom);
		const vh:f64 = min(this.lY1-this.lY0, this.height * overZoom);

		// If zoom needs correction (over max scale or under min scale without noLimit)
		if(correctZoom && (overZoom > 1 || (noLimit && s < c.camera.minScale))) {
			// Recalculate view boundaries based on clamped width/height centered around current center
			const cX:f64 = this.centerX;
			this.x0 = cX-vw/2;
			this.x1 = cX+vw/2;

			const cY:f64 = this.centerY;
			this.y0 = cY-vh/2;
			this.y1 = cY+vh/2;
		}

		// Exit if boundary limits should not be applied
		if(noLimit) return;

		// --- Limit Boundaries ---
		// Adjust view position to stay within horizontal limits (lX0, lX1)
		if(this.x0<this.lX0) { // Past left limit
			this.x0=this.lX0;
			this.x1=this.x0+vw;
		}
		else if(this.x1>this.lX1) { // Past right limit
			this.x1=this.lX1;
			this.x0=this.x1-vw;
		}

		// Adjust view position to stay within vertical limits (lY0, lY1)
		if(this.y0<this.lY0) { // Past top limit
			this.y0=this.lY0;
			this.y1=this.y0+vh;
		}
		else if(this.y1>this.lY1) { // Past bottom limit
			this.y1=this.lY1;
			this.y0=this.y1-vh;
		}
	}

	/** Adjusts the view rectangle to match the canvas aspect ratio, preventing stretching. */
	correctAspectRatio(): void {
		const c = this.canvas;
		if(c.is360) return; // Not applicable for 360
		const s = this.getScale();
		// Calculate overflow needed based on canvas/view aspect ratio difference
		const overflowX:f64 = (c.camera.cpw / s - this.width) / 2;
		const overflowY:f64 = (c.camera.cph / s - this.height) / 2;

		// Apply overflow to center the view within the aspect ratio
		this.x0 -= overflowX;
		this.y0 -= overflowY;
		this.x1 += overflowX;
		this.y1 += overflowY;
	}

	/** Updates the shared Float64Array with the current view coordinates. */
	toArray(): Float64Array {
		unchecked(this.arr[0] = this.x0);
		unchecked(this.arr[1] = this.y0);
		unchecked(this.arr[2] = this.x1);
		unchecked(this.arr[3] = this.y1);
		return this.arr;
	}

	/** Checks if this view is equal to another view. */
	equal(v:View) : bool {
		return this.x0 == v.x0
			&& this.x1 == v.x1
			&& this.y0 == v.y0
			&& this.y1 == v.y1
	}

	/** Checks if this view represents the full image [0,0,1,1]. */
	isFull() : bool {
		return this.x0 == 0 && this.y0 == 0 && this.x1 == 1 && this.y1 == 1;
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
