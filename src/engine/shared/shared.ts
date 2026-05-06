/**
 * Shared data structures for the Micrio engine: View, Coordinates, Viewport, DrawRect.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import type { default as TileCanvas } from '../canvas/canvas';
import type { default as Image } from '../canvas/image';
import { mod1 } from '../utils/utils';
import { PI } from '../globals';

/** Structure to hold information about a specific tile to be drawn. @internal */
export class DrawRect {
	/** Reference to the Image instance this tile belongs to. */
	public image!: Image;

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
	/** Float64Array view of [centerX, centerY, width, height] — for efficient JS access. */
	readonly arr: Float64Array = new Float64Array(4);
	/** Flag indicating if the view coordinates have changed since the last frame. */
	public changed: boolean = false;
	/** Flag indicating if the view limits have changed. */
	public limitChanged: boolean = false;

	constructor(
		private readonly canvas: TileCanvas,

		public centerX: number = 0.5,
		public centerY: number = 0.5,
		public width: number = 1,
		public height: number = 1,

		public lCenterX: number = 0.5,
		public lCenterY: number = 0.5,
		public lWidth: number = 1,
		public lHeight: number = 1,
	) {
		this.toArray();
	}

	// Left edge of the view (relative, 0-1), wrapping for 360.
	get x0(): number {
		let cx = this.centerX;
		if (this.canvas.is360) cx = mod1(cx);
		return this.canvas.is360 ? mod1(cx - this.width / 2) : (cx - this.width / 2);
	}
	// Top edge of the view.
	get y0(): number { return this.centerY - this.height / 2; }
	// Right edge of the view, wrapping for 360.
	get x1(): number {
		let cx = this.centerX;
		if (this.canvas.is360) cx = mod1(cx);
		return this.canvas.is360 ? mod1(cx + this.width / 2) : (cx + this.width / 2);
	}
	// Bottom edge of the view.
	get y1(): number { return this.centerY + this.height / 2; }

	// Limit box edges
	get lX0(): number { return this.lCenterX - this.lWidth / 2; }
	get lY0(): number { return this.lCenterY - this.lHeight / 2; }
	get lX1(): number { return this.lCenterX + this.lWidth / 2; }
	get lY1(): number { return this.lCenterY + this.lHeight / 2; }

	// Calculated 360 properties
	get yaw(): number { return (this.centerX - .5) * PI * 2 }
	get pitch(): number { return (this.centerY - .5) * PI }
	get aspect(): number { return this.width / this.height }
	get size(): number { return Math.sqrt(this.width * this.width + this.height * this.height) * (1 / Math.sqrt(2)) }

	set(centerX: number, centerY: number, width: number, height: number, preserveAspect: boolean = false): void {
		if (preserveAspect) {
			const cAr = Math.min(1, this.width) / Math.min(1, this.height);
			if (width / height > cAr * 1.5 && width < this.width) {
				height = width / cAr;
			}
		}

		this.centerX = centerX;
		this.centerY = centerY;
		this.width = width;
		this.height = height;

		this.toArray();
		this.changed = true;
	}

	/** Sets the relative View area of a MicrioImage to render to, animates by default. Used in grids. */
	setArea(x0: number, y0: number, x1: number, y1: number): void {
		this.centerX = (x0 + x1) / 2;
		this.centerY = (y0 + y1) / 2;
		this.width = x1 - x0;
		this.height = y1 - y0;
		this.toArray();
	}

	setLimit(lCenterX: number, lCenterY: number, lWidth: number, lHeight: number): void {
		this.lCenterX = lCenterX;
		this.lCenterY = lCenterY;
		this.lWidth = lWidth;
		this.lHeight = lHeight;

		this.changed = true;
		this.limitChanged = true;
	}

	copy(v: View, excludeLimit: boolean = false): void {
		this.centerX = v.centerX;
		this.centerY = v.centerY;
		this.width = v.width;
		this.height = v.height;
		if (!excludeLimit) {
			this.lCenterX = v.lCenterX;
			this.lCenterY = v.lCenterY;
			this.lWidth = v.lWidth;
			this.lHeight = v.lHeight;
		}
		this.changed = true;
		this.toArray();
	}

	/** Calculates the perspective value needed to achieve this view height in 360 mode. */
	getPerspective(): number {
		const c = this.canvas;
		const webgl = c.webgl;
		return webgl.maxPerspective - (.5 / (this.height * c.height / c.el.height)) * PI / webgl.scaleY
	}

	/** Calculates the effective scale factor represented by this view. */
	getScale(): number {
		const c = this.canvas;
		return 1 / Math.max(
			this.width * c.width / c.el.width,
			this.height * c.height / c.el.height
		);
	}

	/** Calculates a distance metric between this view and another view, used for animation duration. */
	getDistance(v: View, correctAspect: boolean): number {
		if (correctAspect && this.canvas.currentArea.isFull()) {
			v.correctAspectRatio();
			this.correctAspectRatio();
		}
		const dCenterX = Math.abs(this.centerX - v.centerX);
		const dCenterY = Math.abs(this.centerY - v.centerY);
		const dWidth = Math.abs(this.width - v.width);
		const dHeight = Math.abs(this.height - v.height);
		return (dCenterX + dCenterY + dWidth + dHeight) / 4;
	}

	limit(correctZoom: boolean, noLimit: boolean = false, freeMove: boolean = false): void {
		const c = this.canvas;
		const mS = c.camera.minSize;
		const s = this.getScale();

		if (mS < 1 && s < c.camera.minScale && !noLimit) {
			const mWH = 1 / mS;
			const nW = Math.min(mWH, this.width);
			const nH = Math.min(mWH, this.height);
			this.centerX = 0.5;
			this.centerY = 0.5;
			this.width = nW;
			this.height = nH;
			this.toArray();
			return;
		}

		const overZoom: number = correctZoom ? Math.max(1, s / Math.max(c.camera.minScale, c.maxScale / c.el.scale)) : 1;
		const maxVw: number = this.lWidth;
		const maxVh: number = this.lHeight;
		const vw: number = Math.min(maxVw, this.width * overZoom);
		const vh: number = Math.min(maxVh, this.height * overZoom);

		if (correctZoom && (overZoom > 1 || (noLimit && s < c.camera.minScale))) {
			this.width = vw;
			this.height = vh;
		}

		if (maxVw < 1 || maxVh < 1) {
			this.width = Math.min(this.width, maxVw);
			this.height = Math.min(this.height, maxVh);
		}

		if (noLimit) {
			this.toArray();
			return;
		}

		const halfW = Math.min(1, this.width) / 2;
		const lHalfW = this.lWidth / 2;

		if (this.canvas.is360) {
			this.centerX = mod1(this.centerX);
		} else if (!freeMove) {
			this.centerX = Math.max(this.lCenterX - lHalfW + halfW, Math.min(this.centerX, this.lCenterX + lHalfW - halfW));
		}

		const halfH = Math.min(1, this.height) / 2;
		const lHalfH = this.lHeight / 2;
		if (!freeMove) {
			this.centerY = Math.max(this.lCenterY - lHalfH + halfH, Math.min(this.centerY, this.lCenterY + lHalfH - halfH));
		}

		this.toArray();
	}

	correctAspectRatio(): void {
		const c = this.canvas;
		if (c.is360) return;
		const targetAspect = c.camera.cpw / c.camera.cph;
		const currentAspect = this.width / this.height;
		if (currentAspect > targetAspect) {
			this.height = this.width / targetAspect;
		} else {
			this.width = this.height * targetAspect;
		}
		this.toArray();
	}

	/** Updates the shared Float64Array with the current view coordinates. */
	toArray(): Float64Array {
		this.arr[0] = this.centerX;
		this.arr[1] = this.centerY;
		this.arr[2] = this.width;
		this.arr[3] = this.height;
		return this.arr;
	}

	/** Checks if this view is equal to another view. */
	equals(centerX: number, centerY: number, width: number, height: number): boolean {
		return this.centerX === centerX
			&& this.centerY === centerY
			&& this.width === width
			&& this.height === height;
	}

	/** Checks if this view represents the full image [0,0,1,1]. */
	isFull(): boolean {
		return this.width === 1 && this.height === 1 && this.centerX === 0.5 && this.centerY === 0.5;
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
	inView(v: Viewport): boolean {
		return this.w < -1 || (this.w < 3 && !(this.x < 0 || this.x > v.width || this.y < 0 || this.y > v.height));
	}

	/** Updates the shared Float64Array with the current coordinate values. */
	toArray(): Float64Array {
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
		public areaWidth: number = 0,
		public areaHeight: number = 0,
		public ratio: number = 1,
		public scale: number = 1,
		public isPortrait: boolean = false
	) {}

	get centerX(): number { return this.left + this.width / 2 }
	get centerY(): number { return this.top + this.height / 2 }
	get aspect(): number { return this.width === 0 ? 1 : this.height === 0 ? 1 : this.width / this.height }

	/** Updates the shared Int32Array with the current viewport dimensions (integer pixels). */
	toArray(): Int32Array {
		this.arr[0] = this.width;
		this.arr[1] = this.height;
		this.arr[2] = this.left;
		this.arr[3] = this.top;
		return this.arr;
	}

	/**
	 * Sets the viewport properties, scaling by device pixel ratio.
	 * @returns True if any property changed, false otherwise.
	 */
	set(w: number, h: number, l: number, t: number, r: number, s: number, p: boolean): boolean {
		if (this.width === w * r && this.height === h * r && this.left === l && this.top === t &&
			this.ratio === r && this.scale === s && this.isPortrait === p) return false;
		this.width = w * r;
		this.height = h * r;
		this.left = l * r;
		this.top = t * r;
		this.ratio = r;
		this.scale = s;
		this.isPortrait = p;
		return true;
	}

	/** Copies properties from another Viewport object. */
	copy(v: Viewport): void {
		this.width = v.width;
		this.height = v.height;
		this.left = v.left;
		this.top = v.top;
		this.ratio = v.ratio;
		this.scale = v.scale;
		this.isPortrait = v.isPortrait;
	}
}
