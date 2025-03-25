import { Coordinates, PI } from './shared'
import Canvas from './canvas'

export default class Camera {
	scale : f64 = 1.0;
	minScale : f64 = 1.0;
	minSize : f64 = 1.0;
	maxScale : f64 = 1.0;
	fullScale : f64 = 1.0;
	coverScale : f64 = 1.0;

	// Internals
	private readonly xy : Coordinates = new Coordinates;
	private readonly coo : Coordinates = new Coordinates;
	private readonly startCoo : Coordinates = new Coordinates;

	private pinching : bool = false;
	private inited : bool = false;
	private hasStartCoo : bool = false;
	cpw : f64 = -1;
	cph : f64 = -1;
	private wasCoverLimit : bool = true;

	constructor(
		private canvas: Canvas
	) {
		if(canvas.is360) this.inited = true;
	}

	getCoo(x: f64, y: f64, abs: bool, noLimit: bool) : Coordinates {
		const c = this.canvas;
		if(c.noImage || c.freeMove)
			noLimit = true;

		const el = c.el;
		const r = c.hasParent ? c.parent.el.ratio : el.ratio;

		if(abs) {
			x -= el.left;
			y -= el.top;
		}

		const rX = (x / this.scale * r) / c.width + c.view.x0;
		const rY = (y / this.scale * r) / c.height + c.view.y0;

		this.coo.x = noLimit ? rX : max(c.view.lX0, min(c.view.lX1, rX));
		this.coo.y = noLimit ? rY : max(c.view.lY0, min(c.view.lY1, rY));
		this.coo.scale = this.scale;

		return this.coo;
	}

	getXY(x: f64, y: f64, abs: bool) : Coordinates {
		const c = this.canvas;
		const el = c.el;
		const rat = c.hasParent ? c.parent.el.ratio : el.ratio;
		this.xy.x = ((x - c.view.x0) * c.width) * this.scale / rat + (abs ? el.left : 0);
		this.xy.y = ((y - c.view.y0) * c.height) * this.scale / rat + (abs ? el.top : 0);
		this.xy.scale = this.scale / rat;
		return this.xy;
	}

	getXYOmni(x: f64, y: f64, radius:f64, rotation:f64, abs: bool) : Coordinates {
		return this.getXYOmniCoo(x-.5, y-.5, radius, rotation, abs);
	}

	getXYOmniCoo(x: f64, y: f64, z:f64, rotation:f64, abs:bool) : Coordinates {
		const c = this.canvas;
		const el = c.el;
		const mat = c.webgl.pMatrix, vec4 = c.webgl.vec4;
		const rat = c.hasParent ? c.parent.el.ratio : el.ratio;

		vec4.x = x;
		vec4.y = y;
		vec4.z = z;
		vec4.w = 1;

		mat.identity();

		if(!abs && c.omniFieldOfView) mat.perspective(c.omniFieldOfView, c.aspect, 0.0001, 100);
		if(c.omniDistance) mat.translate(0,0,c.omniDistance);
		if(c.omniOffsetX) mat.translate(c.omniOffsetX, 0, 0);
		if(!abs && c.omniVerticalAngle) mat.rotateX(c.omniVerticalAngle);

		const numPerLayer = c.images.length / c.omniNumLayers;
		const offset = c.layer * numPerLayer;
		const currRot = (c.images.length > 0 ? -(<f64>(c.activeImageIdx+1-offset) / (numPerLayer)) * 2 * PI : 0);
		mat.rotateY(rotation + currRot);
		vec4.transformMat4(mat);

		this.xy.x = ((.5 + vec4.x - c.view.x0) * c.width) * this.scale / rat + (abs ? el.left : 0);
		this.xy.y = ((.5 + vec4.y - c.view.y0) * c.height) * this.scale / rat + (abs ? el.top : 0);
		this.xy.w = -vec4.w-c.omniDistance;
		return this.xy;
	}

	setCanvas() : void {
		const c = this.canvas;
		const el = c.el;

		const cpw = el.width / c.width;
		const cph = el.height / c.height;

		if(!c.view.limitChanged && this.cpw == cpw && this.cph == cph) {
			if(c.coverLimit != this.wasCoverLimit) this.correctMinMax();
			return;
		}

		this.cpw = cpw;
		this.cph = cph;

		this.fullScale = min(this.cpw, this.cph);
		this.coverScale = max(this.cpw, this.cph);

		// Limited with coverscale
		const limitW = c.view.lX1 - c.view.lX0;
		const limitH = c.view.lY1 - c.view.lY0;
		const lRat = limitW / limitH;
		c.view.limitChanged = false;
		if(limitW < 1 || limitH < 1) {
			const rat = cpw / cph;
			if(lRat < rat) this.coverScale /= limitW / rat;
			else this.coverScale /= limitH * rat;
		}

		this.correctMinMax();

		if(el.width && el.height && !this.canvas.ani.isStarted()) {
			c.view.copy(c.ani.lastView);
			if(!c.is360) {
				const pLimit = c.ani.limit;
				c.ani.limit = false;
				this.setView();
				c.ani.limit = pLimit;
			}
		}
	}

	correctMinMax(noLimit:bool=false) : void {
		const c = this.canvas;
		this.minScale = c.coverLimit ? this.coverScale : this.fullScale;

		if(!noLimit && !c.main.isSwipe && (c.activeImageIdx == 0 && !c.coverLimit || c.activeImageIdx > 0)) {
			const aW = c.focus.width * c.width, aH = c.focus.height * c.height;
			const cW = c.el.width, cH = c.el.height;
			this.minScale = cW / cH > aW / aH ? cH / aH : cW / aW;
		}

		this.maxScale = max(this.minScale, c.maxScale / c.el.scale);
		this.wasCoverLimit = c.coverLimit;
	}

	isUnderZoom() : bool { return this.minSize < 1 && this.scale < this.minScale };
	isZoomedOut(b:bool = false) : bool { return <i32>((this.scale-this.minScale*(b ? this.minSize : 1))*1E6)/1E6 <= 0; }
	isZoomedIn() : bool { return <f32>(this.scale / this.maxScale) >= 1; }

	// Actions
	setView() : bool {
		if(this.cpw == -1) return false;
		const c = this.canvas;
		const v = this.canvas.view;

		const limited = !c.freeMove && c.ani.limit;

		if(!c.ani.correcting && (limited || (!c.ani.flying && c.coverLimit))) v.limit(false);

		const vw:f64 = v.width;
		const vh:f64 = v.height;
		const cw = this.cpw;
		const ch = this.cph;

		// min == contain, max == cover
		this.scale = min(cw / v.width, ch / v.height);

		if(limited && !this.pinching && this.isZoomedIn()) this.scale = this.maxScale;

		// If coverlimit, also prevent pinching out more
		if((!c.ani.correcting && !this.pinching) || c.coverLimit) this.scale = max(this.minScale*this.minSize, this.scale);

		// For initing with coverStart
		if(!this.inited && c.coverStart) this.scale = this.coverScale;

		const overflowX:f64 = (cw / this.scale - vw) / 2;
		const overflowY:f64 = (ch / this.scale - vh) / 2;

		v.x0 -= overflowX;
		v.y0 -= overflowY;
		v.x1 += overflowX;
		v.y1 += overflowY;

		if(!this.inited && c.coverStart) this.canvas.ani.lastView.copy(v);

		if(!c.ani.correcting && c.coverLimit) v.limit(false);

		this.inited = this.cpw > 0;

		v.toArray();

		// For first render, check if has startCoo and apply it with initial view already set
		if(this.hasStartCoo) {
			this.hasStartCoo = false;
			this.setCoo(this.startCoo.x, this.startCoo.y, this.startCoo.scale, 0, 0, false, 0, 0);
			return false;
		}
		return true;
	}

	isOutsideLimit() : bool {
		const v = this.canvas.view;
		return !this.canvas.freeMove && (
			(<i32>((v.x0 - v.lX0)*1E6)/1E6 < 0 !== <i32>((v.x1 - v.lX1)*1E6)/1E6 > 0)
			|| (<i32>((v.y0 - v.lY0)*1E6)/1E6 < 0 !== <i32>((v.y1 - v.lY1)*1E6)/1E6 > 0)
			|| <i32>((this.scale - this.maxScale)*1E6)/1E6 > 0
		);
	}

	pan(xPx: f64, yPx: f64, duration: f64, noLimit: bool, time: f64, force: bool=false, isKinetic: bool = false) : void {
		if((this.isUnderZoom() || this.pinching) && !force) return;

		if(this.canvas.freeMove) noLimit = true;

		const c = this.canvas;
		const r = c.hasParent ? c.parent.el.ratio : c.el.ratio;
		const v = c.view;

		const dX : f64 = xPx / c.width / this.scale * r;
		const dY : f64 = yPx / c.height / this.scale * r;

		const x0 = v.x0 + dX;
		const y0 = v.y0 + dY;
		const x1 = v.x1 + dX;
		const y1 = v.y1 + dY;

		if(this.pinching) {
			c.setView(x0, y0, x1, y1, noLimit, false);
		}
		else if(this.isOutsideLimit() && !isKinetic) {
			// Correct animate when starting to drag outside limit
			c.ani.toView(x0, y0, x1, y1, duration || 150, 0, 0, false, false, -1, false, 0, time, !noLimit);
		}
		else {
			c.ani.stop();

			// For kinetic scrolling
			if(duration == 0) {
				if(!isKinetic) c.kinetic.addStep(xPx*4, yPx*4, time);
				c.setView(x0, y0, x1, y1, noLimit, false, false, isKinetic);
			}
			else c.ani.toView(x0, y0, x1, y1, duration, 0, 0, false, false, -1, false, 0, time);
		}
	}

	zoom(delta: f64, xPx: f64, yPx: f64, duration: f64, noLimit: bool, time: f64) : f64 {
		if(!this.pinching && this.isZoomedIn() && delta < 0) return 0;
		const c = this.canvas;

		if(this.canvas.freeMove) noLimit = true;

		if(delta > 0 && this.isZoomedOut() && this.minSize >= 1 && (!this.pinching || c.coverLimit)) return 0;

		const el = c.el;
		const v = c.view;

		const ratio : f64 = (this.cpw/this.cph);
		let fact : f64 = delta * (el.width / 512) / c.width / this.scale;
		let factY : f64 = fact / ratio;

		// Prevent zooming in to mirrored values
		if(delta < 0 && fact < -1) fact = -.9999;
		if(delta < 0 && factY < -1) factY = -.9999;

		const limit = !noLimit && !c.freeMove && c.ani.limit && duration == 0;
		const r = c.hasParent ? c.parent.el.ratio : el.ratio;

		xPx-=el.left;
		yPx-=el.top;
		const uZ = this.isUnderZoom();
		const pX : f64 = xPx > 0 && !uZ ? xPx / el.width * r : .5;
		const pY : f64 = yPx > 0 && !uZ ? yPx / el.height * r : .5;

		c.ani.limit = limit;
		duration = c.ani.toView(
			v.x0 - fact * pX,
			v.y0 - factY * pY,
			v.x1 + fact * (1 - pX),
			v.y1 + factY * (1 - pY),
			duration, 0, 0, false, !noLimit && !this.pinching, -1, false, 0, time, limit
		)
		c.ani.lastView.copy(c.view);
		c.ani.limit = !noLimit;

		return duration;
	}

	prevSize: f64 = -1;
	prevCenterX: f64 = -1;
	prevCenterY: f64 = -1;
	pinch(xPx1: f64, yPx1: f64, xPx2: f64, yPx2: f64) : void {
		const c = this.canvas;
		const el = c.main.el;

		const left = (min(xPx1, xPx2) - el.left) / el.scale;
		const top = (min(yPx1, yPx2) - el.top) / el.scale;
		const right = (max(xPx1, xPx2) - el.left) / el.scale;
		const bottom = (max(yPx1, yPx2) - el.top) / el.scale;

		const cX = left + (right - left) / 2;
		const cY = top + (bottom - top) / 2;

		const size: f64 = max(right-left , bottom-top);
		const delta = this.prevSize - size;

		c.kinetic.stop();

		if(this.prevCenterX > 0) {
			const dX = this.prevCenterX - cX;
			const dY = this.prevCenterY - cY;

			if(c.is360) {
				c.webgl.zoom(delta*2, 0, 0, false, 1);
				c.webgl.rotate(dX, dY, 0, 0);
			}
			else {
				if(!this.canvas.main.noPinchPan && this.scale > this.minScale) this.pan(dX, dY, 0, false, 0, true);
				this.zoom(delta * 2 * el.scale, cX, cY, 0, !this.canvas.pinchZoomOutLimit, 0);
				c.ani.limit = !!this.canvas.pinchZoomOutLimit;
			}
		}
		else c.ani.stop();

		this.prevCenterX = cX;
		this.prevCenterY = cY;
		this.prevSize = size;
	}

	pinchStart() : void {
		this.pinching = true;
	}

	pinchStop(time: f64) : void {
		if(!this.canvas.is360) {
			// Correct viewport if out of bounds
			const v = this.canvas.view;
			const freeMove = this.canvas.freeMove;
			this.canvas.ani.toView(
				freeMove ? v.x0 : max(v.x0, v.lX0),
				freeMove ? v.y0 : max(v.y0, v.lY0),
				freeMove ? v.x1 : min(v.x1, v.lX1),
				freeMove ? v.y1 : min(v.y1, v.lY1),
				150, 0, 0, false, false, -1, false, 0, time, true);
		}

		this.prevSize = -1;
		this.prevCenterX = -1;
		this.prevCenterY = -1;
		this.pinching = false;
	}

	flyTo(x0: f64, y0: f64, x1: f64, y1: f64, dur: f64, speed: f64, perc: f64, isJump: bool, limit: bool, limitZoom: bool, toOmniIdx: i32, noTrueNorth: bool, fn:i16, time: f64) : f64 {
		const c = this.canvas;
		const a = c.ani;
		c.kinetic.stop();

		a.limit = false;
		dur = a.toView(x0, y0, x1, y1, dur, speed, perc, isJump, limit, toOmniIdx, noTrueNorth, fn, time, limitZoom);
		a.limit = false;
		a.flying = true;
		return dur;
	}

	setCoo(x: f64, y: f64, scale: f64, dur: f64, speed: f64, limit: bool, fn:i16, time: f64) : f64 {
		if(!this.inited) {
			this.hasStartCoo = true;
			this.startCoo.x = x;
			this.startCoo.y = y;
			this.startCoo.scale = scale;
			this.setView();
			return 0;
		}

		const c = this.canvas;
		const is360 = c.is360;

		if(scale == 0 || (!is360 && isNaN(scale))) scale = c.getScale();

		if(!is360) scale = max(this.minScale, scale);

		c.kinetic.stop();

		const w:f64 = isNaN(scale) && is360 ? c.view.width : (1/scale) * this.cpw;
		const h:f64 = isNaN(scale) && is360 ? c.view.height : (1/scale) * this.cph * (is360 ? .5 : 1);

		if(dur==0 && !is360) {
			if(x + w/2 > 1) x = 1 - w/2;
			if(x - w/2 < 0) x = w/2;
			if(y + h/2 > 1) y = 1 - h/2;
			if(y - h/2 < 0) y = h/2;
		}

		dur = c.ani.toView(x - w/2, y - h/2, x + w/2, y + h/2, dur, speed, 0, false, false, -1, true, fn, time);

		c.ani.limit = dur==0 || limit;
		c.ani.flying = dur>0;

		return dur;
	}
}
