import { PaperMesh } from './geometry/paper-mesh';
import { CoverMesh } from './geometry/cover-mesh';
import { PaperRenderer } from './rendering/renderer';
import { InputHandler } from './input/input';
import { OrbitCamera } from './core/orbit-camera';
import { Vec3 } from './core/vec3';
import { Mat4 } from '$render/mat';
import { PageFlipAnimator } from './animation/page-flip';
import {
	SolverSettings,
	isWasmReady,
	initWasmSolver,
	dispatchSolve,
} from './physics/wasm-sync';
import {
	PAGE_THICKNESS, COVER_THICKNESS_MULTIPLIER, COVER_SCALE_X, COVER_SCALE_Y,
	SOLVER_ITERATIONS, SOLVER_SUBSTEPS, DISTANCE_COMPLIANCE,
	BENDING_COMPLIANCE, DAMPING, GOTO_DAMPING, GRAVITY, GRAVITY_ENABLED,
	DELTA_IDLE_THRESHOLD,
	USE_INDIVIDUAL_ASPECTS, DEFAULT_ASPECT,
	VIEWPORT_MARGIN_PCT, DEFAULT_CAMERA_PHI,
	HARD_COVER,
	TILT_SHIFT_ENABLED,
	LIGHTING_PRESET,
	GRAB_ROW, GRAB_ROW_MAX_OFFSET, GOTO_GRAB_ROW_MAX_OFFSET,
} from './core/settings';
import { IIIFTextureManager } from './rendering/iiif-manager';
import type { PageClickResult, PageDragResult } from './core/types';
import type { Models } from '$types/models';
import { rayIntersectMeshes } from './geometry/raycast';
import { uvToWorldPosition, sampleMeshPosition, projectWorldToScreen, type UvWorldResult } from './geometry/uv-project';
import { computeWeightFactor, computePageSpineY, applySpineDelta } from './animation/spine-sync';
import { getPreset, getPresets } from './rendering/lighting';
import { archive } from '$utils/archive';

interface TextureContext {
	pageIndex: number;
	side: 0 | 1;
	mesh: PaperMesh;
	result: UvWorldResult;
}

function computePageLayout(images: Models.ImageInfo.ImageInfo[], options?: BookViewerOptions) {
	const pageCnt = Math.ceil(images.length / 2);
	const totalImagePages = images.length;

	const pageIdxes: number[][] = [[0]];
	for (let p = 1; p < pageCnt; p++) {
		const first = 2 * p - 1;
		const last = 2 * p;
		if (last < images.length) {
			pageIdxes.push([first, last]);
		} else {
			pageIdxes.push([first]);
		}
	}

	let totalAspect = 0;
	let aspectCount = 0;
	const computedPageAspects = new Float32Array(pageCnt);

	for (let p = 0; p < pageCnt; p++) {
		const front = images[p * 2];
		const back = images[p * 2 + 1];
		let asp = 0;
		let n = 0;
		if (front && front.width > 0 && front.height > 0) {
			asp += front.height / front.width;
			n++;
		}
		if (back && back.width > 0 && back.height > 0) {
			asp += back.height / back.width;
			n++;
		}
		const pageAsp = n > 0 ? asp / n : DEFAULT_ASPECT;
		computedPageAspects[p] = pageAsp;
		totalAspect += asp;
		aspectCount += n;
	}

	const avgAspect = aspectCount > 0 ? totalAspect / aspectCount : DEFAULT_ASPECT;
	const refArea = 1.0 * avgAspect;

	const computedPageWidths = new Float32Array(pageCnt);
	for (let p = 0; p < pageCnt; p++) {
		const asp = computedPageAspects[p];
		computedPageWidths[p] = Math.sqrt(refArea / asp);
	}

	let aspectsForInit: Float32Array;
	if (options?._useIndividualAspects ?? USE_INDIVIDUAL_ASPECTS) {
		aspectsForInit = computedPageAspects;
	} else {
		aspectsForInit = new Float32Array(pageCnt).fill(avgAspect);
		computedPageWidths.fill(Math.sqrt(refArea / avgAspect));
	}

	return { pageCnt, pageIdxes, totalImagePages, computedPageWidths, aspectsForInit };
}

export interface DrawnImage {
	/** The micrio image id. */
	id: string;
	/**
	 * A rough axis-aligned rectangle `[u, v, w, h]` in the image's texture UV
	 * space (0..1) covering the part currently visible in the viewport. The
	 * full texture visible is `[0, 0, 1, 1]`.
	 */
	bounds: [number, number, number, number];
}

export interface BookViewerOptions {
	/** The WebGL2 canvas to render into. Must be present in the document and sized by its host. */
	_canvas: HTMLCanvasElement;
	/** The already-loaded book index JSON. */
	_images: Models.ImageInfo.ImageInfo[];
	/** Called whenever the current reading position changes. */
	_onPageChange?: (pageIdx: number) => void;
	/** Called whenever the camera moves (rotate/zoom/pan, including smoothing). */
	_onViewChange?: () => void;
	/** Called after every frame that is drawn to the canvas, with the micrioIds of the images visible in the current spread (plus any page mid-flip), each with a rough `[u, v, w, h]` rectangle (in texture UV space 0..1) of the part visible in the viewport. */
	_onDraw?: (images: DrawnImage[]) => void;
	_hardCover?: boolean;
	_tiltShift?: boolean;
	_lightingPreset?: string;
	_useIndividualAspects?: boolean;
	_startPageIdx?: number;
	/** Base URL for the IIIF image server (hi-res streaming). */
	_iiifBaseUrl?: string;
}

export class BookViewer {
	static _getPresets = getPresets;
	readonly _ready: Promise<void>;

	#hardCover: boolean;

	#pageCount = 0;
	#pageAspects: Float32Array = new Float32Array(0);
	#pageWidths: Float32Array = new Float32Array(0);

	#images: Models.ImageInfo.ImageInfo[] = [];

	#meshes: PaperMesh[] = [];
	#renderer!: PaperRenderer;
	#inputHandler!: InputHandler;
	#camera!: OrbitCamera;
	#flipAnimator!: PageFlipAnimator;
	#iiifManager: IIIFTextureManager | null = null;

	#canvas: HTMLCanvasElement;
	#onPageChange?: (pageIdx: number) => void;
	#onViewChange?: () => void;
	#onDraw?: (images: DrawnImage[]) => void;

	/** The last frame's on-screen image bounds, reused by `isZoomedIn`. */
	#lastDrawnImages: DrawnImage[] = [];

	#animFrameId = 0;
	#gotoRafId = 0;
	#gotoDamping = false;
	#selectedPage = 0;
	#currentPage = 0;
	#dragPageIndex = -1;
	#dragStartCursorWorldX = 0;
	#dragStartProgress = 0;

	#solverSettings: SolverSettings = {
		_solverIterations: SOLVER_ITERATIONS,
		_substeps: SOLVER_SUBSTEPS,
		_distanceCompliance: DISTANCE_COMPLIANCE,
		_bendingCompliance: BENDING_COMPLIANCE,
		_damping: DAMPING,
		_gravity: GRAVITY,
		_gravityEnabled: GRAVITY_ENABLED,
	};

	#activePageSet = new Set<number>();
	#prevPositions: Float32Array[] = [];

	#totalStackHeight = 0;

	/** Reference view-space depth used to convert the pixel `scale` argument of
	 *  `textureToMatrix` into a fixed world size, so the object scales with the
	 *  page when the camera zooms. Captured once at init (the default fit view). */
	#referenceDepth = 1;

	#lastTime = 0;
	#solveCount = 0;

	constructor(options: BookViewerOptions) {
		this.#canvas = options._canvas;
		this.#onPageChange = options._onPageChange;
		this.#onViewChange = options._onViewChange;
		this.#onDraw = options._onDraw;
		this.#hardCover = options._hardCover ?? HARD_COVER;

		this._ready = this.#init(options);
	}

	// ═══════════════════════════════════════════════════════════════
	// Public API
	// ═══════════════════════════════════════════════════════════════

	goto(pageIdx: number): void {
		const idx = Math.max(0, Math.min(this.#pageCount - 1, pageIdx));
		if (idx === this.#currentPage) return;

		if (this.#gotoRafId !== 0) {
			cancelAnimationFrame(this.#gotoRafId);
			this.#gotoRafId = 0;
		}
		this.#gotoDamping = true;

		const direction = idx > this.#currentPage ? 1 : -1;
		const fresh = !this.#flipAnimator._animating;
		let remaining = Math.abs(idx - this.#currentPage);
		let first = true;

		const step = (): void => {
			if (remaining <= 0) {
				this.#gotoRafId = 0;
				return;
			}
			const maxOff = (first && fresh) ? GRAB_ROW_MAX_OFFSET : GOTO_GRAB_ROW_MAX_OFFSET;
			const grabRow = GRAB_ROW + (Math.random() * 2 - 1) * maxOff;
			if (direction > 0) {
				this._nextPage(grabRow);
			} else {
				this._prevPage(grabRow);
			}
			first = false;
			remaining--;
			this.#gotoRafId = requestAnimationFrame(step);
		};
		step();
	}

	zoom(delta:number): void {
		this.#camera._zoom(delta);
		this.#requestFrame();
	}

	/**
	 * Returns whether the camera is zoomed in beyond the fit view. This is the
	 * complement of "the whole spread fits the viewport": when every currently
	 * visible image shows its full texture (`[0, 0, 1, 1]` bounds) the view is
	 * zoomed out, and any image cut off by the viewport means it is zoomed in.
	 * Based on the last rendered frame's on-screen bounds, so it stays accurate
	 * after zooming back out.
	 */
	isZoomedIn(): boolean {
		const drawn = this.#lastDrawnImages;
		if (drawn.length === 0) return false;
		return !drawn.every(img => {
			const [u, v, w, h] = img.bounds;
			return u <= 1e-4 && v <= 1e-4 && Math.abs(w - 1) <= 1e-4 && Math.abs(h - 1) <= 1e-4;
		});
	}

	setLightingPreset(name: string): void {
		const p = getPreset(name);
		if (!p) return;
		const params: Record<string, number> = {};
		for (const param of p.params) {
			params[param.key] = param.default;
		}
		this.#renderer._setLightingPreset(name, params);
		this.#requestFrame();
	}

	/**
	 * Translates the relative texture coordinates (0..1) of an image to screen
	 * coordinates in CSS pixels, relative to the canvas top-left.
	 *
	 * Uses the mesh's live (animated/displaced) geometry and the current camera,
	 * so it is valid at any point in time, including mid page-flip.
	 *
	 * Also reports two visibility facts about that point:
	 * - `facing`: whether the image's face points toward the camera (false =
	 *   backside / facing downwards).
	 * - `obscured`: whether the image's face has turned away from the camera
	 *   (front-side images once the page is flipped > 0.75, back-side images
	 *   while it is flipped < 0.25), or whether another page's surface is in
	 *   front of this point on screen (depth test via raycast).
	 *
	 * @returns screen position plus page/side and visibility info, or null when
	 *          the image is unknown, the coordinate is outside [0,1], the canvas
	 *          has no size, or the point is behind the camera.
	 */
	textureToScreen(
		imageId: string,
		u: number,
		v: number,
	): { x: number; y: number; pageIndex: number; side: 0 | 1; facing: boolean; obscured: boolean } | null {
		const ctx = this.#resolveTextureContext(imageId, u, v);
		if (!ctx) return null;

		const proj = this.#projectTextureToScreen(ctx.result._point);
		if (!proj) return null;

		const { facing, obscured } = this.#computeTextureVisibility(ctx.mesh, ctx.side, ctx.pageIndex, ctx.result, proj.screen);

		return { x: proj.screen.x, y: proj.screen.y, pageIndex: ctx.pageIndex, side: ctx.side, facing, obscured };
	}

	/**
	 * Returns a column-major 4x4 matrix (Float32Array(16)) suitable as a CSS
	 * `matrix3d` transform. It places the element so it lies flat on the image
	 * at the given coordinate, seen through the viewer's camera: the local X
	 * axis runs along the image's u direction, local Y along its v direction,
	 * and local Z out of the displayed face, then everything is projected
	 * through the camera's view-projection matrix (so the element is foreshort-
	 * ened in perspective like the page it sits on).
	 *
	 * The anchor of the object maps exactly to the screen pixel position that
	 * `textureToScreen` returns for the image coordinate (x, y). After the
	 * perspective divide `m[12]/m[15] = screenX` and `m[13]/m[15] = screenY`;
	 * the matrix is normalized so `m[15] = 1`, making `m[12]`/`m[13]` the
	 * literal pixel coordinates and `m[14] = 0`. The 4th row
	 * (`m[3]`, `m[7]`, `m[11]`) carries the perspective divide.
	 *
	 * `rotX/rotY/rotZ` rotate the object around its local axes and `scale` (in
	 * CSS pixels) is the object size preserved at the anchor's depth.
	 *
	 * Alongside the matrix it reports visibility facts, identical to
	 * `textureToScreen`:
	 * - `facing`: whether the image's face points toward the camera.
	 * - `obscured`: whether the image's face has turned away from the camera
	 *   (front-side images once the page is flipped > 0.5, back-side images
	 *   while it is flipped < 0.5), or whether another page's surface is in
	 *   front of this point on screen (depth test via raycast).
	 *
	 * @param imageId The micrio image id.
	 * @param x The image X coordinate (0-1).
	 * @param y The image Y coordinate (0-1).
	 * @param scale The object scale multiplier (in pixels).
	 * @param radius The object radius (distance from center, default 10). Ignored.
	 * @param rotX The object X rotation in radians.
	 * @param rotY The object Y rotation in radians.
	 * @param rotZ The object Z rotation in radians.
	 * @param transY Optional Y translation in 3D space. Ignored.
	 * @param scaleX Optional non-uniform X scaling.
	 * @param scaleY Optional non-uniform Y scaling.
	 *
	 * @returns the matrix plus visibility facts, or null when the image is
	 *          unknown or the coordinate is outside [0, 1].
	 */
	textureToMatrix(
		imageId: string,
		x: number,
		y: number,
		scale: number,
		radius?: number,
		rotX?: number,
		rotY?: number,
		rotZ?: number,
		transY?: number,
		scaleX?: number,
		scaleY?: number,
	): { matrix: Float32Array; facing: boolean; obscured: boolean } | null {
		void radius;
		void transY;

		const ctx = this.#resolveTextureContext(imageId, x, y);
		if (!ctx) return null;

		const proj = this.#projectTextureToScreen(ctx.result._point);
		if (!proj) return null;

		const { facing, obscured } = this.#computeTextureVisibility(ctx.mesh, ctx.side, ctx.pageIndex, ctx.result, proj.screen);

		const mesh = ctx.mesh;
		const n = ctx.result._normal;
		const px = ctx.result._point._x, py = ctx.result._point._y, pz = ctx.result._point._z;
		const { screen, viewProj, clientWidth, clientHeight } = proj;
		const perspective = proj.perspective;

		// World-space surface frame at the anchor point: unit u/v tangents (the
		// directions the image's u/v axes run on the deformed mesh) and the
		// outward normal of the displayed face (back faces of a single-grid
		// PaperMesh point the other way).
		const tU = ctx.result._tangentU;
		const tV = ctx.result._tangentV;
		const lenU = Math.sqrt(tU._x * tU._x + tU._y * tU._y + tU._z * tU._z) || 1;
		const lenV = Math.sqrt(tV._x * tV._x + tV._y * tV._y + tV._z * tV._z) || 1;
		const ux = tU._x / lenU, uy = tU._y / lenU, uz = tU._z / lenU;
		const vx = tV._x / lenV, vy = tV._y / lenV, vz = tV._z / lenV;
		const outward = (mesh instanceof CoverMesh || ctx.side === 0) ? 1 : -1;
		const nx = n._x * outward, ny = n._y * outward, nz = n._z * outward;

		// World-units per screen pixel at the *reference* view-space depth, so
		// `scale` means CSS pixels on screen at the default fit zoom: pixels =
		// f·H/(2·depth) per world unit with f = 1/tan(fov/2). The object gets a
		// fixed world size, so it scales with the page when the camera zooms.
		const f = perspective.arr[5];
		const worldPerPx = (2 * this.#referenceDepth) / (Math.max(1, clientHeight) * f);

		// Rotations (X, then Y, then Z) and scale, in object-local space.
		const rx = rotX ?? 0, ry = rotY ?? 0, rz = rotZ ?? 0;
		const cx = Math.cos(rx), sx = Math.sin(rx);
		const cy = Math.cos(ry), sy = Math.sin(ry);
		const cz = Math.cos(rz), sz = Math.sin(rz);
		const sX = scale * (scaleX ?? 1) * worldPerPx;
		const sY = scale * (scaleY ?? 1) * worldPerPx;
		const sZ = scale * worldPerPx;

		// Column-major 4x4 multiply: o = a · b.
		const mul4 = (a: Float32Array, b: Float32Array): Float32Array => {
			const o = new Float32Array(16);
			for (let c = 0; c < 4; c++) {
				for (let r = 0; r < 4; r++) {
					o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
						+ a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
				}
			}
			return o;
		};

		// Object-local rotations (X, then Y, then Z) and scale.
		const mRx = new Float32Array(16);
		mRx[0] = 1; mRx[5] = cx; mRx[6] = sx; mRx[9] = -sx; mRx[10] = cx; mRx[15] = 1;
		const mRy = new Float32Array(16);
		mRy[0] = cy; mRy[2] = -sy; mRy[5] = 1; mRy[8] = sy; mRy[10] = cy; mRy[15] = 1;
		const mRz = new Float32Array(16);
		mRz[0] = cz; mRz[1] = sz; mRz[4] = -sz; mRz[5] = cz; mRz[10] = 1; mRz[15] = 1;

		const mS = new Float32Array(16);
		mS[0] = sX; mS[5] = sY; mS[10] = sZ; mS[15] = 1;

		// Orient the object's local frame onto the page surface: X along image u,
		// Y along image v, Z along the outward normal.
		const mOrient = new Float32Array(16);
		mOrient[0] = ux; mOrient[1] = uy; mOrient[2] = uz;
		mOrient[4] = vx; mOrient[5] = vy; mOrient[6] = vz;
		mOrient[8] = nx; mOrient[9] = ny; mOrient[10] = nz;
		mOrient[15] = 1;

		// Translate to the anchor world point.
		const mPlace = new Float32Array(16);
		mPlace[0] = 1; mPlace[5] = 1; mPlace[10] = 1; mPlace[15] = 1;
		mPlace[12] = px; mPlace[13] = py; mPlace[14] = pz;

		// NDC → CSS pixels (y flipped, origin at the canvas top-left).
		const mPx = new Float32Array(16);
		mPx[0] = clientWidth * 0.5;
		mPx[5] = -clientHeight * 0.5;
		mPx[10] = 1;
		mPx[12] = clientWidth * 0.5;
		mPx[13] = clientHeight * 0.5;
		mPx[15] = 1;

		// Full chain: object scale → object rotation → surface orientation →
		// world → clip → screen. This produces a true perspective matrix so the
		// element renders foreshortened like it lies flat on the image.
		const vp64 = new Float32Array(viewProj.arr);
		const mWorld = mul4(mPlace, mul4(mOrient, mul4(mRz, mul4(mRy, mul4(mRx, mS)))));
		const out = mul4(mPx, mul4(vp64, mWorld));

		// Normalize by the anchor's clip-space w so its matrix column maps to
		// exactly its screen pixel position: m[12] = screenX, m[13] = screenY,
		// m[15] = 1 (m[14] forced to 0), while the bottom row m[3]/m[7]/m[11]
		// still carries the perspective divide.
		const invW = 1 / out[15];
		for (let i = 0; i < 16; i++) out[i] *= invW;
		out[12] = screen.x;
		out[13] = screen.y;
		out[14] = 0;
		out[15] = 1;

		return { matrix: out, facing, obscured };
	}

	// ═══════════════════════════════════════════════════════════════
	// Shared texture-coordinate helpers
	// ═══════════════════════════════════════════════════════════════

	#resolveTextureContext(imageId: string, u: number, v: number): TextureContext | null {
		if (this.#images.length === 0 || this.#meshes.length === 0) return null;

		const imageIndex = this.#images.findIndex(img => img.id === imageId);
		if (imageIndex < 0) return null;

		// Front texture of page p is images[2p], back texture is images[2p + 1].
		const pageIndex = Math.floor(imageIndex / 2);
		const side = (imageIndex % 2) as 0 | 1;
		if (pageIndex >= this.#meshes.length) return null;

		const mesh = this.#meshes[pageIndex];
		const result = uvToWorldPosition(mesh, u, v, side);
		if (!result) return null;

		return { pageIndex, side, mesh, result };
	}

	#getViewProjection(): { perspective: Mat4; viewProj: Mat4; clientWidth: number; clientHeight: number } | null {
		const canvas = this.#renderer._getCanvas();
		const clientWidth = canvas.clientWidth;
		const clientHeight = canvas.clientHeight;
		if (clientWidth <= 0 || clientHeight <= 0) return null;

		const view = this.#camera._getViewMatrix();
		const aspect = canvas.width / Math.max(1, canvas.height);
		const perspective = new Mat4();
		perspective._perspective(Math.PI * 0.25, aspect, 0.1, 50.0);
		// $render/mat's Mat4._multiply(o) computes `this = o·this`, so build
		// `perspective·view` by copying the view first, then multiplying by proj.
		const viewProj = new Mat4();
		viewProj._copy(view);
		viewProj._multiply(perspective);

		return { perspective, viewProj, clientWidth, clientHeight };
	}

	#projectTextureToScreen(
		point: Vec3,
	): { screen: { x: number; y: number }; perspective: Mat4; viewProj: Mat4; clientWidth: number; clientHeight: number } | null {
		const vp = this.#getViewProjection();
		if (!vp) return null;

		const screen = projectWorldToScreen(point, vp.viewProj, vp.clientWidth, vp.clientHeight);
		if (!screen) return null;

		return { screen, ...vp };
	}

	#computeTextureVisibility(
		mesh: PaperMesh,
		side: 0 | 1,
		pageIndex: number,
		result: UvWorldResult,
		screen: { x: number; y: number },
	): { facing: boolean; obscured: boolean } {
		const world = result._point;
		const n = result._normal;

		// Facing: does the face that displays this image point toward the camera?
		// A single-grid PaperMesh's back texture is on the reverse side of the
		// front normal; a CoverMesh's back face has its own outward normal.
		const eye = this.#camera._getEye();
		const dot = n._x * (eye._x - world._x)
			+ n._y * (eye._y - world._y)
			+ n._z * (eye._z - world._z);
		const facing = (mesh instanceof CoverMesh || side === 0) ? dot > 0 : dot < 0;

		// Obscured: a page's face that has turned away from the camera is not on
		// screen. Which face that is depends on the flip progress — at 0 (right
		// side) the front face points up, at 1 (left side) the back face points
		// up. So a front-side image is obscured once progress exceeds 0.5, and a
		// back-side image is obscured below 0.5. Otherwise check whether another
		// page's surface is in front of this point at its screen pixel (depth
		// test via raycast).
		const progress = this.#flipAnimator._getPageProgress(pageIndex);
		let obscured = side === 0 ? progress > 0.5 : progress < 0.5;
		if (!obscured) {
			const { origin, direction } = this.#camera._getPickRay(screen.x, screen.y);
			const hit = rayIntersectMeshes(this.#meshes, origin, direction);
			if (hit) {
				const tTarget = (world._x - origin._x) * direction._x
					+ (world._y - origin._y) * direction._y
					+ (world._z - origin._z) * direction._z;
				if (hit._t < tTarget - 1e-4) obscured = true;
			}
		}

		return { facing, obscured };
	}

	#gotoInstant(pageIdx: number): void {
		this.#currentPage = pageIdx;
		this.#selectedPage = pageIdx;

		const progress = new Float32Array(this.#pageCount);
		for (let pi = 0; pi < this.#pageCount; pi++) {
			const isFlipped = pi < pageIdx;
			progress[pi] = isFlipped ? 1 : 0;
			this.#flipAnimator._setPageProgress(pi, progress[pi]);
			if (isFlipped) {
				this.#flipAnimator._instantFlip(this.#meshes[pi], pi);
			} else {
				this.#meshes[pi]._positions.set(this.#meshes[pi]._restPositions);
				this.#meshes[pi]._velocities.fill(0);
			}

			this.#activePageSet.delete(pi);
		}

		const weightFactor = computeWeightFactor(progress, this.#pageCount);
		for (let pi = 0; pi < this.#pageCount; pi++) {
			const targetY = computePageSpineY(pi, progress[pi], weightFactor, this.#totalStackHeight, this.#pageCount, PAGE_THICKNESS);
			this.#snapPageSpineY(pi, targetY, true, true);
			this.#renderer._updateVertexBuffer(pi, this.#meshes[pi]);
			this.#renderer._updateNormalBuffer(pi, this.#meshes[pi]);
		}

		this.#renderer._setFlipProgress(progress);

		this.#gotoDamping = false;
		this.#onPageChange?.(this.#currentPage);
	}

	_getCurrentPage(): number {
		return this.#currentPage;
	}

	_getPageCount(): number {
		return this.#pageCount;
	}

	_nextPage(grabRow?: number): void {
		if (this.#flipAnimator && this.#currentPage < this.#pageCount) {
			this.#inputHandler._operation = 'none';
			this.#selectedPage = this.#currentPage;
			const useGrabRow = grabRow ?? this.#inputHandler._lastClickGrabRow ?? undefined;
			this.#inputHandler._lastClickGrabRow = null;
			this.#flipAnimator._flipLeft(this.#selectedPage, useGrabRow);
			this.#currentPage++;
			this.#onPageChange?.(this.#currentPage);
			this.#requestFrame();
		}
	}

	_prevPage(grabRow?: number): void {
		if (this.#flipAnimator && this.#currentPage > 0) {
			this.#inputHandler._operation = 'none';
			this.#currentPage--;
			this.#selectedPage = this.#currentPage;
			const useGrabRow = grabRow ?? this.#inputHandler._lastClickGrabRow ?? undefined;
			this.#inputHandler._lastClickGrabRow = null;
			this.#flipAnimator._flipRight(this.#selectedPage, useGrabRow);
			this.#onPageChange?.(this.#currentPage);
			this.#requestFrame();
		}
	}

	// ═══════════════════════════════════════════════════════════════
	// Private internals
	// ═══════════════════════════════════════════════════════════════

	#requestFrame = (): void => {
		if (this.#animFrameId) {
			cancelAnimationFrame(this.#animFrameId);
		}
		this.#animFrameId = requestAnimationFrame((time) => this.#frame(time));
	};

	async #init(options: BookViewerOptions): Promise<void> {
		const images = options._images;
		if (!images || images.length === 0) {
			throw new Error('BookViewer: no images in book index');
		}

		const { pageCnt, pageIdxes, totalImagePages, computedPageWidths, aspectsForInit } = computePageLayout(images, options);
		this.#images = images;

		const ok = this.#initGeometry(pageCnt, computedPageWidths, aspectsForInit, options);
		if (!ok) {
			throw new Error('BookViewer: WebGL is not available in this browser.');
		}

		const startPageIdx = options._startPageIdx;
		if (startPageIdx !== undefined && startPageIdx > 0 && startPageIdx < totalImagePages) {
			const pageIdx = Math.min(Math.ceil(startPageIdx / 2), this.#pageCount - 1);
			this.#gotoInstant(pageIdx);
		}

		await initWasmSolver(this.#meshes, this.#pageCount);

		await this.#loadPageTextures(images);

		this.#iiifManager = new IIIFTextureManager(this.#renderer, options._iiifBaseUrl);
		this.#iiifManager._onRequestFrame = () => this.#requestFrame();
		this.#iiifManager._init(images, this.#pageCount, pageIdxes);

		this.#onPageChange?.(this.#currentPage);

		setTimeout(() => {
			this.#requestFrame();
		}, 500);
	}

	#initGeometry(pageCnt: number, pWidths: Float32Array, aspects: Float32Array, options: BookViewerOptions): boolean {
		this.#pageCount = pageCnt;
		this.#pageWidths = pWidths;
		this.#pageAspects = aspects;

		const canvas = this.#canvas;

		let gl: WebGL2RenderingContext | null = canvas.getContext('webgl2', {
			alpha: true,
			premultipliedAlpha: true,
			antialias: true,
		});

		if (!gl) {
			console.warn('BookViewer: WebGL not available');
			return false;
		}

		this.#camera = new OrbitCamera();
		this.#camera._target._set(0, 0, 0);
		this.#camera._theta = 0;
		this.#camera._phi = DEFAULT_CAMERA_PHI;
		this.#camera._radius = 2.2;
		this.#camera._snap();

		let maxWidth = 0;
		let maxHeight = 0;
		for (let i = 0; i < this.#pageCount; i++) {
			const w = this.#pageWidths[i];
			const h = w * this.#pageAspects[i];
			if (w > maxWidth) maxWidth = w;
			if (h > maxHeight) maxHeight = h;
		}

		this.#meshes.length = 0;
		for (let i = 0; i < this.#pageCount; i++) {
			const yOff = (this.#pageCount - 1 - i) * PAGE_THICKNESS;
			const pw = this.#pageWidths[i];
			const asp = this.#pageAspects[i];
			if (this.#hardCover && (i === 0 || i === this.#pageCount - 1)) {
				const wScale = maxWidth / pw;
				const hScale = maxHeight / (pw * asp);
				const coverScaleX = Math.max(COVER_SCALE_X, wScale);
				const coverScaleY = Math.max(COVER_SCALE_Y, hScale);
				const cover = new CoverMesh(yOff, pw, asp, PAGE_THICKNESS * COVER_THICKNESS_MULTIPLIER, coverScaleX, coverScaleY);
				this.#meshes.push(cover);
			} else {
				this.#meshes.push(new PaperMesh(yOff, pw, asp));
			}
		}

		this.#activePageSet.clear();
		this.#prevPositions.length = 0;
		for (let i = 0; i < this.#pageCount; i++) {
			this.#prevPositions.push(new Float32Array(this.#meshes[i]._positions));
		}

		this.#totalStackHeight = this.#pageCount * PAGE_THICKNESS;

		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		for (const m of this.#meshes) {
			const pos = m._restPositions;
			for (let i = 0; i < pos.length; i += 3) {
				if (pos[i] < minX) minX = pos[i];
				if (pos[i] > maxX) maxX = pos[i];
				if (pos[i + 1] < minY) minY = pos[i + 1];
				if (pos[i + 1] > maxY) maxY = pos[i + 1];
				if (pos[i + 2] < minZ) minZ = pos[i + 2];
				if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
			}
		}
		const absX = Math.max(Math.abs(minX), Math.abs(maxX));
		this.#camera._panBoundsMin = new Vec3(-absX, minY, minZ);
		this.#camera._panBoundsMax = new Vec3(absX, maxY, maxZ);

		this.#renderer = new PaperRenderer(gl);
		this.#renderer._tiltShiftEnabled = options._tiltShift ?? TILT_SHIFT_ENABLED;
		this.#renderer._initialize(this.#meshes);
		this.#renderer._setBoundingBox(
			{ x: this.#camera._panBoundsMin!._x, y: this.#camera._panBoundsMin!._y, z: this.#camera._panBoundsMin!._z },
			{ x: this.#camera._panBoundsMax!._x, y: this.#camera._panBoundsMax!._y, z: this.#camera._panBoundsMax!._z },
		);
		this.#camera._setCanvasSize(canvas.clientWidth, canvas.clientHeight);

		{
			const margin = Math.min(canvas.clientWidth, canvas.clientHeight) * VIEWPORT_MARGIN_PCT;
			this.#camera._initContainRadius({ minX, maxX, minZ, maxZ }, margin);
		}
		this.#referenceDepth = this.#camera._radius;

		this.#flipAnimator = new PageFlipAnimator();
		this.#flipAnimator._initSlots(this.#pageCount);

		if (this.#hardCover) {
			this.#flipAnimator._hardCoverPages = new Set([0, this.#pageCount - 1]);
		}

		this.#inputHandler = new InputHandler(canvas, this.#camera, this.#requestFrame);
		this.#inputHandler._isZoomedInFn = () => this.isZoomedIn();

		const preset = options._lightingPreset ?? LIGHTING_PRESET;
		this.setLightingPreset(preset);

		this.#applyBinding();
		this.#setupInputCallbacks();
		this.#setupResizeAndContextHandlers(canvas);

		document.addEventListener('visibilitychange', () => {
			if (document.hidden) {
				this.#lastTime = 0;
			}
		});

		return true;
	}

	#applyBinding(): void {
		for (const m of this.#meshes) {
			m._setBinding();
		}
		this.#flipAnimator._reset(this.#meshes);
	}

	#setupInputCallbacks(): void {
		this.#inputHandler._onPrevPage = () => {
			this._prevPage();
		};
		this.#inputHandler._onNextPage = () => {
			this._nextPage();
		};
		this.#inputHandler._onPageClick = this.#handlePageClick;
		this.#inputHandler._onWheelZoom = (sx, sy) => this.#handleZoomRaycast(sx, sy);

		this.#inputHandler._onPageDragStart = (startX, startY) => {
			const result = this.#raycastForDrag(startX, startY);
			if (!result) return;

			const canvas = this.#renderer._getCanvas();
			const rect = canvas.getBoundingClientRect();
			const sx = startX - rect.left;
			const sy = startY - rect.top;
			const { origin, direction } = this.#camera._getPickRay(sx, sy);
			if (Math.abs(direction._y) >= 1e-8) {
				this.#dragStartCursorWorldX = origin._x + direction._x * (-origin._y / direction._y);
			} else {
				this.#dragStartCursorWorldX = 0;
			}

			this.#dragPageIndex = result.pageIndex;
			this.#dragStartProgress = this.#flipAnimator._getPageProgress(this.#dragPageIndex);
			this.#flipAnimator._beginDrag(this.#dragPageIndex, result.grabRow);
			this.#selectedPage = this.#dragPageIndex;
			this.#activePageSet.add(this.#dragPageIndex);
			this.#requestFrame();
		};

		this.#inputHandler._onPageDragMove = (x, y) => {
			if (this.#dragPageIndex < 0 || this.#dragPageIndex >= this.#pageCount) return;

			const canvas = this.#renderer._getCanvas();
			const rect = canvas.getBoundingClientRect();
			const sx = x - rect.left;
			const sy = y - rect.top;
			const { origin, direction } = this.#camera._getPickRay(sx, sy);

			if (Math.abs(direction._y) < 1e-8) { this.#requestFrame(); return; }
			const t = -origin._y / direction._y;
			const worldX = origin._x + direction._x * t;

			const mesh = this.#meshes[this.#dragPageIndex];
			const displacement = this.#dragStartCursorWorldX - worldX;
			const totalDistance = displacement > 0
				? this.#dragStartCursorWorldX + mesh._paperWidth
				: mesh._paperWidth - this.#dragStartCursorWorldX;
			const progress = this.#dragStartProgress + displacement / Math.max(0.01, totalDistance);
			this.#flipAnimator._setDragProgress(this.#dragPageIndex, Math.max(0.0, Math.min(1.0, progress)));
			this.#selectedPage = this.#dragPageIndex;
			this.#requestFrame();
		};

		this.#inputHandler._onPageDragEnd = () => {
			if (this.#dragPageIndex < 0 || this.#dragPageIndex >= this.#pageCount) {
				this.#dragPageIndex = -1;
				return;
			}
			const progress = this.#flipAnimator._getPageProgress(this.#dragPageIndex);

			const startedOnRight = this.#dragStartProgress <= 0.5;
			const startedOnLeft = this.#dragStartProgress >= 0.5;
			const crossedToLeft = startedOnRight && progress > 0.5;
			const crossedToRight = startedOnLeft && progress < 0.5;

			if (crossedToLeft) {
				this.#flipAnimator._endDrag(this.#dragPageIndex, +1);
				if (this.#dragPageIndex === this.#currentPage && this.#currentPage < this.#pageCount) {
					this.#currentPage++;
					this.#onPageChange?.(this.#currentPage);
				}
			} else if (crossedToRight) {
				this.#flipAnimator._endDrag(this.#dragPageIndex, -1);
				if (this.#dragPageIndex === this.#currentPage - 1 && this.#currentPage > 0) {
					this.#currentPage--;
					this.#onPageChange?.(this.#currentPage);
				}
			} else {
				this.#flipAnimator._endDrag(this.#dragPageIndex, startedOnRight ? -1 : +1);
			}
			this.#dragPageIndex = -1;
			this.#requestFrame();
		};
	}

	#setupResizeAndContextHandlers(canvas: HTMLCanvasElement): void {
		window.addEventListener('resize', () => {
			this.#renderer._resize();
			this.#camera._setCanvasSize(canvas.clientWidth, canvas.clientHeight);
			this.#requestFrame();
		});

		canvas.addEventListener('webglcontextlost', (e) => {
			console.warn('WebGL context lost.');
			e.preventDefault();
		});

		canvas.addEventListener('webglcontextrestored', () => {
			console.log('WebGL context restored.');
			const gl = canvas.getContext('webgl2', {
				alpha: true,
				premultipliedAlpha: true,
				antialias: true,
			}) as WebGL2RenderingContext | null;
			if (gl && this.#renderer) {
				this.#renderer = new PaperRenderer(gl);
				this.#renderer._initialize(this.#meshes);
			}
		});
	}

	#raycastForDrag(screenX: number, screenY: number): PageDragResult | null {
		const canvas = this.#renderer._getCanvas();
		const rect = canvas.getBoundingClientRect();
		const sx = screenX - rect.left;
		const sy = screenY - rect.top;

		if (rect.width <= 0 || rect.height <= 0) return null;

		const { origin, direction } = this.#camera._getPickRay(sx, sy);
		const hit = rayIntersectMeshes(this.#meshes, origin, direction);
		if (!hit) return null;

		const mesh = this.#meshes[hit._meshIndex];
		const grabRow = 0.5 - hit._point._z / mesh._paperHeight;
		const clampedGrabRow = Math.max(0.0, Math.min(1.0, grabRow));

		return {
			pageIndex: hit._meshIndex,
			grabRow: clampedGrabRow,
			worldX: hit._point._x,
		};
	}

	#handlePageClick = (screenX: number, screenY: number): PageClickResult | null => {
		const canvas = this.#renderer._getCanvas();
		const rect = canvas.getBoundingClientRect();
		const sx = screenX - rect.left;
		const sy = screenY - rect.top;

		if (rect.width <= 0 || rect.height <= 0) return null;

		const { origin, direction } = this.#camera._getPickRay(sx, sy);
		const hit = rayIntersectMeshes(this.#meshes, origin, direction);
		if (!hit) return null;

		const mesh = this.#meshes[hit._meshIndex];
		const grabRow = 0.5 - hit._point._z / mesh._paperHeight;
		const clampedGrabRow = Math.max(0.0, Math.min(1.0, grabRow));

		return {
			direction: hit._point._x < 0 ? 'prev' : 'next',
			grabRow: clampedGrabRow,
		};
	};

	#handleZoomRaycast(sx: number, sy: number): Vec3 | null {
		const { origin, direction } = this.#camera._getPickRay(sx, sy);
		const hit = rayIntersectMeshes(this.#meshes, origin, direction);
		return hit?._point ?? null;
	}

	#getDrawnImages(): { id: string; pageIndex: number; side: 0 | 1 }[] {
		const drawn: { id: string; pageIndex: number; side: 0 | 1 }[] = [];
		const push = (pageIndex: number, side: 0 | 1): void => {
			const img = this.#images[pageIndex * 2 + side];
			if (img && !drawn.some(d => d.id === img.id)) {
				drawn.push({ id: img.id, pageIndex, side });
			}
		};

		// The open spread: right page shows its front, left page its back.
		push(this.#currentPage, 0);
		push(this.#currentPage - 1, 1);

		// Any page mid-flip is in view and shows both sides while rotating. It
		// also still reveals part of the spread it's leaving: include the far
		// page of the outgoing spread (the page it is about to cover).
		for (let pi = 0; pi < this.#pageCount; pi++) {
			const progress = this.#flipAnimator._getPageProgress(pi);
			if (progress > 0 && progress < 1) {
				push(pi, 0);
				push(pi, 1);
				const dir = this.#flipAnimator._getPageDirection(pi);
				if (dir < 0) {
					push(pi + 1, 0); // flipping back: outgoing right page's front
				} else if (dir > 0) {
					push(pi - 1, 1); // flipping forward: outgoing left page's back
				} else {
					push(pi - 1, 1); // drag: direction unknown, include both neighbours
					push(pi + 1, 0);
				}
			}
		}

		return drawn;
	}

	#getDrawnImageBounds(): DrawnImage[] {
		const vp = this.#getViewProjection();
		if (!vp) return [];

		const out: DrawnImage[] = [];
		for (const d of this.#getDrawnImages()) {
			const bounds = this.#computeImageVisibleUv(d.pageIndex, d.side, vp);
			if (bounds) out.push({ id: d.id, bounds });
		}
		return out;
	}

	// Samples the image's quad on a dense UV grid, projects each sample to the
	// screen and keeps the min/max UV of the samples that fall inside the
	// viewport. Returns null when nothing of the image is on screen.
	#computeImageVisibleUv(
		pageIndex: number,
		side: 0 | 1,
		vp: { viewProj: Mat4; clientWidth: number; clientHeight: number },
	): [number, number, number, number] | null {
		const mesh = this.#meshes[pageIndex];
		const steps = 32;
		let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
		let visible = 0;

		for (let i = 0; i <= steps; i++) {
			const u = i / steps;
			for (let j = 0; j <= steps; j++) {
				const v = j / steps;
				const point = sampleMeshPosition(mesh, u, v, side);
				if (!point) continue;
				const screen = projectWorldToScreen(point, vp.viewProj, vp.clientWidth, vp.clientHeight);
				if (!screen) continue;
				if (screen.x < 0 || screen.x > vp.clientWidth || screen.y < 0 || screen.y > vp.clientHeight) continue;
				if (u < minU) minU = u;
				if (v < minV) minV = v;
				if (u > maxU) maxU = u;
				if (v > maxV) maxV = v;
				visible++;
			}
		}

		if (visible === 0) return null;
		return [minU, minV, maxU - minU, maxV - minV];
	}

	#frame = (time: number): void => {
		this.#animFrameId = 0;
		if (this.#lastTime === 0) this.#lastTime = time;
		let dt = (time - this.#lastTime) / 1000;
		if (dt <= 0) dt = 1 / 60;
		if (dt > 1 / 30) dt = 1 / 30;
		this.#lastTime = time;

		this.#flipAnimator._update(dt, this.#meshes, this.#selectedPage, this.#totalStackHeight, this.#pageCount, PAGE_THICKNESS);

		const progress = new Float32Array(this.#pageCount);
		for (let pi = 0; pi < this.#pageCount; pi++) {
			progress[pi] = this.#flipAnimator._getPageProgress(pi);
		}

		this.#renderer._setFlipProgress(progress);

		const weightFactor = computeWeightFactor(progress, this.#pageCount);

		this.#snapPassivePages(progress, weightFactor);
		this.#snapHardCovers(progress, weightFactor);
		this.#snapSettlingActivePages(progress, weightFactor);

		for (let pi = 0; pi < this.#pageCount; pi++) {
			if (this.#flipAnimator._isPageAnimating(pi)) {
				this.#activePageSet.add(pi);
			}
		}

		if (this.#gotoDamping && this.#gotoRafId === 0 && !this.#flipAnimator._animating) {
			this.#gotoDamping = false;
		}

		this.#dispatchPhysics(dt, progress);
		this.#syncSolverResults();
		this.#updateRenderBuffersForActivePages();
		if (this.#iiifManager) {
			this.#iiifManager._onFrame(time, this.#currentPage, this.#camera._radius);
		}
		this.#camera._update(dt);
		this.#updateViewportClamp();
		if (this.#onViewChange && this.#camera._isMoving()) {
			this.#onViewChange();
		}
		this.#renderer._render(this.#camera);
		const drawn = this.#getDrawnImageBounds();
		this.#lastDrawnImages = drawn;
		if (this.#onDraw) {
			this.#onDraw(drawn);
		}

		const shouldContinue = (
			this.#activePageSet.size > 0 ||
			this.#flipAnimator._animating ||
			(this.#inputHandler && this.#inputHandler._operation !== 'none') ||
			this.#renderer._isLightingAnimated() ||
			this.#camera._isMoving()
		);

		if (shouldContinue) {
			this.#requestFrame();
		}
	};

	#syncSolverResults(): void {
		if (!isWasmReady()) return;

		for (let pi = 0; pi < this.#pageCount; pi++) {
			if (!this.#activePageSet.has(pi)) continue;
			if (this.#flipAnimator._isPageAnimating(pi) || this.#flipAnimator._isPageDragging(pi)) continue;

			const pos = this.#meshes[pi]._positions;
			const prev = this.#prevPositions[pi];
			let maxDelta = 0;
			for (let i = 0; i < pos.length; i++) {
				const d = Math.abs(pos[i] - prev[i]);
				if (d > maxDelta) maxDelta = d;
			}
			if (maxDelta < DELTA_IDLE_THRESHOLD) {
				this.#activePageSet.delete(pi);
			}
		}

		for (let pi = 0; pi < this.#pageCount; pi++) {
			this.#prevPositions[pi].set(this.#meshes[pi]._positions);
		}

		this.#solveCount++;
	}

	#snapPageSpineY(pi: number, targetY: number, updateRenderer: boolean, updatePrev: boolean): void {
		const m = this.#meshes[pi];
		const delta = targetY - m._positions[1];
		if (Math.abs(delta) <= 0.0001) return;

		applySpineDelta(m._positions, delta);

		if (updatePrev && this.#prevPositions[pi]) {
			applySpineDelta(this.#prevPositions[pi], delta);
		}
		if (updateRenderer) {
			this.#renderer._updateVertexBuffer(pi, m);
			this.#renderer._updateNormalBuffer(pi, m);
		}
	}

	#snapPassivePages(progress: Float32Array, weightFactor: number): void {
		for (let pi = 0; pi < this.#pageCount; pi++) {
			if (this.#activePageSet.has(pi)) continue;
			if (this.#flipAnimator._isPageAnimating(pi)) continue;
			if (this.#hardCover && this.#flipAnimator._hardCoverPages.has(pi)) continue;

			const targetY = computePageSpineY(pi, progress[pi], weightFactor, this.#totalStackHeight, this.#pageCount, PAGE_THICKNESS);
			this.#snapPageSpineY(pi, targetY, true, true);
		}
	}

	#snapHardCovers(progress: Float32Array, weightFactor: number): void {
		if (!this.#hardCover) return;
		for (const pi of this.#flipAnimator._hardCoverPages) {
			const targetY = computePageSpineY(pi, progress[pi], weightFactor, this.#totalStackHeight, this.#pageCount, PAGE_THICKNESS);
			this.#snapPageSpineY(pi, targetY, true, false);
		}
	}

	#snapSettlingActivePages(progress: Float32Array, weightFactor: number): void {
		for (let pi = 0; pi < this.#pageCount; pi++) {
			if (!this.#activePageSet.has(pi)) continue;
			if (this.#flipAnimator._isPageAnimating(pi)) continue;
			if (this.#flipAnimator._isPageDragging(pi)) continue;
			if (this.#hardCover && this.#flipAnimator._hardCoverPages.has(pi)) continue;

			const targetY = computePageSpineY(pi, progress[pi], weightFactor, this.#totalStackHeight, this.#pageCount, PAGE_THICKNESS);
			this.#snapPageSpineY(pi, targetY, false, true);
		}
	}

	#dispatchPhysics(dt: number, progress: Float32Array): void {
		if (!isWasmReady()) return;

		const activeIndices = Array.from(this.#activePageSet);
		if (activeIndices.length === 0) return;

		const subDt = dt / this.#solverSettings._substeps;
		this.#solverSettings._damping = this.#gotoDamping ? GOTO_DAMPING : DAMPING;
		dispatchSolve(subDt, activeIndices, this.#solverSettings._substeps, this.#solverSettings, this.#meshes, progress, this.#totalStackHeight, this.#pageCount, PAGE_THICKNESS);
	}

	#updateRenderBuffersForActivePages(): void {
		for (const pi of this.#activePageSet) {
			this.#renderer._updateVertexBuffer(pi, this.#meshes[pi]);
			this.#renderer._updateNormalBuffer(pi, this.#meshes[pi]);
		}
	}

	#updateViewportClamp(): void {
		const near = 0.1;
		const far = 50.0;
		const canvasSize = this.#renderer._getCanvasSize();
		const proj = new Mat4();
		proj._perspective(Math.PI * 0.25, canvasSize.width / Math.max(1, canvasSize.height), near, far);
		const view = this.#camera._getViewMatrix();
		// $render/mat's Mat4._multiply(o) computes `this = o·this`, so build
		// `proj·view` by copying the view first, then multiplying by proj.
		const viewProj = new Mat4();
		viewProj._copy(view);
		viewProj._multiply(proj);
		const screenBounds = this.#renderer._getBoundingBoxScreenBounds(viewProj);
		if (screenBounds) {
			const margin = Math.min(canvasSize.width, canvasSize.height) * VIEWPORT_MARGIN_PCT;
			this.#camera._clampViewport(screenBounds, canvasSize.width, canvasSize.height, margin);
		}
	}

	async #loadPageTextures(images: Models.ImageInfo.ImageInfo[]): Promise<void> {
		const pageCnt = Math.ceil(images.length / 2);

		const pagePromises: Promise<void>[] = [];
		for (let p = 0; p < pageCnt; p++) {
			const frontImg = images[p * 2];
			const backImg = images[p * 2 + 1];

			pagePromises.push((async () => {
				try {
					const frontBitmap = await archive._getImageById(frontImg.id);
					const backBitmap = backImg ? await archive._getImageById(backImg.id) : frontBitmap;
					this.#renderer._setPageTextures(p, frontBitmap, backBitmap);
				} catch (err) {
					console.warn(`Failed to load textures for page ${p}:`, err);
				}
			})());
		}

		await Promise.all(pagePromises);
	}
}
