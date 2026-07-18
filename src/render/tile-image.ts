/**
 * Represents a single image source (tiled or single) within a TileCanvas.
 * Handles tile pyramid, layer management, and tile culling.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import { DrawRect } from './shared';
import { twoNth, mod1 } from '$utils/math';
import { Vec4, Mat4 } from './mat';
import type { default as TileCanvas } from './tile-canvas';

/** Represents a single resolution layer within an Image. @internal */
class Layer {
	readonly tileWidth: number;
	readonly tileHeight: number;

	constructor(
		readonly image: Image,
		readonly index: number,
		readonly start: number,
		readonly end: number,
		readonly tileSize: number,
		readonly cols: number,
		readonly rows: number
	) {
		this.tileWidth = tileSize / image.width;
		this.tileHeight = tileSize / image.height;
	}

	getTileRect(idx: number, r: DrawRect): DrawRect {
		const localIdx = idx - this.start;
		const x = localIdx % this.cols;
		const y = Math.floor(localIdx / this.cols);
		const i = this.image;

		r.x0 = i.x0 + ((x * this.tileSize) / i.width) * i.rWidth;
		r.y0 = i.y0 + ((y * this.tileSize) / i.height) * i.rHeight;
		r.x1 = i.x0 + Math.min((x + 1) * this.tileSize / i.width, 1) * i.rWidth;
		r.y1 = i.y0 + Math.min((y + 1) * this.tileSize / i.height, 1) * i.rHeight;

		r.image = i;
		r.layer = this.index;
		r.x = x;
		r.y = y;

		return r;
	}
}

/** Represents a single image source (tiled or single) within a TileCanvas. @internal */
export default class Image {
	static readonly #toDraw: number[] = []
	static #toDrawSeen: Uint8Array = new Uint8Array(0);
	static #toDrawSeenBase: number = 0;

	readonly vec: Vec4 = new Vec4;
	readonly mat: Mat4 = new Mat4;

	rScale: number = 0;
	readonly layers: Layer[] = [];
	numLayers: number = 0;
	targetLayer: number = 0;

	public x0: number = 0;
	public y0: number = 0;
	public x1: number = 1;
	public y1: number = 1;
	rWidth: number = 1;
	rHeight: number = 1;

	public areaCenterX: number = 0.5;
	public areaCenterY: number = 0.5;
	public areaWidth: number = 1;
	public areaHeight: number = 1;

	public sphere3DX: number = 0;
	public sphere3DY: number = 0;
	public sphere3DZ: number = -1;
	public angularWidth: number = 0;
	public angularHeight: number = 0;

	gotBase: number = 0;

	readonly endOffset!: number;
	aspect: number = 0;

	doneTotal: number = 0;

	doRender: boolean = false;

	#is360Embed: boolean = false;

	public isVideoPlaying: boolean = false;

	static #sampledXs: Float64Array = new Float64Array(200);
	static #sampledYs: Float64Array = new Float64Array(200);
	static #uniqueXs: Float64Array = new Float64Array(200);
	static #sampledLength: number = 0;
	static #uniqueLength: number = 0;

	readonly #canvas: TileCanvas;

	constructor(
		canvas: TileCanvas,
		readonly index: number,
		readonly localIdx: number,
		readonly width: number,
		readonly height: number,
		readonly tileSize: number,
		readonly isSingle: boolean,
		readonly isDeepZoom: boolean,
		readonly isVideo: boolean,
		readonly startOffset: number,
		public opacity: number,
		public tOpacity: number,
		public rotX: number,
		public rotY: number,
		public rotZ: number,
		readonly scale: number,
		readonly fromScale: number
	) {
		this.#canvas = canvas;
		const maxi = (width > height ? width : height);
		this.#is360Embed = this.#canvas.is360 && this.localIdx > 0;

		this.numLayers = isDeepZoom && !isSingle ? 2 : 1;
		for (let s = tileSize; s < maxi * canvas.main.underzoomLevels; s *= 2) this.numLayers++;
		if (canvas.main.hasArchive || this.fromScale > 0) this.numLayers -= 3 - canvas.main.archiveLayerOffset;
		if (this.fromScale > 0) this.numLayers--;
		this.numLayers = Math.max(1, this.numLayers);

		let o = startOffset;
		for (let l = 0; l < this.numLayers; l++) {
			const s2 = twoNth(l) * this.tileSize;
			const c = Math.ceil(width / s2);
			const r = Math.ceil(height / s2);
			this.layers.push(new Layer(this, this.layers.length, o, this.endOffset = o += c * r, s2, c, r));
		}
	}

	/** Sets the relative area this image occupies within its parent canvas. */
	setArea(x0: number, y0: number, x1: number, y1: number): void {
		this.x0 = x0;
		this.y0 = y0;
		this.x1 = x1;
		this.y1 = y1;

		this.areaWidth = x1 + (x1 < x0 ? 1 : 0) - x0;
		this.areaHeight = y1 - y0;
		this.areaCenterX = x0 + this.areaWidth / 2;
		this.areaCenterY = y0 + this.areaHeight / 2;

		if (this.#canvas.is360) {
			this.areaCenterX = mod1(this.areaCenterX);
		}

		this.rWidth = this.areaWidth;
		this.rHeight = this.areaHeight;
		this.aspect = this.width / this.height;
		this.rScale = this.aspect > this.#canvas.aspect ?
			this.#canvas.width / this.width * this.rWidth : this.#canvas.height / this.height * this.rHeight;

		if (this.#canvas.is360) {
			this.#calculate3DSpherePosition();
		}
	}

	/** Converts 2D sphere coordinates to 3D unit sphere position */
	#calculate3DSpherePosition(): void {
		let yaw = (this.areaCenterX - 0.5) * 2 * Math.PI;
		const pitch = (this.areaCenterY - 0.5) * Math.PI;

		yaw += this.#canvas.camera360.baseYaw;

		this.sphere3DX = Math.cos(pitch) * Math.sin(yaw);
		this.sphere3DY = Math.sin(pitch);
		this.sphere3DZ = Math.cos(pitch) * Math.cos(yaw);

		this.angularWidth = this.areaWidth * 2 * Math.PI;
		this.angularHeight = this.areaHeight * Math.PI;
	}

	/**
	 * Checks if embed's 3D sphere position is within camera's viewing frustum
	 */
	#sphere3DOverlap(): boolean {
		if (!this.#canvas.is360) return false;
		const c = this.#canvas.camera360;
		const dp = this.sphere3DX * c.cameraForwardX + this.sphere3DY * c.cameraForwardY + this.sphere3DZ * c.cameraForwardZ;
		return Math.acos(Math.max(-1, Math.min(1, dp))) < c.fieldOfView + Math.max(this.angularWidth, this.angularHeight) / 2;
	}

	/** Checks if the image's bounding box is completely outside the current view. */
	#outsideView(): boolean {
		if (this.#is360Embed) {
			return !this.#sphere3DOverlap();
		} else {
			const v = this.#canvas.view;
			return this.x1 <= v.x0 || this.x0 >= v.x1 || this.y1 <= v.y0 || this.y0 >= v.y1;
		}
	}

	/** Determines if this image should be rendered in the current frame. */
	shouldRender(): boolean {
		if (this.fromScale > 0 && this.fromScale > this.#canvas.camera.scale) return false;
		if ((this.isVideo || this.localIdx > 0) && this.opacity === 0 && this.tOpacity === 0) return false;
		if (this.index === this.#canvas.activeImageIdx || (this.#canvas.is360 && this.localIdx === 0)) return true;
		return !this.#outsideView();
	}

	/**
	 * Steps the opacity animation for this image.
	 * @returns True if the opacity changed (animation is active or snapped).
	 */
	opacityTick(direct: boolean): boolean {
		const tOp = this.tOpacity;
		if (this.opacity === tOp) return false;
		const delta = 1 / (this.#canvas.main.frameTime * this.#canvas.main.embedFadeDuration);
		this.opacity = Math.min(1, Math.max(0, !direct ? tOp > this.opacity
			? Math.min(tOp, this.opacity + delta) : Math.max(tOp, this.opacity - delta) : tOp));
		return this.opacity !== tOp;
	}

	/**
	 * Calculates the set of tiles needed to render the current view for this image.
	 * @returns The number of tiles from this image that are already loaded/drawn.
	 */
	getTiles(scale: number): number {
		if (this.opacity <= 0) return 0;
		this.doneTotal = 0;
		const d = Image.#toDraw;
		let s = Image.#toDrawSeen;

		if (this.#is360Embed) {
			scale = this.#getEmbeddedScale(scale);
			if (!(this.doRender = (scale > 0))) return 0;
		} else {
			scale = Math.max(scale, this.#canvas.camera.minScale) * this.rScale;
		}

		const n = this.endOffset - this.startOffset;
		if (s.length < n) s = Image.#toDrawSeen = new Uint8Array(n);
		else s.fill(0, 0, n);
		Image.#toDrawSeenBase = this.startOffset;

		const last = this.endOffset - 1;
		const lastIdx = last - this.startOffset;
		if (this.gotBase === 0) {
			d.push(last);
			s[lastIdx] = 1;
			this.#canvas.main.setTileOpacity(last, true, 1);
		} else if (this.#is360Embed) {
			d.push(last);
			s[lastIdx] = 1;
			this.doneTotal++;
		}

		const lIdx = this.#getTargetLayer(scale);
		const c = this.#canvas;

		if (this.localIdx === 0 && c.is360) {
			this.#get360Tiles(this.layers[lIdx]);
		} else if (this.#is360Embed) {
			this.#getTilesViewport(lIdx);
			this.doneTotal++;
		} else if (c.visible.x0 < c.visible.x1 && c.visible.y0 < c.visible.y1) {
			const v = c.view;
			this.#getTilesRect(lIdx,
				Math.max(c.visible.x0, v.x0), Math.max(c.visible.y0, v.y0),
				Math.min(c.visible.x1, v.x1), Math.min(c.visible.y1, v.y1)
			);
		}

		d.sort((a, b) => b - a);
		for (const t of d) c.toDraw.push(t);
		d.length = 0;

		return this.doneTotal;
	}

	/** Calculates the target layer index based on the current scale. */
	#getTargetLayer(scale: number): number {
		let l: number = this.isSingle || this.#canvas.limited ? this.numLayers : 1 + this.#canvas.main.skipBaseLevels;
		if (!this.isSingle && !this.#canvas.limited) {
			for (; l < this.numLayers; l++) {
				if (twoNth(l) * scale >= 1) break;
			}
		}
		return (this.targetLayer = l - 1);
	}

	/** Calculates and adds tiles within a given rectangular area for a specific layer. */
	#getTilesRect(layerIdx: number, x0: number, y0: number, x1: number, y1: number): void {
		if (this.#outsideView()) return;

		const l = this.layers[layerIdx];
		const tW = l.tileWidth, tH = l.tileHeight;
		const rW = this.rWidth, rH = this.rHeight;

		const r = Math.min(l.cols - 1, Math.floor(Math.max(0, x1 - this.x0) / rW / tW));
		const b = Math.min(l.rows - 1, Math.floor(Math.max(0, y1 - this.y0) / rH / tH));
		const c = Math.floor(Math.max(0, x0 - this.x0) / rW / tW);
		let y = Math.floor(Math.max(0, y0 - this.y0) / rH / tH);

		for (; y <= b; y++) {
			for (let x = c; x <= r; x++) this.#setToDraw(l, x, y);
		}
	}

	/**
	 * Calculates tiles for 360 embeds using viewport-based coordinates.
	 */
	#getTilesViewport(layerIdx: number): void {
		if (this.#outsideView()) return;

		const layer = this.layers[layerIdx];
		const c = this.#canvas;
		const tol = 0.1;
		const vcy = c.view.centerY;
		const vw = c.view.width + tol, vh = c.view.height + tol;
		const ecx = this.areaCenterX, ecy = this.areaCenterY, ew = this.areaWidth, eh = this.areaHeight;

		const iy0 = Math.max(vcy - vh / 2, ecy - eh / 2);
		const iy1 = Math.min(vcy + vh / 2, ecy + eh / 2);
		if (iy0 >= iy1) return;

		const vcx = c.is360 ? mod1(c.view.centerX + c.camera360.offX) : c.view.centerX;
		let ix0: number, ix1: number;

		if (c.is360) {
			const vx0 = mod1(vcx - vw / 2), vx1 = mod1(vcx + vw / 2);
			const ex0 = mod1(ecx - ew / 2), ex1 = mod1(ecx + ew / 2);

			if (vx1 > vx0 && ex1 > ex0) {
				ix0 = Math.max(vx0, ex0); ix1 = Math.min(vx1, ex1);
				if (ix0 >= ix1) return;
			} else if (vx1 < vx0 && ex1 > ex0) {
				if (!(ex0 <= vx1 || ex1 >= vx0)) return;
				ix0 = ex0; ix1 = ex1;
			} else if (vx1 > vx0 && ex1 < ex0) {
				if (!(vx0 <= ex1 || vx1 >= ex0)) return;
				ix0 = vx0; ix1 = vx1;
			} else {
				ix0 = Math.max(vx0, ex0); ix1 = Math.min(vx1, ex1);
			}

			const eL = ecx - ew / 2, eR = ecx + ew / 2;
			if (eR > 1) {
				if (ix0 < eL) ix0 += 1;
				if (ix1 < eL) ix1 += 1;
			} else if (ix0 > ecx + 0.5) {
				ix0 -= 1;
			} else if (ix1 > ecx + 0.5) {
				ix1 -= 1;
			}
		} else {
			ix0 = Math.max(vcx - vw / 2, ecx - ew / 2);
			ix1 = Math.min(vcx + vw / 2, ecx + ew / 2);
			if (ix0 >= ix1) return;
		}

		const eL = ecx - ew / 2, eB = ecy - eh / 2;
		const tW = layer.tileWidth, tH = layer.tileHeight;
		const c0 = Math.floor(Math.max(0, Math.min(1, (ix0 - eL) / ew)) / tW);
		const c1 = Math.min(layer.cols - 1, Math.floor(Math.max(0, Math.min(1, (ix1 - eL) / ew)) / tW));
		const r0 = Math.floor(Math.max(0, Math.min(1, (iy0 - eB) / eh)) / tH);
		const r1 = Math.min(layer.rows - 1, Math.floor(Math.max(0, Math.min(1, (iy1 - eB) / eh)) / tH));

		for (let row = r0; row <= r1; row++) {
			for (let col = c0; col <= c1; col++) this.#setToDraw(layer, col, row);
		}
	}

	#setToDraw(l: Layer, x: number, y: number): void {
		const s = Image.#toDrawSeen, sb = Image.#toDrawSeenBase;
		const i = Math.min(this.endOffset - 1, l.start + y * l.cols + x);
		const si = i - sb;
		if (si < s.length) {
			if (s[si]) return;
			s[si] = 1;
		}
		Image.#toDraw.push(i);

		if (this.#canvas.main.setTileOpacity(i, i === this.endOffset - 1, this.#canvas.opacity) >= 1) {
			this.doneTotal++;
		} else if (!this.isSingle && !this.#canvas.limited && l.index < this.numLayers - 1) {
			this.#setToDraw(this.layers[l.index + 1], x >> 1, y >> 1);
		}
	}

	/** Calculates the vertex positions for an embedded image within a 360 canvas. */
	setDrawRect(r: DrawRect): void {
		const v = this.#canvas.main.vertexBuffer;
		const s = Math.PI * 2 * this.#canvas.camera360.radius;
		const p = this.vec, m = this.mat;
		const cX = this.x0 + this.rWidth / 2, cY = this.y0 + this.rHeight / 2;
		const center = this.#canvas.camera360.getVec3(cX - this.#canvas.camera360.offX, cY, true, 5);

		m.identity();
		m.translate(center.x, center.y, center.z);
		m.rotateY(Math.atan2(center.x, center.z) + Math.PI + this.rotY);
		m.rotateX(-Math.sin((cY - .5) * Math.PI) - this.rotX);
		m.rotateZ(-this.rotZ);
		m.scaleFlat(this.scale * .5);

		const dx0 = (r.x0 - cX) * s, dx1 = (r.x1 - cX) * s;
		const dy0 = -(r.y0 - cY) * .5 * s, dy1 = -(r.y1 - cY) * .5 * s;

		const tv = (x: number, y: number) => {
			p.x = 0; p.y = 0; p.z = 0;
			m.translate(x, y, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		};

		tv(dx0, dy0); v[0] = p.x; v[1] = p.y; v[2] = p.z;
		tv(dx0, dy1); v[3] = p.x; v[4] = p.y; v[5] = p.z;
		tv(dx1, dy0); v[6] = p.x; v[7] = p.y; v[8] = p.z;
		tv(dx1, dy1); v[12] = p.x; v[13] = p.y; v[14] = p.z;
		v[9] = v[3]; v[10] = v[4]; v[11] = v[5];
		v[15] = v[6]; v[16] = v[7]; v[17] = v[8];
	}

	/** Calculates the effective scale of an embedded image based on its projection. */
	#getEmbeddedScale(s: number): number {
		if (this.#is360Embed) {
			return s * Math.max(this.areaWidth * 2, this.areaHeight) * (this.#canvas.width / this.width);
		}

		const ew = this.areaWidth, eh = this.areaHeight;
		const ecx = this.areaCenterX, ecy = this.areaCenterY;
		const el = this.#canvas.el, gl = this.#canvas.camera360, cW = el.width;
		const pH = eh / 2.5;

		let b = 0;
		const p0 = gl.getXYZ(ecx - ew / 2, ecy - pH);
		if (p0.inView(el)) b++;
		if (gl.getXYZ(ecx + ew / 2, ecy - pH).inView(el)) b++;
		if (gl.getXYZ(ecx - ew / 2, ecy + pH).inView(el)) b++;
		if (gl.getXYZ(ecx + ew / 2, ecy + pH).inView(el)) b++;
		if (b === 0) return 0;

		const l = p0.w > 0 || p0.x < 0 ? 0 : Math.min(cW, p0.x);
		const r = p0.w > 0 || p0.x > cW ? cW : Math.max(0, p0.x);
		return Math.min(1, (r - l) / this.width);
	}

	#get360Tiles(l: Layer): void {
		const c = this.#canvas, w = c.el.width, h = c.el.height;
		const sp = c.camera360.fieldOfView > Math.PI / 2 ? 20 : 12;
		const eps = 1e-8, offX = c.camera360.offX;

		Image.#sampledLength = 0;
		const add = (x: number, y: number) => {
			const coo = c.camera360.getCoo(x, y);
			const i = Image.#sampledLength++;
			Image.#sampledXs[i] = coo.x;
			Image.#sampledYs[i] = coo.y;
		};

		for (let i = 0; i <= sp; i++) {
			const t = i / sp;
			add(t * w, 0); add((1 - t) * w, h);
			add(w, t * h); add(0, (1 - t) * h);
		}
		for (let gy = 1; gy <= 3; gy++) {
			const sy = h * gy / 4;
			for (let gx = 1; gx <= 3; gx++) add(w * gx / 4, sy);
			add(w * gy / 4, h - 1);
		}

		const n = Image.#sampledLength;
		let minY = Infinity, maxY = -Infinity;
		for (let i = 0; i < n; i++) {
			const v = Image.#sampledYs[i];
			if (v < minY) minY = v;
			if (v > maxY) maxY = v;
		}
		minY = Math.max(0, minY - 0.001);
		maxY = Math.min(1, maxY + 0.05);

		const xs = Image.#sampledXs, ux = Image.#uniqueXs;
		for (let i = 0; i < n; i++) xs[i] = mod1(xs[i] - offX);

		Image.#uniqueLength = 0;
		for (let i = 0; i < n; i++) {
			const val = xs[i];
			let exists = false;
			for (let j = 0; j < Image.#uniqueLength; j++) {
				if (Math.abs(ux[j] - val) < eps) { exists = true; break; }
			}
			if (!exists) ux[Image.#uniqueLength++] = val;
		}

		const m = Image.#uniqueLength;
		for (let i = 1; i < m; i++) {
			const key = ux[i]; let j = i - 1;
			while (j >= 0 && ux[j] > key) { ux[j + 1] = ux[j]; j--; }
			ux[j + 1] = key;
		}

		let a0 = 0, a1 = 1, full = false;
		if (m < 2) {
			full = true; minY = 0; maxY = 1;
		} else {
			let maxGap = 0, idx = -1;
			for (let i = 0; i < m - 1; i++) {
				const g = ux[i + 1] - ux[i];
				if (g > maxGap) { maxGap = g; idx = i; }
			}
			const wGap = ux[0] + 1 - ux[m - 1];
			const wrapMax = wGap > maxGap;
			if (wrapMax) { maxGap = wGap; idx = m - 1; }

			if (1 - maxGap >= 1 - 1e-6) {
				full = true;
			} else if (wrapMax) {
				a0 = ux[0]; a1 = ux[m - 1];
			} else {
				a0 = ux[(idx + 1) % m]; a1 = ux[idx] + 1;
			}
		}

		if (minY < 0.05 || maxY > 0.95) full = true;

		const tH = l.tileHeight, tW = l.tileWidth;
		let r0 = Math.max(0, Math.floor((minY - 0.001) / tH));
		let r1 = Math.min(l.rows - 1, Math.max(0, Math.floor((maxY + tH - 1e-10) / tH)));
		if (minY < 1e-5) r0 = 0;
		if (maxY > 1 - 1e-5) r1 = l.rows - 1;

		const wrap = a1 > 1;
		for (let row = r0; row <= r1; row++) {
			if (full) {
				for (let col = 0; col < l.cols; col++) this.#setToDraw(l, col, row);
			} else {
				const c0 = Math.max(0, Math.floor((a0 - 0.001) / tW) - 1);
				if (!wrap) {
					const c1 = Math.min(l.cols - 1, Math.ceil((a1 + 0.001) / tW));
					for (let col = c0; col <= c1; col++) this.#setToDraw(l, col, row);
				} else {
					for (let col = c0; col < l.cols; col++) this.#setToDraw(l, col, row);
					const c1 = Math.min(l.cols - 1, Math.ceil(mod1(a1 + 0.001) / tW));
					for (let col = 0; col <= c1; col++) this.#setToDraw(l, col, row);
				}
			}
		}
	}
}
