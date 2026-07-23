import { View, DrawRect, Viewport } from './shared';
import type { Engine } from './engine';
import type { MicrioImage } from '$core/image';
import { easeInOut } from './easing'
import { base360Distance } from './constants';

import Kinetic from './kinetic'
import Ani from './ani'
import Camera2D from './camera-2d'
import Image from './tile-image'
import Camera360 from './camera-360'
import EngineCamera from './engine-camera'

/**
 * Represents a single rendering canvas within the Micrio engine.
 * Orchestrates image loading, tile calculation, camera control, and drawing.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

/** @internal */
export class TileCanvas {
	readonly view!: View;

	readonly focus!: View;
	readonly _ani!: Ani;
	readonly _kinetic!: Kinetic;
	readonly _camera2d!: Camera2D;
	readonly _camera360!: Camera360;
	readonly camera!: EngineCamera;
	readonly #rect: DrawRect = new DrawRect;
	readonly el: Viewport = new Viewport;

	readonly images: Image[] = [];

	/** Cached diagonal (sqrt(w² + h²)), updated on resize. */
	_diagonal: number = 0;

	readonly #children: TileCanvas[] = [];
	readonly #area!: View;
	readonly #currentArea!: View;
	readonly #targetArea!: View;
	readonly visible!: View;
	readonly #full!: View;

	#areaAniPerc: number = 1;
	#areaAniPaused: boolean = false;

	#_zIndex: number = 0;
	#childrenDirty: boolean = false;

	get zIndex(): number { return this.#_zIndex; }
	set zIndex(v: number) {
		if (this.#_zIndex !== v) {
			this.#_zIndex = v;
			if (this.parent) this.parent.#childrenDirty = true;
		}
	}

	readonly _toDraw: number[] = [];

	readonly aspect: number;
	#index: number = 0;

	#isVisible: boolean = false;

	_opacity: number = 0;
	#bOpacity: number = 0;

	#isReady: boolean = false;
	_activeImageIdx: number = -1;

	_omniFieldOfView: number = 0;
	_omniVerticalAngle: number = 0;
	_omniDistance: number = 0;
	_omniOffsetX: number = 0;

	_limited: boolean = false;

	layer: number = 0;

	/** The MicrioImage that owns this canvas, if placed. Set by Engine. */
	_micrioImage?: MicrioImage;

	readonly #tileSize: number;
	readonly is360: boolean;
	readonly _noImage: boolean;
	readonly #isDeepZoom: boolean;
	readonly _freeMove: boolean;
	readonly _coverStart: boolean;
	readonly maxScale: number;
	readonly _scaleMultiplier: number;
	readonly _camSpeed: number;
	readonly _rotationY: number;
	readonly #isGallerySwitch: boolean;
	readonly #pagesHaveBackground: boolean;
	readonly isOmni: boolean;
	readonly _pinchZoomOutLimit: boolean;
	readonly _omniNumLayers: number;

	readonly main: Engine;
	width: number;
	height: number;
	_targetOpacity: number;
	_coverLimit: boolean;
	readonly _hasParent: boolean;

	constructor(
		main: Engine,
		width: number,
		height: number,
		targetOpacity: number,
		coverLimit: boolean,
		tileSize: number,
		is360: boolean,
		noImage: boolean,
		isDeepZoom: boolean,
		freeMove: boolean,
		coverStart: boolean,
		maxScale: number,
		scaleMultiplier: number,
		camSpeed: number,
		rotationY: number,
		isGallerySwitch: boolean,
		pagesHaveBackground: boolean,
		isOmni: boolean,
		pinchZoomOutLimit: boolean,
		omniNumLayers: number,
		isSingle: boolean,
		omniStartLayer: number,
		hasParent: boolean = false
	) {
		this.main = main;
		this.width = width;
		this.height = height;
		this._targetOpacity = targetOpacity;
		this._coverLimit = coverLimit;
		this._hasParent = hasParent;
		this.#tileSize = tileSize;
		this.is360 = is360;
		this._noImage = noImage;
		this.#isDeepZoom = isDeepZoom;
		this._freeMove = freeMove;
		this._coverStart = coverLimit ? true : coverStart;
		this.maxScale = maxScale;
		this._scaleMultiplier = scaleMultiplier;
		this._camSpeed = camSpeed;
		this._rotationY = rotationY;
		this.#isGallerySwitch = isGallerySwitch;
		this.#pagesHaveBackground = pagesHaveBackground;
		this.isOmni = isOmni;
		this._pinchZoomOutLimit = pinchZoomOutLimit;
		this._omniNumLayers = omniNumLayers;
		this.#index = main._canvases.length;
		if (!hasParent) main._canvases.push(this);

		this.aspect = width / height;
		this._diagonal = Math.sqrt(width * width + height * height);

		this.view = new View(this);
		this.focus = new View(this);
		this._ani = new Ani(this);
		this._kinetic = new Kinetic(this);
		this._camera2d = new Camera2D(this);
		this._camera360 = new Camera360(this);
		this.camera = this.is360 ? this._camera360 : this._camera2d;
		this.#area = new View(this);
		this.#currentArea = new View(this);
		this.#targetArea = new View(this);
		this.visible = new View(this);
		this.#full = new View(this);

		if (is360) { this.view.set(0.5, 0.5, 1, 0.5); }

		if (!hasParent) {
			this.el._copy(main.el);
			this.setView(this.view._centerX, this.view._centerY, this.view.width, this.view.height, false, false);
			this.resize();
		}

		if (!noImage) this._addImage(0, 0, 1, 1, width, height, tileSize, isSingle, isDeepZoom, false, targetOpacity);
		else {
			this.main._numImages++;
			this.#bOpacity = 1;
			this._opacity = 1;
			this.#isReady = true;
			if (omniStartLayer > 0) this._setActiveLayer(omniStartLayer);
		}
	}

	/** Reference to the parent canvas (if this is a child/grid item). */
	parent!: TileCanvas;

	/** Sets the parent canvas for a child canvas. */
	#setParent(parent: TileCanvas): void {
		this.parent = parent;
		this.#index += parent.#children.length;
	}

	/**
	 * Adds an image source (usually tiled) to this canvas.
	 */
	_addImage(x0: number, y0: number, x1: number, y1: number, w: number, h: number,
		tileSize: number, isSingle: boolean, isDeepZoom: boolean, isVideo: boolean,
		opa: number, rotX: number = 0, rotY: number = 0, rotZ: number = 0, scale: number = 1, fromScale: number = 0): Image {
		const image = new Image(
			this,
			this.main._numImages++,
			this.images.length,
			w, h, tileSize,
			isSingle, isDeepZoom, isVideo,
			this.main._numTiles,
			opa, opa, rotX, rotY, rotZ, scale, fromScale);
		image._setArea(x0, y0, x1, y1);
		this.images.push(image);
		this.main._numTiles = image._endOffset;
		if (this.images.length === 1) this._setActiveImage(0);
		return image;
	}

	_addChild(x0: number, y0: number, x1: number, y1: number,
		width: number, height: number,
		opts: { coverLimit?: boolean; coverStart?: boolean } = {}
	): TileCanvas {
		const coverLimit = opts.coverLimit ?? true;
		const coverStart = opts.coverStart ?? true;
		const c = new TileCanvas(
			this.main, width, height, 1, coverLimit,
			this.#tileSize,
			false,                                     // is360
			false,                                     // noImage
			this.main._hasArchive || this.#isDeepZoom,  // isDeepZoom
			false,                                     // freeMove
			coverStart,
			1,                                         // maxScale
			1,                                         // scaleMultiplier
			this._camSpeed,
			0,                                         // rotationY
			false,                                     // isGallerySwitch
			false,                                     // pagesHaveBackground
			false,                                     // isOmni
			this._pinchZoomOutLimit,
			1,                                         // omniNumLayers
			false,                                     // isSingle
			0,                                         // omniStartLayer
			true                                       // hasParent
		);
		c.#setParent(this);
		c._setArea(x0, y0, x1, y1, true, true);
		this.#children.push(c);
		return c;
	}

	/** Steps the opacity fade animation and applies 360 transition movement. */
	#stepOpacity(): void {
		const fadeDuration = this.main._distanceX !== 0 || this.main._distanceY !== 0
			? this.main._spacesTransitionDuration
			: this.main._canvases.length === 1 ? .25 : this.main._crossfadeDuration;
		const delta: number = (1 / fadeDuration) / this.main._frameTime;
		const fadingIn: boolean = this._targetOpacity > 0 && this._targetOpacity >= this._opacity;
		this._opacity = fadingIn ? Math.min(1, this._opacity + delta) : Math.max(0, this._opacity - delta);
		this.#bOpacity = easeInOut.get(this._opacity);

		if (this.main._distanceX !== 0 || this.main._distanceY !== 0) {
			const fact: number = this._opacity === 0 ? 0 : easeInOut.get(1 - this._opacity) * (fadingIn ? 1 : -1);
			this._camera360._moveTo(
				this.main._distanceX * fact * base360Distance,
				this.main._distanceY * fact * base360Distance,
				this.main._direction);
		}
	}

	/** Notifies the JS host about visibility changes. */
	#setCanvasVisible(b: boolean): void {
		this._micrioImage?.visible?.set(b);
		this.#isVisible = b;
	}

	/** Initiates a fade-out animation. */
	_fadeOut(): void {
		this._targetOpacity = 0;
		this.zIndex = 0;
	}

	/** Initiates a fade-in animation. */
	_fadeIn(): void {
		this.#isReady = true;
		if (!this._hasParent && this.#currentArea.width === 1 && this.#currentArea.height === 1)
			for (let i = 0; i < this.main._canvases.length; i++)
				if (this.main._canvases[i] !== this)
					this.main._canvases[i]._fadeOut();
		this._targetOpacity = 1;
	}

	/** Checks if the canvas area is currently animating. */
	_areaAnimating(): boolean {
		return !this.#areaAniPaused && this.#areaAniPerc < 1;
	}

	/** Checks if the canvas is effectively hidden. */
	#isHidden(): boolean {
		return (this._targetOpacity === 0 && this._opacity === 0)
			|| (this.#currentArea.width === 0 || this.#currentArea.height === 0);
	}

	/** Determines if the canvas needs to be drawn in the next frame and calculates tiles needed. */
	_shouldDraw(): void {
		if (!this._areaAnimating() && this.#isHidden()) {
			if (this.#isVisible) this.#setCanvasVisible(false);
			return;
		}

		let animating: boolean = this._ani.step() < 1
			|| this._kinetic.step() < 1 || !this.#isReady;

		this._toDraw.length = 0;

		if (this.#partialView(false)) animating = true;

		if (!this.is360 && !this._areaAnimating() && (this.visible.width <= 0 || this.visible.height <= 0)) {
			if (this.#isVisible) this.#setCanvasVisible(false);
			return;
		}

		if (!this.#isVisible && this._opacity >= 1) this.#setCanvasVisible(true);

		this._camera360._calculate3DFrustum();

		if (this.#isReady && this._opacity !== this._targetOpacity) {
			this.#stepOpacity();
			animating = true;
		}

		const scale: number = (this.is360 ? this._camera360._scale : this._camera2d._scale) * this.el.scale;

		const m = this.main;

		for (let i = 0; i < this.images.length; i++) {
			const image = this.images[i];
			if (!image._shouldRender()) {
				if (image._doRender) m.setImageVisible(image, image._doRender = false);
			}
			else {
				if (i > 0 && !image._doRender) m.setImageVisible(image, image._doRender = true);
				if (image._isVideo && image._isVideoPlaying) animating = true;
				if (image._opacityTick(this.#isGallerySwitch || this._opacity < 1)) animating = true;
				if (image.opacity > 0) m._doneTotal += image._getTiles(scale);
			}
		}

		m._toDrawTotal += this._toDraw.length;
		m._progress = m._toDrawTotal === 0 ? 1
			: m._doneTotal / m._toDrawTotal;

		for (let i = 0; i < this.#children.length; i++)
			this.#children[i]._shouldDraw();

		if (animating) m._animating = true;
	}

	/** Executes the drawing commands for the current frame for this canvas. */
	_draw(): void {
		if (this._targetOpacity === 0 && this._opacity === 0) return;

		const m = this.main;
		const gl = m.micrio.webgl;
		const el = this.el;
		const v = this.view;

		const animating = this._ani.isStarted();

		gl.gl.viewport(this.el.left, m.el.height - el.height - el.top, el.width, el.height);

		gl.gl.uniformMatrix4fv(gl.pmLoc, false, this._camera360._pMatrix.arr);

		if (this.#pagesHaveBackground) for (let imgIdx = 0; imgIdx < this.images.length; imgIdx++) {
			const im = this.images[imgIdx];
			if (!(im.x1 <= v.x0 || im.x0 >= v.x1 || im.y1 <= v.y0 || im.y0 >= v.y1)) {
				this.#setTile(im._endOffset - 1);
				gl.drawTile(undefined, im._tOpacity);
			}
		}

		const r = this.#rect;
		for (let j = 0; j < this._toDraw.length; j++) {
			const i: number = this._toDraw[j];
			this.#setTile(i);

			const isTargetLayer = r.layer === r.image._targetLayer - 1 || (!m._bareBone && r.layer === r.image._targetLayer);
			const isBaseTile = i === r.image._endOffset - 1;
			const opa = m.getTileOpacity(i);

			if ((isTargetLayer || opa === 1 || isBaseTile) && m.drawTile(r.image._index, i, r.layer,
				r.x, r.y, opa * this.#bOpacity * r.image.opacity, animating, r.layer === r.image._targetLayer - 1)
				&& isBaseTile) {
				r.image._gotBase = m.now;
				if (!this.#isReady) this._fadeIn();
			}
		}

		if (this.#childrenDirty) {
			this.#children.sort((a, b) => a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0);
			this.#childrenDirty = false;
		}
		for (let i = 0; i < this.#children.length; i++)
			this.#children[i]._draw();

		if (v._changed) this._micrioImage?.camera?.viewChanged();
		v._changed = false;
	}

	#partialView(noDispatch: boolean): boolean {
		const c = this.main.el;
		const hP = this._hasParent;
		const s = hP ? this.parent.getScale() : 1 / c.ratio;
		const pW = hP ? this.parent.width : c.width;
		const pH = hP ? this.parent.height : c.height;
		const pV = hP ? this.parent.view : this.#full;
		const v = this.view;
		const a = this.#currentArea;
		const b = this.#area;
		const t = this.#targetArea;

		const animating = this._areaAnimating();

		if (animating) {
			const delta: number = (1 / this.main._gridTransitionDuration) / this.main._frameTime;
			this.#areaAniPerc = Math.min(1, this.#areaAniPerc + delta);
			const p = this.main._gridTransitionTimingFunction.get(this.#areaAniPerc);
			const interpCenterX = (b._centerX + (t._centerX - b._centerX) * p);
			const interpCenterY = (b._centerY + (t._centerY - b._centerY) * p);
			const interpWidth = (b.width + (t.width - b.width) * p);
			const interpHeight = (b.height + (t.height - b.height) * p);
			a.set(interpCenterX, interpCenterY, interpWidth, interpHeight);
			if (this.#areaAniPerc === 1) {
				if (this.zIndex === 1) this.zIndex = 0;
				b._copy(t);
			}
			this.view._changed = true;
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
		const fadingOut = this._targetOpacity < this._opacity;
		if (!fadingOut && this.el.set(
			a.width * s * pW,
			a.height * s * pH,
			(a.x0 - pV.x0) * pW * s,
			(a.y0 - pV.y0) * pH * s,
			ratio,
			hP ? 1 : c.scale,
			hP ? false : c.isPortrait
		)) {
			if (!noDispatch) this._sendViewport();
			this.view._changed = true;
			this.resize();
			if (!this.is360) {
				this._camera2d.setCanvas();
				this._camera2d._updateProjection();
			}
		}

		return animating;
	}

	/** Sets the target area for this canvas within its parent, optionally animating. */
	_setArea(x0: number, y0: number, x1: number, y1: number, direct: boolean, noDispatch: boolean): void {
		this.#areaAniPaused = false;
		if (direct) {
			this.#area._setArea(x0, y0, x1, y1);
			this.#currentArea._setArea(x0, y0, x1, y1);
		}
		else {
			this.#area._copy(this.#currentArea);
			this.#areaAniPerc = 0;
			if (this.zIndex === 0) this.zIndex = 1;
			this._ani.limit = false;
		}
		this.#targetArea._setArea(x0, y0, x1, y1);
		this.#partialView(noDispatch);
		this._sendViewport();
	}

	/** Calculates the vertex positions for a given tile index and updates the vertex buffer. */
	#setTile(i: number): void {
		const r = this.#rect; this.#findTileRect(i);
		if (this.is360) {
			if (r.image._localIdx === 0) this._camera360._setTile360(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
			else r.image._setDrawRect(r);
		}
		else {
			const v = this.main._vertexBuffer, a = this.aspect;
			v[0] = v[3] = v[9] = ((r.x0 - .5) * a);
			v[1] = v[7] = v[16] = (.5 - r.y0);
			v[4] = v[10] = v[13] = (.5 - r.y1);
			v[6] = v[12] = v[15] = ((r.x1 - .5) * a);
			v[2] = v[5] = v[8] = v[11] = v[14] = v[17] = 0;
		}
	}

	/** Notifies JS host about the current screen viewport details. */
	_sendViewport(): void {
		const c = this.main.el;
		this._micrioImage?.viewport?.set([this.el.left / c.ratio, this.el.top / c.ratio, this.el.width / c.ratio, this.el.height / c.ratio]);
	}

	/** Finds the Image, Layer, and calculates the DrawRect for a given global tile index. */
	#findTileRect(i: number): void {
		let img = 0; while (i >= this.images[img]._endOffset) img++;
		const image = this.images[img];

		let l = 0; while (i >= image._layers[l]._end) l++;
		const layer = image._layers[l];

		layer.getTileRect(i, this.#rect);
	}

	/** Handles resizing of the canvas element. */
	resize(): void {
		if (this.#children.length) {
			const c = this.main.el;
			this.width = c.width;
			this.height = c.height;
			this._diagonal = Math.sqrt(c.width * c.width + c.height * c.height);
		}
		if (!this._hasParent) {
			if (this.is360) this._camera360._resize();
			else {
				this._camera2d.setCanvas();
				this._camera2d._updateProjection();
			}
		}
	}

	/** Resets the canvas state. */
	reset(): void {
		this._kinetic.stop();
		this._ani.stop();
		if (this.images.length > 0) {
			const mainImage = this.images[0];
			mainImage._gotBase = 0;
			mainImage.opacity = 0;
		}
	}

	/** Removes this canvas instance from the main controller. */
	remove(): void {
		this.#setCanvasVisible(false);
		this.main.remove(this);
	}

	/** Sets the active layer for multi-layer omni objects. */
	_setActiveLayer(idx: number): void {
		this.layer = idx;
		this._setActiveImage(this._activeImageIdx);
		this.view._changed = true;
	}

	/** Sets the active image(s) for gallery/omni canvases. */
	_setActiveImage(idx: number, num: number = 0): void {
		const offset = this.layer * (this.images.length / this._omniNumLayers);
		for (let i = 0; i < this.images.length; i++) {
			const im = this.images[i];
			const diff = i - offset - idx;
			if (diff !== 0) im._tOpacity = diff >= 0 && diff <= num ? 1 : 0;
			else {
				im._tOpacity = 1;
				this._activeImageIdx = idx;
				this.view._changed = true;
			}
		}
		this._camera2d._correctMinMax();
	}

	/** Sets the logical view directly. */
	setView(centerX: number, centerY: number, width: number, height: number, noLimit: boolean, noLastView: boolean, correctNorth: boolean = false, forceLimit: boolean = false): void {
		const mE = this.main.el;

		if (mE.areaHeight > 0) { height += height / (1 - (mE.areaHeight / mE.height)); this._ani.limit = false; mE.areaHeight = 0; };
		if (mE.areaWidth > 0) { width += width * (mE.areaWidth / mE.width); this._ani.limit = false; mE.areaWidth = 0; };
		if (noLimit) this._ani.limit = false;

		this.view.set(centerX, centerY, width, height);
		if (forceLimit && !noLimit) this.view._limit(false, false, this._freeMove);
		if (!noLastView) this._ani.lastView._copy(this.view);

		if (this.width > 0) {
			if (this.is360) {
				this._camera360._setView(centerX, centerY, width, height, { noLimit, correctNorth });
				this.view.set(centerX, centerY, width, height);
			} else if (this._camera2d.applyView()) {
				this._camera2d._updateProjection();
			}
		}
	}

	getScale(): number { return this.is360 ? this._camera360._scale : this._camera2d._scale }
	_isZoomedIn(): boolean { const c360 = this._camera360; return this.is360 ? c360._perspective <= c360._minPerspective : this._camera2d._isZoomedIn() }
	_isZoomedOut(b: boolean = false): boolean { const c360 = this._camera360; return this.is360 ? c360._perspective >= c360._maxPerspective : this._camera2d._isZoomedOut(b) }

	_correctMinMax(noLimit?: boolean): void { this._camera2d._correctMinMax(noLimit); }

	_setMinScale(s: number): void {
		const c2d = this._camera2d;
		c2d._minScale = s;
		c2d._correctMinMax();
		c2d.applyView();
		this._camera360._update();
	}

	_setDirection(yaw: number, pitch: number, resetPersp: boolean = false): void {
		if (isNaN(pitch)) pitch = this._camera360._pitch;
		this._camera360._setDirection(yaw, pitch, resetPersp ? this._camera360._defaultPerspective : 0);
	}
	_getMatrix(x: number, y: number, s: number, r: number, rX: number, rY: number, rZ: number, t: number, sX: number = 1, sY: number = 1, noCorrectNorth: boolean = false): Float32Array {
		const fact: number = 20000 / this.width;
		return this._camera360._getMatrix(x, y, s * fact, r, rX, rY, rZ, t, sX, sY, noCorrectNorth).arr
	}

	_aniPause(): void {
		this.#areaAniPaused = true;
		this._ani.pause();
	};
	_aniResume(): void {
		this.#areaAniPaused = false;
		this._ani.resume();
	};
	_aniStop(): void {
		this._ani.stop();
		for (let i = 0; i < this.#children.length; i++) this.#children[i]._aniStop();
	}

	_aniDone(): void {
		const cam = this._micrioImage?.camera;
		if (!cam) return;
		if (cam._aniDone) cam._aniDone();
		while (cam._aniDoneAdd.length) cam._aniDoneAdd.shift()?.();
		cam._aniAbort = cam._aniDone = undefined;
	}
	_aniAbort(): void {
		const cam = this._micrioImage?.camera;
		if (!cam) return;
		if (cam._aniAbort) cam._aniAbort();
		cam._aniDoneAdd.length = 0;
		cam._aniAbort = cam._aniDone = undefined;
	}
}
