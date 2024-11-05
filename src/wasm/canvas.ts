import { View, DrawRect, Viewport } from './shared';
import { Main, getTileOpacity, drawTile, drawQuad, setMatrix, setViewport, viewSet, viewportSet, setVisible, setVisible2 } from './main';
import { easeInOut } from './utils'
import { base360Distance } from './globals';

import Kinetic from './camera.kinetic'
import Ani from './camera.ani'
import Camera from './camera'
import Image from './image'
import WebGL from './webgl'

export default class Canvas {
	readonly view! : View;

	readonly focus! : View;
	readonly ani! : Ani;
	readonly kinetic! : Kinetic;
	readonly camera! : Camera;
	readonly webgl! : WebGL;
	readonly rect : DrawRect = new DrawRect;
	readonly el : Viewport = new Viewport;

	readonly images : Image[] = [];

	// For grid Canvases
	private readonly children: Canvas[] = [];
	readonly area!: View;
	readonly currentArea!: View;
	readonly targetArea!: View;
	readonly visible!: View;
	readonly full!: View;

	/** Area animating */
	private areaAniPerc: f64 = 1;
	private areaAniPaused: bool = false;

	zIndex:u8 = 0;

	readonly toDraw : u32[] = [];

	readonly aspect: f32;
	private index:u32 = 0;

	private isVisible: bool = false;

	// Linear opacity
	opacity: f64 = 0;
	// Bezier opacity
	bOpacity: f64 = 0;

	isReady: bool = false;
	activeImageIdx:i32 = -1;

	// Omni-images
	omniFieldOfView: number = 0;
	omniVerticalAngle: number = 0;
	omniDistance: number = 0;
	omniOffsetX: number = 0;

	// Limit tiles to 1024-layer (archive-only downloads)
	limited: bool = false;

	layer: i32 = 0;

	constructor(
		readonly main: Main,

		// These are DYNAMIC for grid controllers
		public width: f64,
		public height: f64,

		readonly tileSize: u32,
		readonly is360: bool,
		readonly noImage: bool,
		readonly isSingle: bool,
		public targetOpacity: f64,
		readonly freeMove: bool,
		public coverLimit: bool,
		readonly coverStart: bool,
		readonly maxScale: f64,
		readonly camSpeed: f64,

		// 360
		readonly trueNorth: f64,

		// Paged
		readonly isGallerySwitch: bool,
		readonly pagesHaveBackground: bool,

		// Omni
		readonly isOmni: bool,

		readonly pinchZoomOutLimit: bool,

		readonly numLayers: i32,

		readonly hasParent: bool
	) {
		this.index = main.canvases.length;
		if(!hasParent) main.canvases.push(this);

		if(coverLimit) coverStart = true;

		this.aspect = <f32>width / <f32>height;

		this.view = new View(this);
		this.focus = new View(this);
		this.ani = new Ani(this);
		this.kinetic = new Kinetic(this);
		this.camera = new Camera(this);
		this.webgl = new WebGL(this);
		this.area = new View(this);
		this.currentArea = new View(this);
		this.targetArea = new View(this);
		this.visible = new View(this);
		this.full = new View(this);

		if(is360) { this.view.y0 = .25; this.view.y1 = .75; }

		if(!hasParent) {
			this.el.copy(main.el);
			this.setView(this.view.x0,this.view.y0,this.view.x1,this.view.y1, false, false);
			this.resize();
		}

		if(!noImage) this.addImage(0, 0, 1, 1, width, height, tileSize, isSingle, false, targetOpacity, 0, 0, 0, 1, 0);
		else {
			this.main.numImages++;
			this.bOpacity = 1;
			this.opacity = 1;
			this.isReady = true;
		}
	}

	parent!: Canvas;

	setParent(parent: Canvas) : void {
		this.parent = parent;
		this.index += parent.children.length;
	}

	addImage(x0:f64,y0:f64,x1:f64,y1:f64,w:f64,h:f64,
		tileSize:u32, isSingle: bool, isVideo: bool,
		opa:f64, rotX:f64, rotY:f64, rotZ:f64, scale:f64, fromScale:f64) : Image {
		const image = new Image(
			this,
			this.main.numImages++,
			this.images.length,
			w, h, tileSize,
			isSingle, isVideo,
			this.main.numTiles,
			0, opa, rotX, rotY, rotZ, scale, fromScale);
		image.setArea(x0, y0, x1, y1);
		this.images.push(image);
		this.main.numTiles = image.endOffset;
		if(this.images.length == 1) this.setActiveImage(0,0);
		return image;
	}

	/** For independent Canvas images inside main image, used for grid */
	addChild(x0:f32, y0: f32, x1: f32, y1: f32,
		width: f32, height: f32) : Canvas {
		const c = new Canvas(
			this.main, width, height,
			this.tileSize, false, false, // < noImage
			false, 1, false, // < free move
			true, // < cover limit
			true, // < cover start
			1, this.camSpeed, 0, false, false, false, this.pinchZoomOutLimit, 1,
			true
		);
		c.setParent(this);
		c.setArea(x0, y0, x1, y1, true, true);
		this.children.push(c);
		return c;
	}

	setVisible(b:bool) : void {
		setVisible(this, b);
		this.isVisible = b;
	}

	fadeOut() : void {
		this.targetOpacity = 0;
		this.zIndex = 0;
	}

	fadeIn() : void {
		this.isReady = true;
		// Fade out the rest if this is standalone and full-screen
		if(!this.hasParent && this.currentArea.width == 1 && this.currentArea.height == 1) this.main.canvases.forEach(c => { c.fadeOut() });
		this.targetOpacity = 1;
	}

	areaAnimating() : bool {
		return !this.areaAniPaused && this.areaAniPerc < 1;
	}

	isHidden() : bool {
		return (this.targetOpacity == 0 && this.opacity == 0)
			|| (this.currentArea.width == 0 || this.currentArea.height == 0);
	}

	shouldDraw() : void {
		// Don't draw inactive image
		if(!this.areaAnimating() && this.isHidden()) {
			if(this.isVisible) this.setVisible(false);
			return;
		}

		if(!this.isVisible && this.opacity >= 1) this.setVisible(true);

		let animating: bool = this.ani.step(this.main.now) < 1
			|| this.kinetic.step(this.main.now) < 1 || !this.isReady;

		this.toDraw.length = 0;

		// Returns true if animating
		if(this.partialView(false)) animating = true;

		// Outside of screen
		if(!this.is360 && (this.visible.width < 0 || this.visible.height < 0)) return;

		if(this.isReady && this.opacity != this.targetOpacity) {
			const delta:f64 = (1/(this.main.distanceX != 0 || this.main.distanceY != 0 ? this.main.spacesTransitionDuration: this.main.crossfadeDuration))/this.main.frameTime;
			const fadingIn:bool = this.targetOpacity > 0 && this.targetOpacity >= this.opacity;
			this.opacity = fadingIn ? min(1, this.opacity + delta) : max(0, this.opacity - delta);
			this.bOpacity = easeInOut.get(this.opacity);
			// For 360 movement translations
			if(this.main.distanceX != 0 || this.main.distanceY != 0) {
				let rot:f64=0;
				if(fadingIn) {
					// Get relative baseYaw from fadingOut image and apply
					rot = -this.webgl.baseYaw;
					for(let i=0;i<this.main.canvases.length;i++) {
						const c = unchecked(this.main.canvases[i]);
						if(c.targetOpacity == 0 && c.opacity > 0) {
							rot += c.webgl.baseYaw;
							break;
						}
					}
				}
				const fact:f64 = this.opacity == 0 ? 0 : easeInOut.get(1 - this.opacity) * (fadingIn ? 1 : -1);
				this.webgl.moveTo(
					this.main.distanceX * fact * base360Distance,
					this.main.distanceY * fact * base360Distance,
					this.main.direction,
					rot);
			}
			animating = true;
		}

		const scale:f64 = (this.is360 ? this.webgl.scale : this.camera.scale) * this.el.scale;

		// Draw all images
		for(let i:i32=0;i<this.images.length;i++) {
			const image = unchecked(this.images[i]);
			if(!image.shouldRender()) { if(image.doRender) setVisible2(image, image.doRender = false); }
			else {
				if(i > 0) {
					if(!image.doRender) setVisible2(image, image.doRender = true);
					if(image.isVideo && image.isVideoPlaying) animating = true;
				}
				if(image.opacityTick(this.isGallerySwitch || this.opacity < 1)) animating = true;
				if(image.opacity > 0) this.main.doneTotal += image.getTiles(scale);
			}
		}

		// Set progress
		this.main.toDrawTotal += <f32>this.toDraw.length;
		this.main.progress = this.main.toDrawTotal == 0 ? 1
			: this.main.doneTotal / this.main.toDrawTotal;

		// Write view array for this frame
		this.view.toArray();

		// Render any children
		for(let i:i32=0;i<this.children.length;i++)
			unchecked(this.children[i]).shouldDraw();

		if(animating) this.main.animating = true;
	}

	// Draw the individual tiles in the client
	draw() : void {
		// Don't draw inactive image
		if(this.targetOpacity == 0 && this.opacity == 0) return;

		const animating = this.ani.isStarted();

		// Always set GL viewport
		setViewport(this.el.left, this.main.el.height - this.el.height - this.el.top, this.el.width, this.el.height);

		setMatrix(this.webgl.pMatrix.arr);

		// In case of multiple images (paged), always draw solid bg for targetOpacity >= 1
		if(this.pagesHaveBackground) for(let imgIdx:i32=0;imgIdx<this.images.length;imgIdx++) {
			const im = unchecked(this.images[imgIdx]);
			if(!(im.x1 <= this.view.x0 || im.x0 >= this.view.x1 || im.y1 <= this.view.y0 || im.y0 >= this.view.y1)) {
				this.setTile(im.endOffset-1);
				drawQuad(im.tOpacity);
			}
		}

		const r = this.rect;
		for(let j:i32=0;j<this.toDraw.length;j++) {
			const i:u32 = unchecked(this.toDraw[j]);
			this.setTile(i);

			// Download 2 sharpest layers
			const isTargetLayer = r.layer == r.image.targetLayer - 1 || (!this.main.bareBone && r.layer == r.image.targetLayer);
			const isBaseTile = i == r.image.endOffset - 1;
			const opa = getTileOpacity(i);

			// Only download target-layer tiles or draw if already available
			if((isTargetLayer || opa == 1 || isBaseTile) && drawTile(r.image.index, i, r.layer,
				r.x, r.y, opa * this.bOpacity * r.image.opacity, animating, r.layer == r.image.targetLayer - 1)
				&& isBaseTile) { r.image.gotBase = this.main.now; if(!this.isReady) this.fadeIn(); }
		}

		this.children.sort((a, b) => a.zIndex>b.zIndex?1:a.zIndex<b.zIndex?-1:0);
		for(let i:i32=0;i<this.children.length;i++)
			unchecked(this.children[i]).draw();

		if(this.view.changed) viewSet(this);
		this.view.changed = false;
	}

	// Grid logic
	private partialView(noDispatch:bool) : bool {
		const c = this.main.el;
		const hP = this.hasParent;
		const s = hP ? this.parent.getScale() : 1 / c.ratio, // 1 if no parent
			pW = hP ? this.parent.width : c.width, // innerWidth
			pH = hP ? this.parent.height : c.height, // innerHeight
			pV = hP ? this.parent.view : this.full, // full view if no parent
			v = this.view,
			a = this.currentArea,
			b = this.area,
			t = this.targetArea;

		const animating = this.areaAnimating();

		if(animating) {
			const delta:f64 = (1/this.main.gridTransitionDuration)/this.main.frameTime;
			this.areaAniPerc = min(1, this.areaAniPerc+delta);
			const p = this.main.gridTransitionTimingFunction.get(this.areaAniPerc);
			a.set(
				b.x0 + (t.x0 - b.x0) * p,
				b.y0 + (t.y0 - b.y0) * p,
				b.x1 + (t.x1 - b.x1) * p,
				b.y1 + (t.y1 - b.y1) * p,
			);
			if(this.areaAniPerc == 1) {
				if(this.zIndex == 1) this.zIndex = 0;
				b.copy(t);
			}
			this.view.changed = true;
		}

		this.visible.x0 = max(v.x0, v.x0 + (pV.x0 - a.x0) / a.width * v.width);
		this.visible.x1 = min(v.x1, v.x0 + (1 - (a.x1 - min(a.x1, pV.x1)) / a.width) * v.width);
		if(!this.is360) {
			this.visible.x0 = max(0, this.visible.x0);
			this.visible.x1 = min(1, this.visible.x1);
		}
		this.visible.y0 = max(max(0, v.y0), v.y0 + (pV.y0 - a.y0) / a.height * v.height);
		this.visible.y1 = min(min(1, v.y1), v.y0 + (1 - (a.y1 - min(a.y1, pV.y1)) / a.height) * v.height);

		const ratio = hP ? 1 : c.ratio;
		const fadingOut = this.targetOpacity < this.opacity;
		if(!fadingOut && this.el.set(a.width * s * pW, a.height * s * pH, (a.x0 - pV.x0) * pW * s, (a.y0 - pV.y0) * pH * s, ratio, hP ? 1 : c.scale, hP ? false : c.isPortrait)) {
			if(!noDispatch) this.sendViewport();
			this.view.changed = true;
			this.resize();
			this.camera.setCanvas();
			this.webgl.update();
		}

		return animating;
	}

	setArea(x0:f64,y0:f64,x1:f64,y1:f64,direct:bool,noDispatch:bool) : void {
		this.areaAniPaused = false;
		if(direct) {
			this.area.set(x0, y0, x1, y1);
			this.currentArea.set(x0, y0, x1, y1);
		}
		else {
			this.areaAniPerc = 0;
			if(this.zIndex == 0) this.zIndex = 1;
			this.ani.limit = false;
		}
		this.targetArea.set(x0, y0, x1, y1);
		this.partialView(noDispatch);
	}

	private setTile(i:u32) : void {
		const r = this.rect; this.findTileRect(i);
		if(this.is360) {
			if(r.image.localIdx == 0) this.webgl.setTile360(r.x0, r.y0,r.x1-r.x0,r.y1-r.y0);
			else r.image.setDrawRect(r);
		}
		else { const v = this.main.vertexBuffer, a:f32 = <f32>this.aspect;
			unchecked(v[0] = v[3] = v[9] = ((<f32>r.x0-.5) * a)); // left
			unchecked(v[1] = v[7] = v[16] = (.5-<f32>r.y0));      // top
			unchecked(v[4] = v[10] = v[13] = (.5-<f32>r.y1));     // bottom
			unchecked(v[6] = v[12] = v[15] = (<f32>r.x1-.5) * a); // right
			// For grids, fancy transition here
			//if(this.parent && this.main.gridTransitionDuration > 0) unchecked(v[2] = v[5] = v[8] = v[11] = v[14] = v[17] = (<f32>this.bOpacity - 1)*.25);
		}
	}

	sendViewport() : void {
		const c = this.main.el;
		viewportSet(this, this.el.left/c.ratio, this.el.top/c.ratio, this.el.width/c.ratio, this.el.height/c.ratio);
	}

	private findTileRect(i:u32) : void {
		// Find out image
		let img:i32=0; while(i >= unchecked(this.images[img].endOffset)) img++;
		const image = unchecked(this.images[img]);

		// Find out layer
		let l:u32=0; while(i >= unchecked(image.layers[l]).end) l++;
		const layer = unchecked(image.layers[l]);

		layer.getTileRect(i, this.rect);
	}

	// Only for grid containers -- keep the resolution same as screen
	resize() : void {
		if(this.children.length) {
			const c = this.main.el;
			this.width = c.width;
			this.height = c.height;
		}
		if(!this.hasParent) {
			if(this.is360) this.webgl.resize();
			else {
				this.camera.setCanvas();
				this.webgl.update();
			}
		}
	}

	reset() : void {
		this.kinetic.stop();
		this.ani.stop();
		const mainImage = unchecked(this.images[0]);
		mainImage.gotBase = 0;
		mainImage.opacity = 0;
	}

	remove() : void {
		this.setVisible(false);
		this.main.remove(this);
	}

	replace() : void {
		this.main.canvases.push(this);
	}

	// For gallery
	setActiveLayer(idx:i32) : void {
		this.layer = idx;
		this.setActiveImage(this.activeImageIdx, 0);
		this.view.changed = true;
	}

	setActiveImage(idx:i32, num:i32) : void {
		const offset = this.layer * (this.images.length / this.numLayers);
		for(let i=0;i<this.images.length;i++) {
			const im = unchecked(this.images[i]);
			const diff = i-offset-idx;
			if(diff != 0) im.tOpacity = diff>=0 && diff <= num ? 1 : 0;
			else {
				im.tOpacity = 1;
				this.activeImageIdx = idx;
				this.view.changed = true;
			}
		}
		this.camera.correctMinMax();
	}

	setFocus(x0:f64, y0:f64, x1:f64, y1:f64, noLimit:bool) : void {
		if(this.focus.x0 == x0 && this.focus.x1 == x1 && this.focus.y0 == y0 && this.focus.y1 == y1) return;
		this.activeImageIdx = -1;
		for(let i=0;i<this.images.length;i++) {
			const im = unchecked(this.images[i]);
			if(im.x1 <= x0 || im.x0 >= x1 || im.y1 <= y0 || im.y0 >= y1) im.tOpacity = 0;
			else { im.tOpacity = 1; this.activeImageIdx = i; }
		}
		this.focus.set(x0, y0, x1, y1);
		this.camera.correctMinMax();
		if(!noLimit) {
			this.camera.setView();
			this.webgl.update();
		}
	}

	// Views, coords
	getCoo(x: f64, y: f64, abs: bool, noLimit: bool) : Float64Array {
		return (this.is360 ? this.webgl.getCoo(x,y) : this.camera.getCoo(x, y, abs, noLimit)).toArray()
	}

	getXY(x: f64, y: f64, abs: bool, radius:f64, rotation:f64) : Float64Array { return (this.is360 ? this.webgl.getXYZ(x,y) : !isNaN(radius) ? this.camera.getXYOmni(x, y, radius, isNaN(rotation) ? 0 : rotation, abs) : this.camera.getXY(x, y, abs)).toArray() }

	getView() : Float64Array { return this.view.arr }
	setView(x0: f64, y0: f64, x1: f64, y1: f64, noLimit: bool, noLastView: bool, correctNorth: bool = false, forceLimit: bool = false) : void {
		const mE = this.main.el;

		// For limiting setting a view in a certain px area
		if(mE.areaHeight > 0) { y1 += (y1-y0) / (1-(mE.areaHeight / mE.height)); this.ani.limit = false; mE.areaHeight = 0; };
		if(mE.areaWidth > 0) { x1 += (x1-x0) * (mE.areaWidth / mE.width); this.ani.limit = false; mE.areaWidth = 0; };
		if(noLimit) this.ani.limit = false;

		this.view.correct = correctNorth;
		this.view.set(x0, y0, x1, y1);
		if(forceLimit && !noLimit) this.view.limit(false);
		this.view.correct = false;
		if(!noLastView) this.ani.lastView.copy(this.view);

		if(this.width > 0) {
			if(this.is360) this.webgl.setView();
			else if(this.camera.setView()) this.webgl.update();
		}
	}

	// Camera
	getScale() : f64 { return this.is360 ? this.webgl.scale : this.camera.scale }
	isZoomedIn() : bool { return this.is360 ? this.webgl.perspective <= this.webgl.minPerspective : this.camera.isZoomedIn() }
	isZoomedOut(b:bool = false) : bool { return this.is360 ? this.webgl.perspective >= this.webgl.maxPerspective : this.camera.isZoomedOut(b) }

	// 360
	setDirection(yaw: f64, pitch: f64, resetPersp: bool) : void {
		if(isNaN(pitch)) pitch = this.webgl.pitch;
		this.webgl.setDirection(yaw, pitch, resetPersp ? this.webgl.defaultPerspective : 0);
	}
	getMatrix(x:f64,y:f64,s:f64,r:f64,rX:f64,rY:f64, rZ:f64,t:f64,sX:f64=1,sY:f64=1) : Float32Array {
		const fact:f64 = <f64>20000/this.width;
		return this.webgl.getMatrix(x,y,s*fact,r,rX,rY,rZ,t,sX,sY).toArray()
	}

	// Animations
	aniPause(time: f64) : void {
		this.areaAniPaused = true;
		this.ani.pause(time);
	};
	aniResume(time: f64) : void {
		this.areaAniPaused = false;
		this.ani.resume(time);
	};
	aniStop() : void {
		this.ani.stop();
		this.children.forEach(c => { c.aniStop() });
	}
}
