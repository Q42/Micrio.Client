/**
 * Represents a single image source (tiled or single) within a TileCanvas.
 * Handles tile pyramid, layer management, and tile culling.
 * @author Marcel Duin <marcel@micr.io>
 */

import { DrawRect, Coordinates } from '../shared/shared';
import { twoNth, mod1 } from '../utils/utils';
import { Vec4, Mat4 } from '../webgl/mat';
import { PI } from '../globals';
import type { default as TileCanvas } from './canvas';

/** Represents a single resolution layer within an Image. */
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

/** Represents a single image source (tiled or single) within a TileCanvas. */
export default class Image {
	private static readonly toDraw: number[] = []
	private static toDrawSeen: Uint8Array = new Uint8Array(0);
	private static toDrawSeenBase: number = 0;

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

	private is360Embed: boolean = false;

	public isVideoPlaying: boolean = false;

	private static sampledXs: Float64Array = new Float64Array(200);
	private static sampledYs: Float64Array = new Float64Array(200);
	private static uniqueXs: Float64Array = new Float64Array(200);
	private static sampledLength: number = 0;
	private static uniqueLength: number = 0;

	constructor(
		private readonly canvas: TileCanvas,
		readonly index: number,
		readonly localIdx: number,
		readonly width: number,
		readonly height: number,
		readonly tileSize: number,
		readonly isSingle: boolean,
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
		const maxi = (width > height ? width : height);
		this.is360Embed = this.canvas.is360 && this.localIdx > 0;

		this.numLayers = 2;
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

		if (this.canvas.is360) {
			this.areaCenterX = mod1(this.areaCenterX);
		}

		this.rWidth = this.areaWidth;
		this.rHeight = this.areaHeight;
		this.aspect = this.width / this.height;
		this.rScale = this.aspect > this.canvas.aspect ?
			this.canvas.width / this.width * this.rWidth : this.canvas.height / this.height * this.rHeight;

		if (this.canvas.is360) {
			this.calculate3DSpherePosition();
		}
	}

	/** Converts 2D sphere coordinates to 3D unit sphere position */
	private calculate3DSpherePosition(): void {
		let yaw = (this.areaCenterX - 0.5) * 2 * PI;
		const pitch = (this.areaCenterY - 0.5) * PI;

		yaw += this.canvas.webgl.baseYaw;

		this.sphere3DX = Math.cos(pitch) * Math.sin(yaw);
		this.sphere3DY = Math.sin(pitch);
		this.sphere3DZ = Math.cos(pitch) * Math.cos(yaw);

		this.angularWidth = this.areaWidth * 2 * PI;
		this.angularHeight = this.areaHeight * PI;
	}

	/**
	 * Checks if embed's 3D sphere position is within camera's viewing frustum
	 */
	private sphere3DOverlap(): boolean {
		if (!this.canvas.is360) return false;

		const dotProduct = this.sphere3DX * this.canvas.webgl.cameraForwardX +
			this.sphere3DY * this.canvas.webgl.cameraForwardY +
			this.sphere3DZ * this.canvas.webgl.cameraForwardZ;

		const angularDistance = Math.acos(Math.max(-1, Math.min(1, dotProduct)));

		const embedAngularRadius = Math.max(this.angularWidth, this.angularHeight) / 2;

		const effectiveFOV = this.canvas.webgl.fieldOfView + embedAngularRadius;

		return angularDistance < effectiveFOV;
	}

	/** Checks if the image's bounding box is completely outside the current view. */
	private outsideView(): boolean {
		if (this.is360Embed) {
			return !this.sphere3DOverlap();
		} else {
			const v = this.canvas.view;
			return this.x1 <= v.x0 || this.x0 >= v.x1 || this.y1 <= v.y0 || this.y0 >= v.y1;
		}
	}

	/** Determines if this image should be rendered in the current frame. */
	shouldRender(): boolean {
		if (this.fromScale > 0 && this.fromScale > this.canvas.camera.scale) return false;
		if ((this.isVideo || this.localIdx > 0) && this.opacity === 0 && this.tOpacity === 0) return false;
		if (this.index === this.canvas.activeImageIdx || (this.canvas.is360 && this.localIdx === 0)) return true;
		return !this.outsideView();
	}

	/**
	 * Steps the opacity animation for this image.
	 * @returns True if the opacity changed (animation is active or snapped).
	 */
	opacityTick(direct: boolean): boolean {
		const tOp = this.tOpacity;
		if (this.opacity === tOp) return false;
		const delta = 1 / (this.canvas.main.frameTime * this.canvas.main.embedFadeDuration);
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

		if (this.is360Embed) {
			scale = this.getEmbeddedScale(scale);
			if (!(this.doRender = (scale > 0))) return 0;
		}
		else {
			const cam = this.canvas.camera;
			scale = Math.max(scale, cam.minScale) * this.rScale;
		}

		const tileCount = this.endOffset - this.startOffset;
		if (Image.toDrawSeen.length < tileCount) {
			Image.toDrawSeen = new Uint8Array(tileCount);
		} else {
			for (let i = 0; i < tileCount; i++) Image.toDrawSeen[i] = 0;
		}
		Image.toDrawSeenBase = this.startOffset;

		if (this.gotBase === 0) {
			Image.toDraw.push(this.endOffset - 1);
			Image.toDrawSeen[this.endOffset - 1 - this.startOffset] = 1;
			this.canvas.main.setTileOpacity(this.endOffset - 1, true, 1);
		}
		else if (this.is360Embed) {
			Image.toDraw.push(this.endOffset - 1);
			Image.toDrawSeen[this.endOffset - 1 - this.startOffset] = 1;
			this.doneTotal++;
		}

		const lIdx: number = this.getTargetLayer(scale);
		const c = this.canvas;
		const v = c.view;

		if (this.localIdx === 0 && c.is360) {
			this.get360Tiles(this.layers[lIdx]);
		}
		else {
			if (this.is360Embed) {
				this.getTilesViewport(lIdx);
			} else if (c.is360) {
				this.getTilesRect(lIdx, v.x0, v.y0, v.x1, v.y1);
			} else if (c.visible.x0 < c.visible.x1 && c.visible.y0 < c.visible.y1) {
				this.getTilesRect(lIdx,
					Math.max(c.visible.x0, v.x0), Math.max(c.visible.y0, v.y0),
					Math.min(c.visible.x1, v.x1), Math.min(c.visible.y1, v.y1)
				);
			}
			if (this.is360Embed) this.doneTotal++;
		}

		Image.toDraw.sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
		for (let i = 0; i < Image.toDraw.length; i++)
			c.toDraw.push(Image.toDraw[i]);
		Image.toDraw.length = 0;

		return this.doneTotal;
	}

	/** Calculates the target layer index based on the current scale. */
	private getTargetLayer(scale: number): number {
		let l: number = this.isSingle || this.canvas.limited ? this.numLayers : 1 + this.canvas.main.skipBaseLevels;
		if (!this.isSingle && !this.canvas.limited) {
			for (; l < this.numLayers; l++) {
				if (twoNth(l) * scale >= 1) break;
			}
		}
		return (this.targetLayer = l - 1);
	}

	/** Calculates and adds tiles within a given rectangular area for a specific layer. */
	private getTilesRect(layerIdx: number, x0: number, y0: number, x1: number, y1: number): void {
		if (this.outsideView()) return;

		const layer = this.layers[layerIdx];
		const tW = layer.tileWidth, tH = layer.tileHeight;
		const rW = this.rWidth, rH = this.rHeight;

		const r = Math.min(layer.cols - 1, Math.floor(Math.max(0, x1 - this.x0) / rW / tW));
		const b = Math.floor(Math.max(0, y1 - this.y0) / rH / tH);
		const l = Math.floor(Math.max(0, x0 - this.x0) / rW / tW);
		let y = Math.floor(Math.max(0, y0 - this.y0) / rH / tH);

		for (; y <= b; y++) {
			if (y >= layer.rows) continue;
			for (let x = l; x <= r; x++) {
				this.setToDraw(layer, x, y);
			}
		}
	}

	/**
	 * Calculates tiles for 360 embeds using viewport-based coordinates.
	 */
	private getTilesViewport(layerIdx: number): void {
		if (this.outsideView()) return;

		const layer = this.layers[layerIdx];
		const c = this.canvas;

		const tolerance = 0.1;

		const viewCenterX = mod1(c.view.centerX + c.webgl.offX);
		const viewCenterY = c.view.centerY;
		const viewWidth = c.view.width + tolerance;
		const viewHeight = c.view.height + tolerance;

		const embedCenterX = this.areaCenterX;
		const embedCenterY = this.areaCenterY;
		const embedWidth = this.areaWidth;
		const embedHeight = this.areaHeight;

		const viewY0 = viewCenterY - viewHeight / 2;
		const viewY1 = viewCenterY + viewHeight / 2;
		const embedY0 = embedCenterY - embedHeight / 2;
		const embedY1 = embedCenterY + embedHeight / 2;

		const intersectY0 = Math.max(viewY0, embedY0);
		const intersectY1 = Math.min(viewY1, embedY1);

		if (intersectY0 >= intersectY1) return;

		let intersectX0: number = 0, intersectX1: number = 0;
		let hasIntersection = false;

		if (c.is360) {
			const viewX0 = mod1(viewCenterX - viewWidth / 2);
			const viewX1 = mod1(viewCenterX + viewWidth / 2);
			const embedX0 = mod1(embedCenterX - embedWidth / 2);
			const embedX1 = mod1(embedCenterX + embedWidth / 2);

			if (viewX1 > viewX0 && embedX1 > embedX0) {
				intersectX0 = Math.max(viewX0, embedX0);
				intersectX1 = Math.min(viewX1, embedX1);
				hasIntersection = intersectX0 < intersectX1;
			}
			else if (viewX1 < viewX0 && embedX1 > embedX0) {
				if (embedX0 <= viewX1 || embedX1 >= viewX0) {
					intersectX0 = embedX0;
					intersectX1 = embedX1;
					hasIntersection = true;
				}
			}
			else if (viewX1 > viewX0 && embedX1 < embedX0) {
				if (viewX0 <= embedX1 || viewX1 >= embedX0) {
					intersectX0 = viewX0;
					intersectX1 = viewX1;
					hasIntersection = true;
				}
			}
			else if (viewX1 < viewX0 && embedX1 < embedX0) {
				intersectX0 = Math.max(viewX0, embedX0);
				intersectX1 = Math.min(viewX1, embedX1);
				hasIntersection = true;
			}
		} else {
			const viewX0 = viewCenterX - viewWidth / 2;
			const viewX1 = viewCenterX + viewWidth / 2;
			const embedX0 = embedCenterX - embedWidth / 2;
			const embedX1 = embedCenterX + embedWidth / 2;

			intersectX0 = Math.max(viewX0, embedX0);
			intersectX1 = Math.min(viewX1, embedX1);
			hasIntersection = intersectX0 < intersectX1;
		}

		if (!hasIntersection) return;

		let embedLeft = embedCenterX - embedWidth / 2;
		let embedRight = embedCenterX + embedWidth / 2;

		if (c.is360) {
			if (embedRight > 1) {
				if (intersectX0 < embedLeft) intersectX0 += 1;
				if (intersectX1 < embedLeft) intersectX1 += 1;
			}
			else if (intersectX0 > embedCenterX + 0.5) {
				intersectX0 -= 1;
			}
			else if (intersectX1 > embedCenterX + 0.5) {
				intersectX1 -= 1;
			}
		}

		const embedRelX0 = (intersectX0 - embedLeft) / embedWidth;
		const embedRelX1 = (intersectX1 - embedLeft) / embedWidth;
		const embedRelY0 = (intersectY0 - (embedCenterY - embedHeight / 2)) / embedHeight;
		const embedRelY1 = (intersectY1 - (embedCenterY - embedHeight / 2)) / embedHeight;

		const tW = layer.tileWidth;
		const tH = layer.tileHeight;

		const tileLeft = Math.floor(Math.max(0, Math.min(1, embedRelX0)) / tW);
		const tileRight = Math.min(layer.cols - 1, Math.floor(Math.max(0, Math.min(1, embedRelX1)) / tW));
		const tileTop = Math.floor(Math.max(0, Math.min(1, embedRelY0)) / tH);
		const tileBottom = Math.min(layer.rows - 1, Math.floor(Math.max(0, Math.min(1, embedRelY1)) / tH));

		for (let row = tileTop; row <= tileBottom; row++) {
			for (let col = tileLeft; col <= tileRight; col++) {
				this.setToDraw(layer, col, row);
			}
		}
	}

	private setToDraw(l: Layer, x: number, y: number): void {
		const idx: number = Math.min(this.endOffset - 1, l.start + (y * l.cols) + x);
		const seenIdx = idx - Image.toDrawSeenBase;
		if (seenIdx < Image.toDrawSeen.length && Image.toDrawSeen[seenIdx]) return;
		if (seenIdx < Image.toDrawSeen.length) Image.toDrawSeen[seenIdx] = 1;
		Image.toDraw.push(idx);

		if (this.canvas.main.setTileOpacity(idx, idx === this.endOffset - 1, this.canvas.opacity) >= 1) {
			this.doneTotal++;
		}
		else if (!this.isSingle && !this.canvas.limited && l.index < this.numLayers - 1) {
			const parentLayer = this.layers[l.index + 1];
			const parentX = x >> 1;
			const parentY = y >> 1;
			this.setToDraw(parentLayer, parentX, parentY);
		}
	}

	/** Calculates the vertex positions for an embedded image within a 360 canvas. */
	setDrawRect(r: DrawRect): void {
		const v = this.canvas.main.vertexBuffer;
		const d = this.canvas.webgl.radius;
		const s: number = PI * 2 * d;
		const p = this.vec;
		const m = this.mat;

		const cX: number = this.x0 + this.rWidth / 2;
		const cY: number = this.y0 + this.rHeight / 2;
		const center = this.canvas.webgl.getVec3(cX - this.canvas.webgl.offX, cY, true, 5);

		m.identity();
		m.translate(center.x, center.y, center.z);
		m.rotateY(Math.atan2(center.x, center.z) + PI + this.rotY);
		m.rotateX(-Math.sin((cY - .5) * PI) - this.rotX);
		m.rotateZ(-this.rotZ);
		m.scaleFlat(this.scale * .5);

		let x = (r.x0 - cX) * s, y = -(r.y0 - cY) * .5 * s;
		p.x = 0; p.y = 0; p.z = 0; m.translate(x, y, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		v[0] = p.x; v[1] = p.y; v[2] = p.z;

		p.x = 0; p.y = 0; p.z = 0; m.translate(x = (r.x0 - cX) * s, y = -(r.y1 - cY) * .5 * s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		v[3] = v[9] = p.x; v[4] = v[10] = p.y; v[5] = v[11] = p.z;

		p.x = 0; p.y = 0; p.z = 0; m.translate(x = (r.x1 - cX) * s, y = -(r.y0 - cY) * .5 * s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		v[6] = v[15] = p.x; v[7] = v[16] = p.y; v[8] = v[17] = p.z;

		p.x = 0; p.y = 0; p.z = 0; m.translate(x = (r.x1 - cX) * s, y = -(r.y1 - cY) * .5 * s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		v[12] = p.x; v[13] = p.y; v[14] = p.z;
	}

	/** Calculates the effective scale of an embedded image based on its projection. */
	private getEmbeddedScale(s: number): number {
		if (this.is360Embed) {
			const areaFactor = Math.max(this.areaWidth * 2, this.areaHeight);
			const sizeFactor = this.canvas.width / this.width;
			return s * areaFactor * sizeFactor;
		}

		const embedWidth = this.areaWidth;
		const embedHeight = this.areaHeight;
		const embedX0 = this.areaCenterX - embedWidth / 2;
		const embedX1 = this.areaCenterX + embedWidth / 2;
		const cY = this.areaCenterY;
		const pH = embedHeight / 2.5;
		const el = this.canvas.el, gl = this.canvas.webgl, cW = this.canvas.el.width;

		let px = gl.getXYZ(embedX0, cY - pH);
		let lX = px.w > 0 || px.x < 0 ? 0 : Math.min(cW, px.x);
		let b: number = 0;
		if (px.inView(el)) b++;

		if (gl.getXYZ(embedX1, cY - pH).inView(el)) b++;
		const wT = ((px.w > 0 || px.x > cW ? cW : Math.max(0, px.x)) - lX);

		if (gl.getXYZ(embedX0, cY + pH).inView(el)) b++;
		lX = px.w > 0 || px.x < 0 ? 0 : Math.min(cW, px.x);
		if (gl.getXYZ(embedX1, cY + pH).inView(el)) b++;

		if (b === 0) return 0;

		const wB = (px.w > 0 || px.x > cW ? cW : Math.max(0, px.x)) - lX;
		return Math.min(1, Math.max(wB, wT) / this.width);
	}

	private get360Tiles(l: Layer): void {
		const c = this.canvas;
		const el = c.el;
		const w = el.width, h = el.height;

		Image.sampledLength = 0;
		Image.uniqueLength = 0;

		const samplesPerEdge: number = c.webgl.fieldOfView > PI / 2 ? 20 : 12;
		const epsilon: number = 1e-8;

		for (let i = 0; i <= samplesPerEdge; i++) {
			const t = i / samplesPerEdge;
			let coo = c.webgl.getCoo(t * w, 0);
			Image.sampledXs[Image.sampledLength] = coo.x;
			Image.sampledYs[Image.sampledLength] = coo.y;
			Image.sampledLength++;
			coo = c.webgl.getCoo((1 - t) * w, h);
			Image.sampledXs[Image.sampledLength] = coo.x;
			Image.sampledYs[Image.sampledLength] = coo.y;
			Image.sampledLength++;
			coo = c.webgl.getCoo(w, t * h);
			Image.sampledXs[Image.sampledLength] = coo.x;
			Image.sampledYs[Image.sampledLength] = coo.y;
			Image.sampledLength++;
			coo = c.webgl.getCoo(0, (1 - t) * h);
			Image.sampledXs[Image.sampledLength] = coo.x;
			Image.sampledYs[Image.sampledLength] = coo.y;
			Image.sampledLength++;
		}

		let coo: Coordinates;
		for (let gy = 1; gy <= 3; gy++) {
			const sy = h * gy / 4;
			for (let gx = 1; gx <= 3; gx++) {
				coo = c.webgl.getCoo(w * gx / 4, sy);
				Image.sampledXs[Image.sampledLength] = coo.x;
				Image.sampledYs[Image.sampledLength] = coo.y;
				Image.sampledLength++;
			}
			coo = c.webgl.getCoo(w * gy / 4, h - 1);
			Image.sampledXs[Image.sampledLength] = coo.x;
			Image.sampledYs[Image.sampledLength] = coo.y;
			Image.sampledLength++;
		}

		let minY: number = Infinity;
		let maxY: number = -Infinity;
		for (let i = 0; i < Image.sampledLength; i++) {
			const val = Image.sampledYs[i];
			if (val < minY) minY = val;
			if (val > maxY) maxY = val;
		}

		minY = Math.max(0, minY);
		maxY = Math.min(1, maxY);

		minY -= 0.001;
		maxY += 0.05;
		minY = Math.max(0, minY);
		maxY = Math.min(1, maxY);

		const offX = c.webgl.offX;
		for (let i = 0; i < Image.sampledLength; i++) {
			Image.sampledXs[i] = mod1(Image.sampledXs[i] - offX);
		}
		Image.uniqueLength = 0;
		for (let i = 0; i < Image.sampledLength; i++) {
			const val = Image.sampledXs[i];
			let exists = false;
			for (let j = 0; j < Image.uniqueLength; j++) {
				if (Math.abs(Image.uniqueXs[j] - val) < epsilon) {
					exists = true;
					break;
				}
			}
			if (!exists) {
				Image.uniqueXs[Image.uniqueLength] = val;
				Image.uniqueLength++;
			}
		}
		for (let i = 1; i < Image.uniqueLength; i++) {
			const key = Image.uniqueXs[i];
			let j: number = i - 1;
			while (j >= 0 && Image.uniqueXs[j] > key) {
				Image.uniqueXs[j + 1] = Image.uniqueXs[j];
				j--;
			}
			Image.uniqueXs[j + 1] = key;
		}

		const n: number = Image.uniqueLength;
		if (n < 2) {
			minY = 0; maxY = 1;
			Image.uniqueLength = 0;
			Image.uniqueXs[0] = 0;
			Image.uniqueXs[1] = 1;
			Image.uniqueLength = 2;
		} else {
			let maxGap: number = 0;
			let maxGapIdx: number = -1;
			for (let i = 0; i < n - 1; i++) {
				const gap: number = Image.uniqueXs[i + 1] - Image.uniqueXs[i];
				if (gap > maxGap) {
					maxGap = gap;
					maxGapIdx = i;
				}
			}
			const wrapGap: number = Image.uniqueXs[0] + 1 - Image.uniqueXs[n - 1];
			let isWrapMax: boolean = wrapGap > maxGap;
			if (isWrapMax) {
				maxGap = wrapGap;
				maxGapIdx = n - 1;
			}

			const arcLength: number = 1 - maxGap;

			let arcStart: number = 0;
			let arcEnd: number = 0;
			if (isWrapMax) {
				arcStart = Image.uniqueXs[0];
				arcEnd = Image.uniqueXs[n - 1];
			} else {
				arcStart = Image.uniqueXs[(maxGapIdx + 1) % n];
				arcEnd = Image.uniqueXs[maxGapIdx] + 1;
			}

			if (arcLength >= 1 - 1e-6) {
				arcStart = 0;
				arcEnd = 1;
			}

			Image.uniqueLength = 0;
			Image.uniqueXs[0] = arcStart;
			Image.uniqueXs[1] = arcEnd;
			Image.uniqueLength = 2;
		}

		let isFullArc: boolean = Image.uniqueXs[1] - Image.uniqueXs[0] >= 1 - 1e-6;
		if (minY < 0.05 || maxY > 0.95) {
			isFullArc = true;
		}

		let minRow: number = Math.max(0, Math.max(0, Math.floor((minY - 0.001) / l.tileHeight)));
		let maxRow: number = Math.min(l.rows - 1, Math.max(0, Math.floor((maxY + l.tileHeight - 1e-10) / l.tileHeight)));

		if (minY < 1e-5) minRow = 0;
		if (maxY > 1 - 1e-5) maxRow = l.rows - 1;

		const tileWidth = l.tileWidth;
		const isWrapping: boolean = Image.uniqueXs[1] > 1;

		for (let row = minRow; row <= maxRow; row++) {
			if (isFullArc) {
				for (let col = 0; col < l.cols; col++) {
					this.setToDraw(l, col, row);
				}
			} else if (!isWrapping) {
				const minCol: number = Math.max(0, Math.max(0, Math.floor((Image.uniqueXs[0] - 0.001) / tileWidth) - 1));
				const maxCol: number = Math.min(l.cols - 1, Math.ceil((Image.uniqueXs[1] + 0.001) / tileWidth));
				for (let col = minCol; col <= maxCol; col++) {
					this.setToDraw(l, col, row);
				}
			} else {
				const minCol1: number = Math.max(0, Math.max(0, Math.floor((Image.uniqueXs[0] - 0.001) / tileWidth) - 1));
				for (let col = minCol1; col < l.cols; col++) {
					this.setToDraw(l, col, row);
				}
				const maxCol2: number = Math.min(l.cols - 1, Math.ceil((mod1(Image.uniqueXs[1] + 0.001)) / tileWidth));
				for (let col = 0; col <= maxCol2; col++) {
					this.setToDraw(l, col, row);
				}
			}
		}
	}
}
