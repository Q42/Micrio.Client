import type { MicrioImage } from './image';
import type { Models } from '$types/models';
import type TileCanvas from '$render/tile-canvas';

import { tick } from '$core/store';
import { mod, toCenterJSON } from '$utils/math';
import { Enums } from './enums';

/**
 * Represents the virtual camera used to view a {@link MicrioImage}.
 * Provides methods for controlling the viewport (position, zoom, rotation),
 * converting between screen and image coordinates, and managing animations.
 *
 * Instances are typically accessed via `micrioImage.camera`.
 * @author Marcel Duin <marcel@micr.io>
 */
export class Camera {
	/** Current center screen coordinates [x, y] and scale [z]. For 360, also includes [yaw, pitch]. For Omni, also includes [frameIndex]. */
	readonly center: Models.Camera.Coords = [0, 0, 1];

	/** CORRECT view: [x0, y0, width, height] */
	readonly #view: Models.Camera.View = [0, 0, 1, 1];

	/** Y-axis sphere rotation in radians for 360 images. @internal */
	rotationY: number = 0;

	/** Direct reference to the engine TileCanvas for compute operations. @internal */
	#canvas?: TileCanvas;

	/** Promise resolve function called when a camera animation completes successfully. @internal */
	aniDone: Function | undefined;

	/** Promise reject function called when a camera animation is aborted (e.g., by user interaction). @internal */
	aniAbort: Function | undefined;

	/** Array of additional callbacks to execute when an animation finishes. Used for queuing actions. @internal */
	aniDoneAdd: Function[] = [];

	/**
	 * Creates a Camera instance.
	 * @internal
	 * @param image The parent {@link MicrioImage} instance.
	 */
	constructor(
		/** @internal The parent MicrioImage instance. */
		public image: MicrioImage,
	) {
		// For non-360 images, set initial view if already available
		if (!image.is360) {
			const view = image.state.$view;
			if (view && image.$info?.width) tick().then(() => this.setView(view));
		}
	}

	/**
	 * Binds the engine TileCanvas instance for direct compute operations.
	 * @internal
	 */
	bindEngineCanvas(canvas: TileCanvas): void {
		this.#canvas = canvas;
	}

	// ─── View / coordinate transforms ──────────────────────────────

	/**
	 * Gets the current image view rectangle.
	 * @returns A copy of the current screen viewport array, or undefined if not initialized.
	 */
	public getView = (): Models.Camera.View => this.#view;

	/**
	 * Gets the current image view rectangle [x0, y0, width, height] relative to the image (0-1).
	 * @returns The live Float64Array buffer from the engine.
	 */
	public getViewRaw = (): Float64Array => { return this.#canvas?.view.arr ?? new Float64Array(4); };

	/**
	 * Sets the camera view instantly to the specified viewport.
	 * @param view The target viewport as a View [x0, y0, width, height].
	 * @param opts Options for setting the view.
	 */
	setView(view: Models.Camera.View, opts: {
		/** If true, allows setting a view outside the normal image boundaries. */
		noLimit?: boolean;
		/** If true (for 360), corrects the view based on the `trueNorth` setting. */
		correctNorth?: boolean;
		/** If true, prevents triggering a render after setting the view. */
		noRender?: boolean;
		/** If provided, interprets `view` relative to this sub-area instead of the full image. */
		area?: Models.Camera.View;
	} = {}): void {
		if (!this.#canvas) return;
		let { centerX, centerY, width, height } = toCenterJSON(view);
		if (opts.area) {
			centerX = opts.area[0] + centerX * opts.area[2];
			centerY = opts.area[1] + centerY * opts.area[3];
			width *= opts.area[2];
			height *= opts.area[3];
		}
		this.#canvas.setView(centerX, centerY, width, height, !!opts.noLimit, false, opts.correctNorth);
		if (!opts.noRender) this.image.engine.render();
	}

	/**
	 * Gets the relative image coordinates [x, y, scale, depth, yaw?, pitch?] corresponding to a screen coordinate.
	 * Rounds the result for cleaner output.
	 * @param x The screen X coordinate in pixels.
	 * @param y The screen Y coordinate in pixels.
	 * @param absolute If true, treats x/y as absolute browser window coordinates.
	 * @param noLimit If true, allows returning coordinates outside the image bounds (0-1).
	 * @returns A Float64Array containing the relative image coordinates [x, y, scale, depth, yaw?, pitch?].
	 */
	getCoo(x: number, y: number, absolute = false, noLimit = false): Float64Array {
		return this.getCooDirect(x, y, absolute, noLimit)
			.slice(0).map(d => Math.round(d * 1000000) / 1000000);
	}

	/**
	 * Gets image coordinates [x, y, scale, depth, yaw?, pitch?] for given screen coordinates. Calls engine directly.
	 * @internal
	 */
	getCooDirect(x: number, y: number, abs = false, noLimit = false) {
		const c = this.#canvas;
		if (!c) return new Float64Array(5);
		if (abs) {
			const box = this.image.engine.micrio.getBoundingClientRect();
			x -= box.left; y -= box.top;
		}
		return (c.is360 ? c.webgl.getCoo(x, y) : c.camera.getCoo(x, y, !!abs, !!noLimit)).arr;
	}

	/**
	 * Gets the screen coordinates [x, y, scale, depth] corresponding to relative image coordinates.
	 * @param x The image X coordinate (0-1).
	 * @param y The image Y coordinate (0-1).
	 * @param abs If true, returns absolute browser window coordinates instead of element-relative.
	 * @param radius Optional offset radius for 360 calculations.
	 * @param rotation Optional offset rotation (radians) for 360 calculations.
	 * @param noTrueNorth If true (for 360), ignores the `trueNorth` correction.
	 * @returns A Float64Array containing the screen coordinates [x, y, scale, depth].
	 */
	getXY(x: number, y: number, abs = false, radius?: number, rotation?: number, noTrueNorth?: boolean): Float64Array {
		return this.getXYDirect(x, y, { abs, radius, rotation, noTrueNorth }).slice(0);
	}

	/**
	 * Gets screen coordinates [x, y, scale, depth] for given image coordinates. Calls engine directly.
	 * @internal
	 */
	getXYDirect(x: number, y: number, opts: {
		abs?: boolean; radius?: number; rotation?: number; noTrueNorth?: boolean;
	} = {}) {
		const c = this.#canvas;
		if (!c) return new Float64Array(5);
		const tNDiff = (this.image.is360 && !opts.noTrueNorth) ? -this.rotationY / (Math.PI * 2) : 0;
		if (c.is360) return c.webgl.getXYZ(x - tNDiff, y).arr;
		if (opts.rotation !== undefined && !isNaN(opts.rotation))
			return c.camera.getXYOmni(x - tNDiff, y, opts.radius ?? 0, opts.rotation, !!opts.abs).arr;
		return c.camera.getXY(x - tNDiff, y, !!opts.abs).arr;
	}

	/**
	 * Sets the center of the screen to the specified image coordinates and scale instantly.
	 * @param x The target image X coordinate (0-1).
	 * @param y The target image Y coordinate (0-1).
	 * @param scale The target scale (optional, defaults to current scale).
	 */
	setCoo(x: number, y: number, scale = this.center[2] ?? 1): void {
		if (!this.#canvas) return;
		this.#canvas.camera.setCoo(x, y, scale, 0, 0, false, 0, performance.now());
		this.image.engine.render();
	}

	// ─── Camera properties ─────────────────────────────────────────

	/** Gets the current camera zoom scale. */
	getScale = (): number => this.center[2] ?? 1;

	/** Gets the scale at which the image fully covers the viewport. */
	getCoverScale = (): number => this.#canvas?.camera.coverScale ?? 1;

	getMinScale = (): number => this.#canvas?.camera.minScale ?? 0.1;

	setMinScale(s: number): void {
		if (!this.#canvas) return;
		this.#canvas.camera.minScale = s;
		this.#canvas.camera.correctMinMax();
		this.#canvas.camera.setView();
		this.#canvas.webgl.update();
	}

	setMinScreenSize(s: number): void { if (!this.image.album && this.#canvas) this.#canvas.camera.minSize = Math.max(0, Math.min(1, s)); }

	/** Checks if the camera is zoomed in to the maximum allowed scale or beyond. */
	isZoomedIn = (): boolean => !!(this.#canvas?.isZoomedIn());

	/** Checks if the camera is fully zoomed out. */
	isZoomedOut = (full = false): boolean => !!(this.#canvas?.isZoomedOut(full));

	/** Gets the current viewing direction (yaw) in 360 mode. @returns The current yaw in radians. */
	getDirection = (): number => this.#canvas?.webgl.yaw ?? 0;

	getPitch = (): number => this.#canvas?.webgl.pitch ?? 0;

	setDirection(yaw: number, pitch?: number): void {
		if (!this.#canvas) return;
		this.#canvas.setDirection(yaw, pitch ?? this.#canvas.webgl.pitch, false);
		this.image.engine.render();
	}

	// ─── View limit control ────────────────────────────────────────

	/**
	 * Sets a rectangular limit for camera navigation within the image.
	 * @param v The viewport limit [x, y, width, height] in image-relative coordinates.
	 */
	setLimit(v: Models.Camera.View): void {
		if (!this.#canvas) return;
		const l = toCenterJSON(v)!;
		this.#canvas.view.setLimit(l.centerX, l.centerY, l.width, l.height);
		this.image.engine.render();
	}

	/**
	 * Sets whether the camera view should be limited to always cover the viewport.
	 * @param b If true, limits the view to cover the screen.
	 */
	setCoverLimit(b: boolean): void {
		if (!this.#canvas) return;
		this.#canvas.coverLimit = !!b;
		this.#canvas.correctMinMax();
	}

	getCoverLimit = (): boolean => !!(this.#canvas?.coverLimit);

	set360RangeLimit(xPerc = 0, yPerc = 0): void {
		if (!this.#canvas) return;
		this.#canvas.webgl.setLimits(xPerc, yPerc);
		this.image.engine.render();
	}

	// ─── Animation control ─────────────────────────────────────────

	stop(): void { this.#canvas?.aniStop(); }
	pause(): void { this.#canvas?.aniPause(performance.now()); }
	resume(): void { this.#canvas?.aniResume(performance.now()); this.image.engine.render(); }

	// ─── 360 / Omni / embed helpers ─────────────────────────────────

	/**
	 * Calculates a 4x4 transformation matrix for placing an object at specific coordinates
	 * with scale and rotation in 360 space. Used for CSS `matrix3d`.
	 * @param x The image X coordinate (0-1).
	 * @param y The image Y coordinate (0-1).
	 * @param scale The object scale multiplier.
	 * @param radius The object radius (distance from center, default 10).
	 * @param rotX The object X rotation in radians.
	 * @param rotY The object Y rotation in radians.
	 * @param rotZ The object Z rotation in radians.
	 * @param transY Optional Y translation in 3D space.
	 * @param scaleX Optional non-uniform X scaling.
	 * @param scaleY Optional non-uniform Y scaling.
	 * @returns The resulting 4x4 matrix as a Float32Array.
	 */
	getMatrix(x: number, y: number, scale?: number, radius?: number, rotX?: number, rotY?: number, rotZ?: number, transY?: number, scaleX?: number, scaleY?: number, noCorrectNorth?: boolean): Float32Array {
		return this.#canvas?.getMatrix(x, y, scale ?? 1, radius ?? 10, rotX || 0, rotY || 0, rotZ || 0, transY || 0, scaleX ?? 1, scaleY ?? 1, !!noCorrectNorth) ?? new Float32Array(16);
	}

	/**
	 * Sets the rendering area for this image within the main canvas.
	 * Used for split-screen and potentially other layout effects. Animates by default.
	 * @param v The target area rectangle [x0, y0, width, height] relative to the main canvas (0-1).
	 * @param opts Options for setting the area.
	 */
	setArea(v: Models.Camera.View, opts: { direct?: boolean; noDispatch?: boolean; noRender?: boolean } = {}): void {
		if (!this.#canvas) return;
		this.image.opts.area = v;
		if (this.image.opts.isEmbed && this.image.placed) {
			for (const img of this.#canvas.images) {
				if (img.localIdx > 0) { img.setArea(v[0], v[1], v[0] + v[2], v[1] + v[3]); return; }
			}
		} else {
			this.#canvas.setArea(v[0], v[1], v[0] + v[2], v[1] + v[3], !!opts.direct, !!opts.noDispatch);
		}
		if (!opts.noRender) this.image.engine.render();
	}

	/** Sets the 3D rotation for an embedded image (used for placing embeds in 360 space). */
	setRotation(rotX = 0, rotY = 0, rotZ = 0): void {
		if (!this.image.opts.isEmbed || !this.#canvas || !this.image.engine.ready) return;
		for (const img of this.#canvas.images) {
			if (img.localIdx > 0) { img.rotX = rotX; img.rotY = rotY; img.rotZ = rotZ; break; }
		}
		this.image.engine.render();
	}

	/** [Omni] Gets the current rotation angle in radians based on the active frame index. */
	getOmniRotation(): number {
		const omni = this.image.$settings.omni;
		if (!omni || !this.#canvas) return 0;
		return (this.image.swiper?.currentIndex ?? 0) / ((omni.frames ?? 1) / (omni.layers?.length ?? 1)) * Math.PI * 2;
	}

	/** [Omni] Gets the frame index corresponding to a given rotation angle (radians). */
	getOmniFrame(rot?: number): number | undefined {
		const omni = this.image.$settings.omni;
		if (!omni || rot == undefined) return;
		return Math.floor((rot / (Math.PI * 2)) * (omni.frames / (omni.layers?.length ?? 1)));
	}

	/** [Omni] Gets the screen coordinates [x, y, scale, depth] for given 3D object coordinates. */
	getOmniXY(x: number, y: number, z: number): Float64Array {
		return this.#canvas?.camera.getXYOmniCoo(x, y, z, 0, false).arr ?? new Float64Array(5);
	}

	// ─── Animation lifecycle (called by TileCanvas) ────────────────

	/**
	 * Called by the engine when the view changes (e.g., after panning, zooming, animation frame).
	 * Updates the `center` property and the image's `view` state store.
	 * @internal
	 */
	viewChanged() {
		if (!this.#canvas) return;
		const v = this.#canvas.view.arr;
		const prevCenterStr = this.center.join(',');
		const centerCoords = this.getCoo(0, 0);

		this.#view[0] = v[0] - v[2] / 2;
		this.#view[1] = v[1] - v[3] / 2;
		this.#view[2] = v[2];
		this.#view[3] = v[3];

		this.center[0] = v[0];
		this.center[1] = v[1];
		this.center[2] = centerCoords[2];

		if (this.image.is360) {
			this.center[3] = centerCoords[3];
			this.center[4] = centerCoords[4];
		}
		if (this.image.isOmni) this.center[5] = this.image.swiper?.currentIndex;

		if (this.center.join(',') != prevCenterStr || this.image.engine.micrio.canvas.resizing || this.#canvas?.areaAnimating()) {
			this.image.state.view.set(this.#view);
		}
	}

	// ─── Promise-based animations ──────────────────────────────────

	/** Sets the internal Promise resolve/reject functions for the current animation. @internal */
	#setAniPromises(ok: (...a: any[]) => any, abort: (...a: any[]) => any): void {
		this.aniDone = ok;
		this.aniAbort = abort;
	}

	/**
	 * Animates the camera smoothly to a target viewport.
	 * @param view The target viewport as a View [x0, y0, width, height].
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes, or rejects if aborted.
	 */
	flyToView(view: Models.Camera.View, opts: Models.Camera.AnimationOptions & {
		/** Set the starting animation progress percentage (0-1). */
		progress?: number;
		/** Base the progress override on this starting view. */
		prevView?: Models.Camera.View;
		/** If true, performs a "jump" animation (zooms out then in). */
		isJump?: boolean;
		/** For Omni objects: the target image frame index to animate to. */
		omniIndex?: number;
		/** If provided, interprets `view` relative to this sub-area. */
		area?: Models.Camera.View;
		/** If true, respects the image's maximum zoom limit during animation. */
		limitZoom?: boolean;
		/** If provided, adds a margin to the view. */
		margin?: [number, number];
	} = {}): Promise<void> {
		return new Promise((ok, abort) => {
			if (!this.#canvas) return abort(new Error("engine not ready"));
			let { centerX, centerY, width, height } = toCenterJSON(view);
			if (opts.margin?.length == 2) {
				centerX += opts.margin[0]; centerY += opts.margin[1];
				width -= opts.margin[0] * 2; height -= opts.margin[1] * 2;
			}
			if (opts.area) {
				const a = opts.area;
				centerX = a[0] + centerX * a[2]; centerY = a[1] + centerY * a[3];
				width *= a[2]; height *= a[3];
			}
			if (opts.prevView) {
				const pCV = toCenterJSON(opts.prevView);
				this.#canvas.ani.setStartView(pCV.centerX, pCV.centerY, pCV.width, pCV.height, false);
			}
			if (this.image.$settings.omni?.frames) {
				const numLayers = this.image.$settings.omni.layers?.length ?? 1;
				const npl = this.image.$settings.omni.frames / numLayers;
				if (opts.omniIndex == undefined) {
					const idx = view[4] || (Array.isArray(view) && view[5] !== undefined ? view[5] : undefined);
					if (idx !== undefined) opts.omniIndex = Math.round(mod(idx / (Math.PI * 2)) * npl);
				}
				if (opts.omniIndex != undefined) opts.omniIndex = mod(opts.omniIndex, npl);
			}
			const duration = this.#canvas.camera.flyTo(centerX, centerY, width, height, opts.duration ?? -1, opts.speed ?? -1, opts.progress ?? 0, !!opts.isJump, !!opts.limit, !!opts.limitZoom, opts.omniIndex ?? 0, Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'], performance.now());
			this.image.engine.render();
			if (duration == 0) ok();
			else this.#setAniPromises(ok, abort);
		});
	}

	/**
	 * Animates the camera to a view showing the entire image (minimum zoom).
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes.
	 */
	flyToFullView(opts: Models.Camera.AnimationOptions = {}): Promise<void> {
		return this.flyToCoo([.5, .5, this.getMinScale()], opts);
	}

	/**
	 * Animates the camera to a view where the image covers the viewport.
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes.
	 */
	flyToCoverView(opts: Models.Camera.AnimationOptions = {}): Promise<void> {
		const focus = (this.image.$settings.focus ?? [.5, .5]) as Models.Camera.Coords;
		focus[2] = this.getCoverScale();
		return this.flyToCoo(focus, opts);
	}

	/**
	 * Animates the camera to center on specific image coordinates and scale.
	 * @param coords The target coordinates [x, y, scale]. Scale is optional.
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes.
	 */
	flyToCoo(coords: Models.Camera.Coords, opts: Models.Camera.AnimationOptions = {}): Promise<void> {
		return new Promise((ok, abort) => {
			if (!this.#canvas) return abort(new Error("engine not ready"));
			const fn = Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'];
			opts.duration = this.#canvas.camera.setCoo(coords[0]!, coords[1]!, coords[2] ?? this.center[2] ?? 1, opts.duration ?? -1, opts.speed ?? -1, opts.limit ?? false, fn, performance.now());
			this.image.engine.render();
			if (opts.duration == 0) ok();
			else this.#setAniPromises(ok, abort);
		});
	}

	/**
	 * Performs an animated zoom centered on a specific screen point (or the current center).
	 * @param delta The amount to zoom (positive zooms out, negative zooms in).
	 * @param duration Forced duration in ms (0 for instant).
	 * @param x Screen pixel X-coordinate for zoom focus (optional, defaults to center).
	 * @param y Screen pixel Y-coordinate for zoom focus (optional, defaults to center).
	 * @param _speed Animation speed multiplier (optional).
	 * @param noLimit If true, allows zooming beyond image boundaries.
	 * @returns A Promise that resolves when the zoom animation completes.
	 */
	zoom(delta: number, duration = 0, x?: number, y?: number, _speed = 1, noLimit = false): Promise<void> {
		return new Promise((ok, abort) => {
			if (!this.#canvas) return abort(new Error("engine not ready"));
			const coo = this.getXY(this.center[0], this.center[1]);
			if (x == undefined) x = coo[0];
			if (y == undefined) y = coo[1];
			if (this.image.album && !this.image.album.hooked) return ok();
			duration = this.#canvas.camera.zoom(delta, x, y, duration, noLimit, performance.now());
			this.image.engine.render();
			if (duration == 0) ok();
			else this.#setAniPromises(ok, abort);
		});
	}

	/**
	 * Zooms in by a specified factor.
	 * @param factor Zoom factor (e.g., 1 = standard zoom step).
	 * @param duration Animation duration in ms.
	 * @param speed Animation speed multiplier.
	 * @returns A Promise that resolves when the animation completes.
	 */
	async zoomIn(factor = 1, duration = 250, speed = 1): Promise<void> {
		return this.zoom(-factor * 200, duration, undefined, undefined, speed).catch(() => {});
	}

	/**
	 * Zooms out by a specified factor.
	 * @param factor Zoom factor (e.g., 1 = standard zoom step).
	 * @param duration Animation duration in ms.
	 * @param speed Animation speed multiplier.
	 * @returns A Promise that resolves when the animation completes.
	 */
	async zoomOut(factor = 1, duration = 250, speed = 1): Promise<void> {
		const c = this.image.engine.micrio.canvas.viewport;
		const rat = c.width / c.height;
		const imgRat = this.image.$info!.width / this.image.$info!.height;
		return this.zoom(factor * (400 / Math.max(1, rat / imgRat / 2)), duration, undefined, undefined, speed).catch(() => {});
	}

	/**
	 * Pans the camera view by a relative pixel amount.
	 * @param x The horizontal pixel distance to pan.
	 * @param y The vertical pixel distance to pan.
	 * @param duration Animation duration in ms (0 for instant).
	 * @param opts Options: render (force render), noLimit (allow panning outside bounds).
	 */
	pan(x: number, y: number, duration = 0, opts: { render?: boolean; noLimit?: boolean } = {}): void {
		if (!this.#canvas) return;
		this.#canvas.camera.pan(x, y, duration, !!opts.noLimit, performance.now());
		if (duration > 0 || opts.render) this.image.engine.render();
	}

	/** Sets the camera zoom scale instantly. */
	setScale(s: number): void { this.setCoo(this.center[0], this.center[1], s); }

	aniIsKinetic(): boolean { return !!(this.#canvas?.kinetic.started); }
}
