import Image from './image';
import Canvas from './canvas';
import { mod1, pyth } from './utils'

export const PI:f64 = 3.14159265358979323846;
export const PIh:f64 = PI/2;
export const PI2:f64 = PI*2;

export class DrawRect {
	public image!: Image;

	constructor(
		// Rect
		public x0: f64 = 0,
		public y0: f64 = 0,
		public x1: f64 = 0,
		public y1: f64 = 0,
		// Image data
		public layer: u32 = 0,
		public x: u32 = 0,
		public y: u32 = 0
	) {}
}

export class View {
	readonly arr : Float64Array = new Float64Array(4);
	public correct : bool = false;
	public changed : bool = false;
	public limitChanged : bool = false;
	private _cX360:number = 0.5;
	private _cY360:number = 0.5;
	public tnOffset:number = 0;

	constructor(
		private readonly canvas: Canvas,

		public x0: f64 = 0,
		public y0: f64 = 0,
		public x1: f64 = 1,
		public y1: f64 = 1,

		// Limit
		public lX0: f64 = 0,
		public lY0: f64 = 0,
		public lX1: f64 = 1,
		public lY1: f64 = 1,
	) {
		this.tnOffset = .5-canvas.trueNorth;
	}

	get width(): f64 { return this.x0 > this.x1 ? this.x0 - this.x1 : this.x1-this.x0 }
	get height(): f64 { return this.y1-this.y0 }
	get centerX(): f64 { return this.canvas.is360 ? this._cX360 : this.x0 + this.width/2 }
	get centerY(): f64 { return this.canvas.is360 ? this._cY360 : this.y0 + this.height/2 }
	get yaw(): f64 { return (this.centerX - .5) * PI * 2 }
	get pitch() : f64 { return (this.centerY - .5) * PI }
	get aspect() : f64 { return this.width / this.height }
	get size() : f64 { return pyth(this.width,this.height) / pyth(1,1) }

	set(x0:f64, y0:f64, x1:f64, y1:f64, preserveAspect: bool = false) : void {
		if(preserveAspect) {
			const w = x1 - x0;
			let h = y1 - y0;
			const cY = y0 + h / 2;
			const cAr = min(1, this.width) / min(1, this.height);
			if(w / h > cAr * 1.5 && w < this.width) { h = w * cAr; y0 = cY - h/2; y1 = cY + h/2 }
		}

		const os = this.correct ? this.tnOffset : 0;

		this.x0 = x0 + os;
		this.y0 = y0;
		this.x1 = x1 + os;
		this.y1 = y1;
		this._cX360 = this.x0 + this.width/2;
		this._cY360 = this.y0 + this.height/2;

		this.toArray();
		this.changed = true;
	}

	setLimit(x0: f64, y0: f64, x1: f64, y1: f64) : void {
		this.lX0 = x0;
		this.lY0 = y0;
		this.lX1 = x1;
		this.lY1 = y1;
		this.changed = true;
		this.limitChanged = true;
	}

	copy(v:View) : void {
		this.set(v.x0, v.y0, v.x1, v.y1);
	}

	getPerspective(): f64 {
		const c = this.canvas;
		const webgl = c.webgl;
		return webgl.maxPerspective - (.5 / (this.height * c.height / c.el.height)) * PI / webgl.scaleY
	}

	getScale(): f64 {
		const c = this.canvas;
		return 1 / max(
			this.width * c.width / c.el.width,
			this.height * c.height / c.el.height
		);
	}

	getDistance(v: View, correctAspect:bool): f64 {
		// Prevent any normalization for images not in full-window mode
		if(correctAspect && this.canvas.currentArea.isFull()) {
			v.correctAspectRatio();
			this.correctAspectRatio();
		}
		const dx0 = abs(min(v.x0,v.x1) - min(this.x0,this.x1)), dy0 = abs(v.y0 - this.y0),
			dx1 = abs(max(v.x0,v.x1) - max(this.x0,this.x1)), dy1 = abs(v.y1 - this.y1);
		return (dx0+dy0+dx1+dy1)/4 / (1 + abs(this.size-v.size));
	}

	from360(): void {
		const c = this.canvas;
		const webgl = c.webgl;
		const height:f64 = webgl.perspective / PI / webgl.scaleY;
		const width:f64 = height * (c.el.width == 0 ? 1 : .5 * sqrt(c.el.aspect)) / (c.aspect/2);

		this._cX360 = mod1(webgl.yaw / (PI * 2) - c.trueNorth);
		this._cY360 = (webgl.pitch/webgl.scaleY) % (PI * 2) / PI + .5;
		this.x0 = mod1(this._cX360 - width / 2);
		this.y0 = this._cY360 - height / 2;
		this.x1 = mod1(this._cX360 + width / 2);
		this.y1 = this._cY360 + height / 2;

		if(this.x0 > this.x1) this.x1++;

		this.changed = true;
	}

	limit(correctZoom:bool, noLimit:bool = false): void {
		const c = this.canvas;
		const mS = c.camera.minSize;
		const s = this.getScale();

		// Center in image if underzoomed
		if(mS < 1 && s < c.camera.minScale && !noLimit) {
			const mWH = 1 / mS, nW = min(mWH, this.width), nH = min(mWH, this.height);
			this.x1 = (this.x0 = .5 - nW/2) + nW;
			this.y1 = (this.y0 = .5 - nH/2) + nH;
			return;
		}

		const overZoom:f64 = correctZoom ? max(1, s / max(c.camera.minScale, c.maxScale / c.el.scale)) : 1;
		const vw:f64 = min(this.lX1-this.lX0, this.width * overZoom);
		const vh:f64 = min(this.lY1-this.lY0, this.height * overZoom);

		// First limit scale
		if(correctZoom && (overZoom > 1 || (noLimit && s < c.camera.minScale))) {
			const cX:f64 = this.centerX;
			this.x0 = cX-vw/2;
			this.x1 = cX+vw/2;

			const cY:f64 = this.centerY;
			this.y0 = cY-vh/2;
			this.y1 = cY+vh/2;
		}

		if(noLimit) return;

		// Limit boundaries
		if(this.x0<this.lX0) {
			this.x0=this.lX0;
			this.x1=this.x0+vw;
		}
		else if(this.x1>this.lX1) {
			this.x1=this.lX1;
			this.x0=this.x1-vw;
		}

		if(this.y0<this.lY0) {
			this.y0=this.lY0;
			this.y1=this.y0+vh;
		}
		else if(this.y1>this.lY1) {
			this.y1=this.lY1;
			this.y0=this.y1-vh;
		}
	}

	correctAspectRatio(): void {
		const c = this.canvas;
		if(c.is360) return;
		const s = this.getScale();
		const overflowX:f64 = (c.camera.cpw / s - this.width) / 2;
		const overflowY:f64 = (c.camera.cph / s - this.height) / 2;

		this.x0 -= overflowX;
		this.y0 -= overflowY;
		this.x1 += overflowX;
		this.y1 += overflowY;
	}

	toArray(): Float64Array {
		unchecked(this.arr[0] = this.x0);
		unchecked(this.arr[1] = this.y0);
		unchecked(this.arr[2] = this.x1);
		unchecked(this.arr[3] = this.y1);

		return this.arr;
	}

	equal(v:View) : bool {
		return this.x0 == v.x0
			&& this.x1 == v.x1
			&& this.y0 == v.y0
			&& this.y1 == v.y1
	}

	isFull() : bool {
		return this.x0 == 0 && this.y0 == 0 && this.x1 == 1 && this.y1 == 1;
	}
}

export class Coordinates {
	readonly arr : Float64Array = new Float64Array(4);

	constructor(
		public x: f64 = .5,
		public y: f64 = .5,
		public scale: f64 = 1,
		public w: f64 = 0,
		public direction: f64 = 0
	) {}

	inView(v:Viewport): bool {
		return this.w < -1 || (this.w < 3 && !(this.x < 0 || this.x > v.width || this.y < 0 || this.y > v.height));
	}

	toArray(): Float64Array {
		unchecked(this.arr[0] = this.x);
		unchecked(this.arr[1] = this.y);
		unchecked(this.arr[2] = this.scale);
		unchecked(this.arr[3] = this.w);
		unchecked(this.arr[4] = this.direction);

		return this.arr;
	}
}

export class Viewport {
	readonly arr : Int32Array = new Int32Array(4);

	constructor(
		public width: f64 = 0,
		public height: f64 = 0,
		public left: f64 = 0,
		public top: f64 = 0,
		public areaWidth: f64 = 0,
		public areaHeight: f64 = 0,
		public ratio: f64 = 1,
		public scale: f64 = 1,
		public isPortrait: bool = false
	) {}

	get centerX(): f64 { return this.left + this.width/2 }
	get centerY(): f64 { return this.top + this.height/2 }
	get aspect(): f64 { return this.width / this.height }

	toArray(): Int32Array {
		unchecked(this.arr[0] = this.width);
		unchecked(this.arr[1] = this.height);
		unchecked(this.arr[2] = this.left);
		unchecked(this.arr[3] = this.top);

		return this.arr;
	}
	set(w: f64, h: f64, l: f64, t: f64, r: f64, s: f64, p: bool) : bool {
		if(this.width == w*r && this.height == h*r && this.left == l && this.top == t &&
			this.ratio == r && this.scale == s && this.isPortrait == p) return false;
		this.width = w*r;
		this.height = h*r;
		this.left = l*r;
		this.top = t*r;
		this.ratio = r;
		this.scale = s;
		this.isPortrait = p;
		return true;
	}

	copy(v:Viewport) : void {
		this.set(v.width, v.height, v.left, v.top, v.ratio, v.scale, v.isPortrait);
	}
}
