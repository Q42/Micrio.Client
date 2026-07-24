/**
 * Shared data structures for the Micrio engine: View, Coordinates, Viewport, DrawRect.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import type { TileCanvas } from './tile-canvas';
import type { default as Image } from './tile-image';
import { mod1 } from '$utils/math';

/** Structure to hold information about a specific tile to be drawn. @internal */
export class DrawRect {
	/** Reference to the Image instance this tile belongs to. */
	image!: Image;

	constructor(
		/** Left edge of the tile in relative image coordinates (0-1). */
		public x0: number = 0,
		/** Top edge of the tile in relative image coordinates (0-1). */
		public y0: number = 0,
		/** Right edge of the tile in relative image coordinates (0-1). */
		public x1: number = 0,
		/** Bottom edge of the tile in relative image coordinates (0-1). */
		public y1: number = 0,
		/** Index of the resolution layer this tile belongs to. */
		public layer: number = 0,
		/** Column index of the tile within its layer. */
		public x: number = 0,
		/** Row index of the tile within its layer. */
		public y: number = 0
	) {}
}

/** Represents the logical view rectangle within an image. @internal */
export class View {
	#arr: Float64Array = new Float64Array([0.5, 0.5, 1, 1]);
	#dirty: boolean = false;
	/** Flag indicating if the view coordinates have changed since the last frame. */
	_changed: boolean = false;
	/** Flag indicating if the view limits have changed. */
	_limitChanged: boolean = false;

	readonly #canvas: TileCanvas;

	constructor(
		canvas: TileCanvas,

		public _centerX: number = 0.5,
		public _centerY: number = 0.5,
		public width: number = 1,
		public height: number = 1,

		public _lCenterX: number = 0.5,
		public _lCenterY: number = 0.5,
		public _lWidth: number = 1,
		public _lHeight: number = 1,
	) {
		this.#canvas = canvas;
	}

	/** Float64Array view of [centerX, centerY, width, height]. */
	/** @internal */
	get arr(): Float64Array {
		if (this.#dirty) {
			this.#arr[0] = this._centerX;
			this.#arr[1] = this._centerY;
			this.#arr[2] = this.width;
			this.#arr[3] = this.height;
			this.#dirty = false;
		}
		return this.#arr;
	}

	/** Left edge of the view rectangle in image coordinates. */
	get x0(): number {
		let cx = this._centerX;
		if (this.#canvas.is360) cx = mod1(cx);
		return this.#canvas.is360 ? mod1(cx - this.width / 2) : (cx - this.width / 2);
	}
	/** Top edge of the view rectangle in image coordinates. */
	get y0(): number { return this._centerY - this.height / 2; }
	/** Right edge of the view rectangle in image coordinates. */
	get x1(): number {
		let cx = this._centerX;
		if (this.#canvas.is360) cx = mod1(cx);
		return this.#canvas.is360 ? mod1(cx + this.width / 2) : (cx + this.width / 2);
	}
	/** Bottom edge of the view rectangle in image coordinates. */
	get y1(): number { return this._centerY + this.height / 2; }

	/** Left edge of the view limit boundary. */
	get lX0(): number { return this._lCenterX - this._lWidth / 2; }
	/** Top edge of the view limit boundary. */
	get lY0(): number { return this._lCenterY - this._lHeight / 2; }
	/** Right edge of the view limit boundary. */
	get lX1(): number { return this._lCenterX + this._lWidth / 2; }
	/** Bottom edge of the view limit boundary. */
	get lY1(): number { return this._lCenterY + this._lHeight / 2; }

	/** Aspect ratio (width / height) of the view rectangle. */
	get aspect(): number { return this.width / this.height }

	/**
	 * Sets the view rectangle center and dimensions.
	 * @param preserveAspect If true, adjusts dimensions to maintain aspect ratio.
	 */
	set(centerX: number, centerY: number, width: number, height: number, preserveAspect: boolean = false): void {
		if (preserveAspect) {
			const cAr = Math.min(1, this.width) / Math.min(1, this.height);
			if (width / height > cAr * 1.5 && width < this.width) {
				height = width / cAr;
			}
		}

		this._centerX = centerX;
		this._centerY = centerY;
		this.width = width;
		this.height = height;

		this.#dirty = true;
		this._changed = true;
	}

	/** Sets the relative View area of a MicrioImage to render to, animates by default. Used in grids. */
	_setArea(x0: number, y0: number, x1: number, y1: number): void {
		this._centerX = (x0 + x1) / 2;
		this._centerY = (y0 + y1) / 2;
		this.width = x1 - x0;
		this.height = y1 - y0;
		this.#dirty = true;
	}

	_setLimit(lCenterX: number, lCenterY: number, lWidth: number, lHeight: number): void {
		this._lCenterX = lCenterX;
		this._lCenterY = lCenterY;
		this._lWidth = lWidth;
		this._lHeight = lHeight;

		this._changed = true;
		this._limitChanged = true;
	}

	_copy(v: View, excludeLimit: boolean = false): void {
		this._centerX = v._centerX;
		this._centerY = v._centerY;
		this.width = v.width;
		this.height = v.height;
		if (!excludeLimit) {
			this._lCenterX = v._lCenterX;
			this._lCenterY = v._lCenterY;
			this._lWidth = v._lWidth;
			this._lHeight = v._lHeight;
		}
		this._changed = true;
		this.#dirty = true;
	}

	/** Calculates the effective scale factor represented by this view. */
	#getScale(): number {
		const c = this.#canvas;
		return 1 / Math.max(
			this.width * c.width / c.el.width,
			this.height * c.height / c.el.height
		);
	}

	_limit(correctZoom: boolean, noLimit: boolean = false, freeMove: boolean = false): void {
		const c = this.#canvas;
		const mS = c._camera2d._minSize;
		const s = this.#getScale();

		if (mS < 1 && s < c._camera2d._minScale && !noLimit) {
			const mWH = 1 / mS;
			const nW = Math.min(mWH, this.width);
			const nH = Math.min(mWH, this.height);
			this._centerX = 0.5;
			this._centerY = 0.5;
			this.width = nW;
			this.height = nH;
			this.#dirty = true;
			return;
		}

		const overZoom: number = correctZoom ? Math.max(1, s / Math.max(c._camera2d._minScale, c.maxScale / c.el.scale)) : 1;
		const maxVw: number = this._lWidth;
		const maxVh: number = this._lHeight;
		const vw: number = Math.min(maxVw, this.width * overZoom);
		const vh: number = Math.min(maxVh, this.height * overZoom);

		if (correctZoom && (overZoom > 1 || (noLimit && s < c._camera2d._minScale))) {
			this.width = vw;
			this.height = vh;
		}

		if (maxVw < 1 || maxVh < 1) {
			this.width = Math.min(this.width, maxVw);
			this.height = Math.min(this.height, maxVh);
		}

		if (noLimit) {
			this.#dirty = true;
			return;
		}

		const halfW = Math.min(1, this.width) / 2;
		const lHalfW = this._lWidth / 2;

		if (this.#canvas.is360) {
			this._centerX = mod1(this._centerX);
		} else if (!freeMove) {
			this._centerX = Math.max(this._lCenterX - lHalfW + halfW, Math.min(this._centerX, this._lCenterX + lHalfW - halfW));
		}

		const halfH = Math.min(1, this.height) / 2;
		const lHalfH = this._lHeight / 2;
		if (!freeMove) {
			this._centerY = Math.max(this._lCenterY - lHalfH + halfH, Math.min(this._centerY, this._lCenterY + lHalfH - halfH));
		}

		this.#dirty = true;
	}

	_correctAspectRatio(): void {
		const c = this.#canvas;
		if (c.is360) return;
		const targetAspect = c._camera2d.cpw / c._camera2d.cph;
		const currentAspect = this.width / this.height;
		if (currentAspect > targetAspect) {
			this.height = this.width / targetAspect;
		} else {
			this.width = this.height * targetAspect;
		}
		this.#dirty = true;
	}

}

/** Represents coordinates: relative image coordinates or screen pixel coordinates. @internal */
export class Coordinates {
	/** Float64Array view for efficient JS access [x, y, scale, w/depth, direction]. */
	readonly arr: Float64Array = new Float64Array(5);

	constructor(
		public x: number = .5,
		public y: number = .5,
		public scale: number = 1,
		public w: number = 0,
		public direction: number = 0
	) {}

	/** Checks if the screen coordinate is potentially within the viewport bounds. */
	_inView(v: Viewport): boolean {
		return this.w < -1 || (this.w < 3 && !(this.x < 0 || this.x > v.width || this.y < 0 || this.y > v.height));
	}

	/** Updates the shared Float64Array with the current coordinate values. */
	_toArray(): Float64Array {
		this.arr[0] = this.x;
		this.arr[1] = this.y;
		this.arr[2] = this.scale;
		this.arr[3] = this.w;
		this.arr[4] = this.direction;
		return this.arr;
	}
}

/** Represents the screen viewport of a TileCanvas element. @internal */
export class Viewport {
	/** Int32Array view for efficient JS access [width, height, left, top]. */
	readonly arr: Int32Array = new Int32Array(4);

	constructor(
		public width: number = 0,
		public height: number = 0,
		public left: number = 0,
		public top: number = 0,
		public _areaWidth: number = 0,
		public _areaHeight: number = 0,
		public ratio: number = 1,
		public scale: number = 1,
		public _isPortrait: boolean = false
	) {}

	get _aspect(): number { return this.width === 0 ? 1 : this.height === 0 ? 1 : this.width / this.height }

	/**
	 * Sets the viewport properties, scaling by device pixel ratio.
	 * @returns True if any property changed, false otherwise.
	 */
	set(w: number, h: number, l: number, t: number, r: number, s: number, p: boolean): boolean {
		if (this.width === w * r && this.height === h * r && this.left === l && this.top === t &&
			this.ratio === r && this.scale === s && this._isPortrait === p) return false;
		this.width = w * r;
		this.height = h * r;
		this.left = l * r;
		this.top = t * r;
		this.ratio = r;
		this.scale = s;
		this._isPortrait = p;
		return true;
	}

	/** Copies properties from another Viewport object. */
	_copy(v: Viewport): void {
		this.width = v.width;
		this.height = v.height;
		this.left = v.left;
		this.top = v.top;
		this.ratio = v.ratio;
		this.scale = v.scale;
		this._isPortrait = v._isPortrait;
	}
}
