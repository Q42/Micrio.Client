import { pyth, easeInOut, easeIn, easeOut, linear, Bicubic } from './utils'
import { View } from './shared'
import { aniDone, aniAbort } from './main';
import Canvas from './canvas';

export default class Ani {
	// View ani
	private isView : bool = false;
	private readonly vFrom : View;
	private readonly vTo : View;
	readonly lastView : View;

	// Camera animation
	private isZoom : bool = false;
	private isJump : bool = false;
	private zFrom : f64 = 0;
	private zTo : f64 = 0;
	private zNoLimit : bool = false;
	private fn : Bicubic = easeInOut;

	private started : f64 = 0;
	private duration : f64 = 0;

	private isRunning : bool = false;

	limit : bool = true;
	zoomingOut : bool = false;
	flying : bool = false;
	correcting : bool = false;

	// For pausing
	private pausedAt : f64 = 0;

	// For view expanding
	private fL:i8 = 0;
	private fT:i8 = 0;
	private fR:i8 = 0;
	private fB:i8 = 0;
	private mI:f64 = 0;
	private mO:f64 = 0;

	// For omni animations
	private omniStartIdx:i32 = -1;
	private omniDelta:i32 = 0;

	constructor(
		private canvas: Canvas
	) {
		this.vFrom = new View(canvas);
		this.vTo = new View(canvas);
		this.lastView = new View(canvas);
	}

	pause(time:f64) : void {
		if(this.pausedAt > 0) return;
		this.isRunning = false;
		this.pausedAt = time;
	}

	resume(time:f64) : void {
		if(this.pausedAt == 0 || this.started == 0) return;
		this.started += time - this.pausedAt;
		this.pausedAt = 0;
		this.isRunning = true;
	}

	stop() : void {
		aniAbort(this.canvas);
		this.started = 0;
		this.limit = true;
		this.flying = false;
		this.isRunning = false;
		this.isView = false;
		this.isZoom = false;
		this.correcting = false;
		this.pausedAt = 0;
	}

	isStarted() : bool {
		return this.isRunning && this.isView;
	}

	toView(
		toX0: f64, toY0: f64, toX1: f64, toY1: f64,
		dur: f64, speed: f64, perc: f64,
		isJump: bool, limitViewport:bool, omniIdx:i32,
		noTrueNorth: bool, fn: i16, time : f64, correct : bool = false) : f64 {
		this.lastView.set(toX0, toY0, toX1, toY1);
		if(correct && this.correcting) {
			this.updateTarget(toX0, toY0, toX1, toY1, true);
			return dur;
		}

		// Do 360 true north correction
		// By default this is true except for a Camera.flyTo which has an argument
		// of an earlier read out (corrected) view.
		this.vTo.correct = this.canvas.is360 && !noTrueNorth;

		const c = this.canvas;
		const v = c.view;
		const t = this.vTo;
		const f = this.vFrom;

		// Jump for joy
		this.isJump = isJump;

		// Timing function
		this.fn = fn == 3 ? linear : fn == 2 ? easeOut : fn == 1 ? easeIn : easeInOut;

		// When animating to portion of the screen
		const el = c.main.el;
		if(el.areaHeight != 0) {
			const margin:f64 = (toY1-toY0) / (1-(el.areaHeight / el.height));
			if(margin > 0) toY1 += margin; else toY0 += margin;
			el.areaHeight = 0;
		}
		if(el.areaWidth != 0) {
			const margin:f64 = (toX1-toX0) * (el.areaWidth / el.width);
			if(margin > 0) toX1 += margin; else toX0 += margin;
			el.areaWidth = 0;
		}

		f.set(v.x0, v.y0, v.x1, v.y1);
		t.set(toX0*1, toY0*1, toX1*1, toY1*1);

		if(c.is360) {
			isJump = true;
			if(abs(f.centerX - t.centerX) > .5) {
				if(f.x1 > 1 && t.x1 < 1) { t.x0++; t.x1++; }
				if(t.x1 > 1 && f.x1 < 1) { f.x0++; f.x1++; }
			}
		}

		if(limitViewport) {
			t.correctAspectRatio();
			t.limit(false);
		}

		this.fL = 0; this.fR = 0; this.fT = 0; this.fB = 0;
		let durFact:f64=1;

		if(this.isJump) {
			if(!c.is360) {
				const cX = t.centerX, cY = t.centerY;
				if(t.aspect > f.aspect) { const nh = t.width * f.aspect; t.y0 = cY-nh/2; t.y1 = cY+nh/2; }
				else { const nw = t.height * f.aspect; t.x0 = cX-nw/2; t.x1 = cX+nw/2; }
			}
			const el = t.x0 < f.x0, et = t.y0 < f.y0, er = t.x1 > f.x1, eb = t.y1 > f.y1;
			if((el || et || er || eb) && !(el && et && er && eb)) {
				this.fL = el?1:2; this.fR = er?1:2; this.fT = et?1:2; this.fB = eb?1:2;
				durFact=1.5;
			}
			else t.set(toX0*1, toY0*1, toX1*1, toY1*1);
		}

		if(correct) t.limit(true, !limitViewport);

		const resoFact = max(10000, min(15000, sqrt(c.width * c.width + c.height * c.height) / 2));
		const dst = v.getDistance(t, dur < 0);
		this.mI = max(.5, .8 - dst * (c.is360 ? 1 : 2));
		this.mO = max(.05, min(.9, dst - (c.is360 ? .2 : .1)));
		this.duration = dur < 0 ? (dst * resoFact / c.camSpeed * durFact) / (speed <= 0 ? 1 : speed) : dur;

		const numPerLayer = this.canvas.images.length / this.canvas.omniNumLayers;
		this.omniStartIdx = this.canvas.activeImageIdx;
		this.omniDelta = 0;
		if(!isNaN(omniIdx) && omniIdx > 0 && omniIdx != this.omniStartIdx) {
			this.omniDelta = omniIdx - this.omniStartIdx;
			if(this.omniDelta < -numPerLayer/2) this.omniDelta += numPerLayer;
			if(this.omniDelta > numPerLayer / 2) this.omniDelta -= numPerLayer;
			this.duration += abs(this.omniDelta) / <f64>this.canvas.images.length * 6000;
		}

		if(this.duration == 0) {
			c.setView(t.x0, t.y0, t.x1, t.y1, false, true);
			aniDone(this.canvas);
			this.stop();
			return this.duration;
		}

		this.stop();

		this.isView = true;
		this.limit = false;
		this.flying = false;
		this.isZoom = false;

		if(correct) this.correcting = true;

		this.started = time - (perc * this.duration);
		this.isRunning = true;

		return this.duration * (1 - perc);
	}

	updateTarget(toX0: f64, toY0: f64, toX1: f64, toY1: f64, limiting : bool = false) : void {
		this.vTo.set(toX0, toY0, toX1, toY1);
		if(limiting) this.vTo.limit(limiting);
	}

	zoom(to: f64, dur: f64, speed: f64, noLimit: bool, time: f64) : f64 {
		this.stop();
		this.isView = false;
		this.flying = false;
		this.isZoom = true;
		this.zNoLimit = noLimit;

		const c = this.canvas;
		const webgl = c.webgl;

		this.zFrom = webgl.perspective;
		this.zTo = this.zFrom + (to / (webgl.scale * <f64>pyth(c.width, c.height) / 20));
		if(!noLimit) this.zTo = min(webgl.maxPerspective, max(webgl.minPerspective, this.zTo));
		this.started = time;
		this.isRunning = true;

		this.duration = dur >= 0 ? dur : abs(this.zFrom - this.zTo) * 1000 / speed;
		return dur;
	}

	setStartView(p0:f64, p1:f64, p2: f64, p3: f64, correctRatio: bool) : void {
		this.vFrom.set(p0, p1, p2, p3, correctRatio);
		this.vTo.set(p0, p1, p2, p3, correctRatio);
	}

	step(time: f64) : f64 {
		const p : f64 = this.started == 0 ? 1 : min(1, max(0, (time - this.started) / this.duration));
		const pE = this.fn.get(p);
		const scale = this.canvas.getScale();

		if(this.isRunning) {
			if(this.isView) {
				const f = this.vFrom, t = this.vTo, mo=this.mO, i = this.fn.get(min(1, p/this.mI)),
					o = this.fn.get(max(0,(p-mo)/(1-mo))); let n:i8=0;
				this.canvas.setView(f.x0+(t.x0-f.x0)*(!(n=this.fL)?pE:n==1?i:o),
					f.y0+(t.y0-f.y0)*(!(n=this.fT)?pE:n==1?i:o),f.x1+(t.x1-f.x1)*(!(n=this.fR)?pE:n==1?i:o),
					f.y1+(t.y1-f.y1)*(!(n=this.fB)?pE:n==1?i:o),false, true);

				if(this.omniDelta) {
					let idx = this.omniStartIdx + <i32>(this.omniDelta * this.fn.get(min(1, p*1.5)));
					const numPerLayer = this.canvas.images.length / this.canvas.omniNumLayers;
					if(idx < 0) idx += numPerLayer;
					if(idx >= numPerLayer) idx -= numPerLayer;
					this.canvas.setActiveImage(idx, 0);
				}
			}

			if(this.isZoom) {
				this.canvas.webgl.setPerspective(this.zFrom * (1-pE) + this.zTo * pE, this.zNoLimit);
			}

			if(p>=1) {
				this.lastView.copy(this.canvas.view);
				aniDone(this.canvas);
				this.stop();
			}
		}

		this.zoomingOut = this.isRunning && this.canvas.getScale() < scale;

		return p;
	}

}
