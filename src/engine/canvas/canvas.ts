/**
 * Represents a single rendering canvas within the Micrio engine.
 * Orchestrates image loading, tile calculation, camera control, and drawing.
 * @author Marcel Duin <marcel@micr.io>
 */

import { View, DrawRect, Viewport } from '../shared/shared';
import { Main } from '../main';
import { easeInOut } from '../utils/utils'
import { base360Distance } from '../globals';

import Kinetic from '../camera/kinetic'
import Ani from '../camera/ani'
import Camera from '../camera/camera'
import Image from './image'
import SphericalView from '../webgl/webgl'

export interface TileCanvasConfig {
	tileSize: number;
	is360: boolean;
	noImage: boolean;
	isSingle: boolean;
	freeMove: boolean;
	coverStart: boolean;
	maxScale: number;
	scaleMultiplier: number;
	camSpeed: number;
	rotationY: number;
	isGallerySwitch: boolean;
	pagesHaveBackground: boolean;
	isOmni: boolean;
	pinchZoomOutLimit: boolean;
	omniNumLayers: number;
	omniStartLayer: number;
}

export default class TileCanvas {
	readonly view!: View;

	readonly focus!: View;
	readonly ani!: Ani;
	readonly kinetic!: Kinetic;
	readonly camera!: Camera;
	readonly webgl!: SphericalView;
	readonly rect: DrawRect = new DrawRect;
	readonly el: Viewport = new Viewport;

	readonly images: Image[] = [];

	private readonly children: TileCanvas[] = [];
	readonly area!: View;
	readonly currentArea!: View;
	readonly targetArea!: View;
	readonly visible!: View;
	readonly full!: View;

	private areaAniPerc: number = 1;
	private areaAniPaused: boolean = false;

	private _zIndex: number = 0;
	private childrenDirty: boolean = false;

	get zIndex(): number { return this._zIndex; }
	set zIndex(v: number) {
		if (this._zIndex !== v) {
			this._zIndex = v;
			if (this.parent) this.parent.childrenDirty = true;
		}
	}

	readonly toDraw: number[] = [];

	readonly aspect: number;
	private index: number = 0;

	private isVisible: boolean = false;

	opacity: number = 0;
	bOpacity: number = 0;

	isReady: boolean = false;
	activeImageIdx: number = -1;

	omniFieldOfView: number = 0;
	omniVerticalAngle: number = 0;
	omniDistance: number = 0;
	omniOffsetX: number = 0;

	limited: boolean = false;

	layer: number = 0;

	readonly tileSize: number;
	readonly is360: boolean;
	readonly noImage: boolean;
	readonly isSingle: boolean;
	readonly freeMove: boolean;
	readonly coverStart: boolean;
	readonly maxScale: number;
	readonly scaleMultiplier: number;
	readonly camSpeed: number;
	readonly rotationY: number;
	readonly isGallerySwitch: boolean;
	readonly pagesHaveBackground: boolean;
	readonly isOmni: boolean;
	readonly pinchZoomOutLimit: boolean;
	readonly omniNumLayers: number;
	readonly omniStartLayer: number;

	constructor(
		readonly main: Main,

		public width: number,
		public height: number,
		public targetOpacity: number,

		public coverLimit: boolean,
		cfg: TileCanvasConfig,
		readonly hasParent: boolean = false
	) {
		this.tileSize = cfg.tileSize;
		this.is360 = cfg.is360;
		this.noImage = cfg.noImage;
		this.isSingle = cfg.isSingle;
		this.freeMove = cfg.freeMove;
		this.coverStart = coverLimit ? true : cfg.coverStart;
		this.maxScale = cfg.maxScale;
		this.scaleMultiplier = cfg.scaleMultiplier;
		this.camSpeed = cfg.camSpeed;
		this.rotationY = cfg.rotationY;
		this.isGallerySwitch = cfg.isGallerySwitch;
		this.pagesHaveBackground = cfg.pagesHaveBackground;
		this.isOmni = cfg.isOmni;
		this.pinchZoomOutLimit = cfg.pinchZoomOutLimit;
		this.omniNumLayers = cfg.omniNumLayers;
		this.omniStartLayer = cfg.omniStartLayer;
		this.index = main.canvases.length;
		if (!hasParent) main.canvases.push(this);

		this.aspect = width / height;

		this.view = new View(this);
		this.focus = new View(this);
		this.ani = new Ani(this);
		this.kinetic = new Kinetic(this);
		this.camera = new Camera(this);
		this.webgl = new SphericalView(this);
		this.area = new View(this);
		this.currentArea = new View(this);
		this.targetArea = new View(this);
		this.visible = new View(this);
		this.full = new View(this);

		if (cfg.is360) { this.view.set(0.5, 0.5, 1, 0.5); }

		if (!hasParent) {
			this.el.copy(main.el);
			this.setView(this.view.centerX, this.view.centerY, this.view.width, this.view.height, false, false);
			this.resize();
		}

		if (!cfg.noImage) this.addImage(0, 0, 1, 1, width, height, cfg.tileSize, cfg.isSingle, false, targetOpacity, 0, 0, 0, 1, 0);
		else {
			this.main.numImages++;
			this.bOpacity = 1;
			this.opacity = 1;
			this.isReady = true;
			if (cfg.omniStartLayer > 0) this.setActiveLayer(cfg.omniStartLayer);
		}
	}

	/** Reference to the parent canvas (if this is a child/grid item). */
	parent!: TileCanvas;

	/** Sets the parent canvas for a child canvas. */
	setParent(parent: TileCanvas): void {
		this.parent = parent;
		this.index += parent.children.length;
	}

	/**
	 * Adds an image source (usually tiled) to this canvas.
	 */
	addImage(x0: number, y0: number, x1: number, y1: number, w: number, h: number,
		tileSize: number, isSingle: boolean, isVideo: boolean,
		opa: number, rotX: number, rotY: number, rotZ: number, scale: number, fromScale: number): Image {
		const image = new Image(
			this,
			this.main.numImages++,
			this.images.length,
			w, h, tileSize,
			isSingle, isVideo,
			this.main.numTiles,
			opa, opa, rotX, rotY, rotZ, scale, fromScale);
		image.setArea(x0, y0, x1, y1);
		this.images.push(image);
		this.main.numTiles = image.endOffset;
		if (this.images.length === 1) this.setActiveImage(0, 0);
		return image;
	}

	addChild(x0: number, y0: number, x1: number, y1: number,
		width: number, height: number): TileCanvas {
		const c = new TileCanvas(
			this.main, width, height, 1, true, {
				tileSize: this.tileSize,
				is360: false,
				noImage: false,
				isSingle: false,
				freeMove: false,
				coverStart: true,
				maxScale: 1,
				scaleMultiplier: 1,
				camSpeed: this.camSpeed,
				rotationY: 0,
				isGallerySwitch: false,
				pagesHaveBackground: false,
				isOmni: false,
				pinchZoomOutLimit: this.pinchZoomOutLimit,
				omniNumLayers: 1,
				omniStartLayer: 0,
			}, true
		);
		c.setParent(this);
		c.setArea(x0, y0, x1, y1, true, true);
		this.children.push(c);
		return c;
	}

	/** Steps the opacity fade animation and applies 360 transition movement. */
	private stepOpacity(): void {
		const fadeDuration = this.main.distanceX !== 0 || this.main.distanceY !== 0
			? this.main.spacesTransitionDuration
			: this.main.canvases.length === 1 ? .25 : this.main.crossfadeDuration;
		const delta: number = (1 / fadeDuration) / this.main.frameTime;
		const fadingIn: boolean = this.targetOpacity > 0 && this.targetOpacity >= this.opacity;
		this.opacity = fadingIn ? Math.min(1, this.opacity + delta) : Math.max(0, this.opacity - delta);
		this.bOpacity = easeInOut.get(this.opacity);

		if (this.main.distanceX !== 0 || this.main.distanceY !== 0) {
			const fact: number = this.opacity === 0 ? 0 : easeInOut.get(1 - this.opacity) * (fadingIn ? 1 : -1);
			this.webgl.moveTo(
				this.main.distanceX * fact * base360Distance,
				this.main.distanceY * fact * base360Distance,
				this.main.direction,
				0);
		}
	}

	/** Notifies the JS host about visibility changes. */
	setVisible(b: boolean): void {
		this.main.setVisible(this, b);
		this.isVisible = b;
	}

	/** Initiates a fade-out animation. */
	fadeOut(): void {
		this.targetOpacity = 0;
		this.zIndex = 0;
	}

	/** Initiates a fade-in animation. */
	fadeIn(): void {
		this.isReady = true;
		if (!this.hasParent && this.currentArea.width === 1 && this.currentArea.height === 1)
			for (let i = 0; i < this.main.canvases.length; i++)
				if (this.main.canvases[i] !== this)
					this.main.canvases[i].fadeOut();
		this.targetOpacity = 1;
	}

	/** Checks if the canvas area is currently animating. */
	areaAnimating(): boolean {
		return !this.areaAniPaused && this.areaAniPerc < 1;
	}

	/** Checks if the canvas is effectively hidden. */
	isHidden(): boolean {
		return (this.targetOpacity === 0 && this.opacity === 0)
			|| (this.currentArea.width === 0 || this.currentArea.height === 0);
	}

	/** Determines if the canvas needs to be drawn in the next frame and calculates tiles needed. */
	shouldDraw(): void {
		if (!this.areaAnimating() && this.isHidden()) {
			if (this.isVisible) this.setVisible(false);
			return;
		}

		if (!this.isVisible && this.opacity >= 1) this.setVisible(true);

		let animating: boolean = this.ani.step(this.main.now) < 1
			|| this.kinetic.step(this.main.now) < 1 || !this.isReady;

		this.toDraw.length = 0;

		if (this.partialView(false)) animating = true;

		if (!this.is360 && (this.visible.width <= 0 || this.visible.height <= 0)) return;

		this.webgl.calculate3DFrustum();

		if (this.isReady && this.opacity !== this.targetOpacity) {
			this.stepOpacity();
			animating = true;
		}

		const scale: number = (this.is360 ? this.webgl.scale : this.camera.scale) * this.el.scale;

		for (let i = 0; i < this.images.length; i++) {
			const image = this.images[i];
			if (!image.shouldRender()) {
				if (image.doRender) this.main.setVisible2(image, image.doRender = false);
			}
			else {
				if (i > 0 && !image.doRender) this.main.setVisible2(image, image.doRender = true);
				if (image.isVideo && image.isVideoPlaying) animating = true;
				if (image.opacityTick(this.isGallerySwitch || this.opacity < 1)) animating = true;
				if (image.opacity > 0) this.main.doneTotal += image.getTiles(scale);
			}
		}

		this.main.toDrawTotal += this.toDraw.length;
		this.main.progress = this.main.toDrawTotal === 0 ? 1
			: this.main.doneTotal / this.main.toDrawTotal;

		this.view.toArray();

		for (let i = 0; i < this.children.length; i++)
			this.children[i].shouldDraw();

		if (animating) this.main.animating = true;
	}

	/** Executes the drawing commands for the current frame for this canvas. */
	draw(): void {
		if (this.targetOpacity === 0 && this.opacity === 0) return;

		const animating = this.ani.isStarted();

		this.main.setViewport(this.el.left, this.main.el.height - this.el.height - this.el.top, this.el.width, this.el.height);

		this.main.setMatrix(this.webgl.pMatrix.arr);

		if (this.pagesHaveBackground) for (let imgIdx = 0; imgIdx < this.images.length; imgIdx++) {
			const im = this.images[imgIdx];
			if (!(im.x1 <= this.view.x0 || im.x0 >= this.view.x1 || im.y1 <= this.view.y0 || im.y0 >= this.view.y1)) {
				this.setTile(im.endOffset - 1);
				this.main.drawQuad(im.tOpacity);
			}
		}

		const r = this.rect;
		for (let j = 0; j < this.toDraw.length; j++) {
			const i: number = this.toDraw[j];
			this.setTile(i);

			const isTargetLayer = r.layer === r.image.targetLayer - 1 || (!this.main.bareBone && r.layer === r.image.targetLayer);
			const isBaseTile = i === r.image.endOffset - 1;
			const opa = this.main.getTileOpacity(i);

			if ((isTargetLayer || opa === 1 || isBaseTile) && this.main.drawTile(r.image.index, i, r.layer,
				r.x, r.y, opa * this.bOpacity * r.image.opacity, animating, r.layer === r.image.targetLayer - 1)
				&& isBaseTile) {
				r.image.gotBase = this.main.now;
				if (!this.isReady) this.fadeIn();
			}
		}

		if (this.childrenDirty) {
			this.children.sort((a, b) => a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0);
			this.childrenDirty = false;
		}
		for (let i = 0; i < this.children.length; i++)
			this.children[i].draw();

		if (this.view.changed) this.main.viewSet(this);
		this.view.changed = false;
	}

	private partialView(noDispatch: boolean): boolean {
		const c = this.main.el;
		const hP = this.hasParent;
		const s = hP ? this.parent.getScale() : 1 / c.ratio;
		const pW = hP ? this.parent.width : c.width;
		const pH = hP ? this.parent.height : c.height;
		const pV = hP ? this.parent.view : this.full;
		const v = this.view;
		const a = this.currentArea;
		const b = this.area;
		const t = this.targetArea;

		const animating = this.areaAnimating();

		if (animating) {
			const delta: number = (1 / this.main.gridTransitionDuration) / this.main.frameTime;
			this.areaAniPerc = Math.min(1, this.areaAniPerc + delta);
			const p = this.main.gridTransitionTimingFunction.get(this.areaAniPerc);
			const interpCenterX = (b.centerX + (t.centerX - b.centerX) * p);
			const interpCenterY = (b.centerY + (t.centerY - b.centerY) * p);
			const interpWidth = (b.width + (t.width - b.width) * p);
			const interpHeight = (b.height + (t.height - b.height) * p);
			a.set(interpCenterX, interpCenterY, interpWidth, interpHeight);
			if (this.areaAniPerc === 1) {
				if (this.zIndex === 1) this.zIndex = 0;
				b.copy(t);
			}
			this.view.changed = true;
		}

		let visX0 = Math.max(v.x0, v.x0 + (pV.x0 - a.x0) / a.width * v.width);
		let visX1 = Math.min(v.x1, v.x0 + (1 - (a.x1 - Math.min(a.x1, pV.x1)) / a.width) * v.width);
		if (!this.is360) {
			visX0 = Math.max(0, visX0);
			visX1 = Math.min(1, visX1);
		}
		let visY0 = Math.max(Math.max(0, v.y0), v.y0 + (pV.y0 - a.y0) / a.height * v.height);
		let visY1 = Math.min(Math.min(1, v.y1), v.y0 + (1 - (a.y1 - Math.min(a.y1, pV.y1)) / a.height) * v.height);
		visY0 = Math.max(visY0, 0);
		visY1 = Math.min(visY1, 1);

		const visCenterX = (visX0 + visX1) / 2;
		const visCenterY = (visY0 + visY1) / 2;
		const visWidth = visX1 - visX0;
		const visHeight = visY1 - visY0;

		this.visible.set(visCenterX, visCenterY, visWidth, visHeight);

		const ratio = hP ? 1 : c.ratio;
		const fadingOut = this.targetOpacity < this.opacity;
		if (!fadingOut && this.el.set(
			a.width * s * pW,
			a.height * s * pH,
			(a.x0 - pV.x0) * pW * s,
			(a.y0 - pV.y0) * pH * s,
			ratio,
			hP ? 1 : c.scale,
			hP ? false : c.isPortrait
		)) {
			if (!noDispatch) this.sendViewport();
			this.view.changed = true;
			this.resize();
			this.camera.setCanvas();
			this.webgl.update();
		}

		return animating;
	}

	/** Sets the target area for this canvas within its parent, optionally animating. */
	setArea(x0: number, y0: number, x1: number, y1: number, direct: boolean, noDispatch: boolean): void {
		this.areaAniPaused = false;
		if (direct) {
			this.area.setArea(x0, y0, x1, y1);
			this.currentArea.setArea(x0, y0, x1, y1);
		}
		else {
			this.area.copy(this.currentArea);
			this.areaAniPerc = 0;
			if (this.zIndex === 0) this.zIndex = 1;
			this.ani.limit = false;
		}
		this.targetArea.setArea(x0, y0, x1, y1);
		this.partialView(noDispatch);
	}

	/** Calculates the vertex positions for a given tile index and updates the vertex buffer. */
	private setTile(i: number): void {
		const r = this.rect; this.findTileRect(i);
		if (this.is360) {
			if (r.image.localIdx === 0) this.webgl.setTile360(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
			else r.image.setDrawRect(r);
		}
		else {
			const v = this.main.vertexBuffer, a = this.aspect;
			v[0] = v[3] = v[9] = ((r.x0 - .5) * a);
			v[1] = v[7] = v[16] = (.5 - r.y0);
			v[4] = v[10] = v[13] = (.5 - r.y1);
			v[6] = v[12] = v[15] = ((r.x1 - .5) * a);
			v[2] = v[5] = v[8] = v[11] = v[14] = v[17] = 0;
		}
	}

	/** Notifies JS host about the current screen viewport details. */
	sendViewport(): void {
		const c = this.main.el;
		this.main.viewportSet(this, this.el.left / c.ratio, this.el.top / c.ratio, this.el.width / c.ratio, this.el.height / c.ratio);
	}

	/** Finds the Image, Layer, and calculates the DrawRect for a given global tile index. */
	private findTileRect(i: number): void {
		let img = 0; while (i >= this.images[img].endOffset) img++;
		const image = this.images[img];

		let l = 0; while (i >= image.layers[l].end) l++;
		const layer = image.layers[l];

		layer.getTileRect(i, this.rect);
	}

	/** Handles resizing of the canvas element. */
	resize(): void {
		if (this.children.length) {
			const c = this.main.el;
			this.width = c.width;
			this.height = c.height;
		}
		if (!this.hasParent) {
			if (this.is360) this.webgl.resize();
			else {
				this.camera.setCanvas();
				this.webgl.update();
			}
		}
	}

	/** Resets the canvas state. */
	reset(): void {
		this.kinetic.stop();
		this.ani.stop();
		if (this.images.length > 0) {
			const mainImage = this.images[0];
			mainImage.gotBase = 0;
			mainImage.opacity = 0;
		}
	}

	/** Removes this canvas instance from the main controller. */
	remove(): void {
		this.setVisible(false);
		this.main.remove(this);
	}

	/** Re-adds this canvas instance to the main controller. */
	replace(): void {
		this.main.canvases.push(this);
	}

	/** Sets the active layer for multi-layer omni objects. */
	setActiveLayer(idx: number): void {
		this.layer = idx;
		this.setActiveImage(this.activeImageIdx, 0);
		this.view.changed = true;
	}

	/** Sets the active image(s) for gallery/omni canvases. */
	setActiveImage(idx: number, num: number): void {
		const offset = this.layer * (this.images.length / this.omniNumLayers);
		for (let i = 0; i < this.images.length; i++) {
			const im = this.images[i];
			const diff = i - offset - idx;
			if (diff !== 0) im.tOpacity = diff >= 0 && diff <= num ? 1 : 0;
			else {
				im.tOpacity = 1;
				this.activeImageIdx = idx;
				this.view.changed = true;
			}
		}
		this.camera.correctMinMax();
	}

	/** Sets the focus area for gallery/grid canvases. */
	setFocus(x0: number, y0: number, x1: number, y1: number, noLimit: boolean): void {
		const centerX = (x0 + x1) / 2;
		const centerY = (y0 + y1) / 2;
		const width = x1 - x0;
		const height = y1 - y0;

		if (this.focus.equals(centerX, centerY, width, height)) return;
		this.activeImageIdx = -1;
		for (let i = 0; i < this.images.length; i++) {
			const im = this.images[i];
			if (im.x1 <= x0 || im.x0 >= x1 || im.y1 <= y0 || im.y0 >= y1) im.tOpacity = 0;
			else { im.tOpacity = 1; this.activeImageIdx = i; }
		}
		this.focus.set(centerX, centerY, width, height);
		this.camera.correctMinMax();
		if (!noLimit) {
			this.camera.setView();
			this.webgl.update();
		}
	}

	/** Gets image coordinates from screen coordinates. */
	getCoo(x: number, y: number, abs: boolean, noLimit: boolean): Float64Array {
		return (this.is360 ? this.webgl.getCoo(x, y) : this.camera.getCoo(x, y, abs, noLimit)).toArray()
	}

	/** Gets screen coordinates from image coordinates. */
	getXY(x: number, y: number, abs: boolean, radius: number, rotation: number): Float64Array {
		return (this.is360 ? this.webgl.getXYZ(x, y) : !isNaN(radius) ? this.camera.getXYOmni(x, y, radius, isNaN(rotation) ? 0 : rotation, abs) : this.camera.getXY(x, y, abs)).toArray()
	}

	/** Gets the current logical view array. */
	getView(): Float64Array { return this.view.arr }
	/** Sets the logical view directly. */
	setView(centerX: number, centerY: number, width: number, height: number, noLimit: boolean, noLastView: boolean, correctNorth: boolean = false, forceLimit: boolean = false): void {
		const mE = this.main.el;

		if (mE.areaHeight > 0) { height += height / (1 - (mE.areaHeight / mE.height)); this.ani.limit = false; mE.areaHeight = 0; };
		if (mE.areaWidth > 0) { width += width * (mE.areaWidth / mE.width); this.ani.limit = false; mE.areaWidth = 0; };
		if (noLimit) this.ani.limit = false;

		this.view.set(centerX, centerY, width, height);
		if (forceLimit && !noLimit) this.view.limit(false, false, this.freeMove);
		if (!noLastView) this.ani.lastView.copy(this.view);

		if (this.width > 0) {
			if (this.is360) {
				this.webgl.setView(centerX, centerY, width, height, noLimit, correctNorth);
				this.view.set(centerX, centerY, width, height);
			} else if (this.camera.setView()) {
				this.webgl.update();
			}
		}
	}

	getScale(): number { return this.is360 ? this.webgl.scale : this.camera.scale }
	isZoomedIn(): boolean { return this.is360 ? this.webgl.perspective <= this.webgl.minPerspective : this.camera.isZoomedIn() }
	isZoomedOut(b: boolean = false): boolean { return this.is360 ? this.webgl.perspective >= this.webgl.maxPerspective : this.camera.isZoomedOut(b) }

	setDirection(yaw: number, pitch: number, resetPersp: boolean): void {
		if (isNaN(pitch)) pitch = this.webgl.pitch;
		this.webgl.setDirection(yaw, pitch, resetPersp ? this.webgl.defaultPerspective : 0);
	}
	getMatrix(x: number, y: number, s: number, r: number, rX: number, rY: number, rZ: number, t: number, sX: number = 1, sY: number = 1, noCorrectNorth: boolean = false): Float32Array {
		const fact: number = 20000 / this.width;
		return this.webgl.getMatrix(x, y, s * fact, r, rX, rY, rZ, t, sX, sY, noCorrectNorth).toArray()
	}

	aniPause(time: number): void {
		this.areaAniPaused = true;
		this.ani.pause(time);
	};
	aniResume(time: number): void {
		this.areaAniPaused = false;
		this.ani.resume(time);
	};
	aniStop(): void {
		this.ani.stop();
		for (let i = 0; i < this.children.length; i++) this.children[i].aniStop();
	}

	aniDone(): void { this.main.aniDone(this); }
	aniAbort(): void { this.main.aniAbort(this); }
}
