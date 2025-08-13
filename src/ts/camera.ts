import type { MicrioImage } from './image';
import type { MicrioWasmExports } from '../types/wasm';
import type { Models } from '../types/models';

import { tick } from 'svelte';
import { mod } from './utils';
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
	readonly center: Models.Camera.Coords = [0,0,1];

	/** Dynamic Wasm buffer holding the current view rectangle [x0, y0, x1, y1].
	 * @internal
	*/
	private _view!: Float64Array;

	/** Dynamic Wasm buffer used for getXY calculations. [screenX, screenY, scale, depth].
	 * @internal
	 */
	private _xy!: Float64Array;

	/** Dynamic Wasm buffer used for getCoo calculations. [imageX, imageY, scale, depth, yaw?, pitch?].
	 * @internal
	 */
	private _coo!: Float64Array;

	/** Dynamic Wasm buffer holding the calculated 4x4 matrix for 360 embeds.
	 * @internal
	 */
	private _mat!: Float32Array;

	/** Offset from true north for 360 images, derived from space data.
	 * @internal
	 */
	trueNorth: number = .5;

	/** Direct access to the WebAssembly exports.
	 * @internal
	*/
	e!: MicrioWasmExports;

	/** Promise resolve function called when a camera animation completes successfully.
	 * @internal
	*/
	aniDone:Function|undefined;

	/** Promise reject function called when a camera animation is aborted (e.g., by user interaction).
	 * @internal
	*/
	aniAbort:Function|undefined;

	/** Array of additional callbacks to execute when an animation finishes. Used for queuing actions.
	 * @internal
	*/
	aniDoneAdd:Function[] = [];

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
		if(!image.is360) {
			const view = image.state.$view;
			// Use tick() to ensure Wasm might be ready before setting view
			if(view && image.$info?.width) tick().then(() => this.setView(view));
		}
	}

	/**
	 * Assigns the WebAssembly memory buffers to the camera instance. Called by Wasm controller.
	 * @internal
	*/
	assign(
		e:MicrioWasmExports,
		view: Float64Array,
		xy: Float64Array,
		coo: Float64Array,
		mat: Float32Array,
	) : void {
		this.e = e;
		this._view = view;
		this._xy = xy;
		this._coo = coo;
		this._mat = mat;
	}

	/**
	 * Called from WebAssembly when the view changes (e.g., after panning, zooming, animation frame).
	 * Updates the `center` property and the image's `view` state store.
	 * @internal
	 */
	viewChanged() {
		const v = this._view; // Current view from Wasm buffer
		const prevCenterStr = this.center.join(','); // Store previous center for comparison
		const centerCoords = this.getCoo(0,0); // Get image coordinates at screen center

		// Update center property [x, y, scale]
		this.center[0] = v[0] + (v[2]-v[0]) / 2;
		this.center[1] = v[1] + (v[3]-v[1]) / 2;
		this.center[2] = centerCoords[2]; // Scale

		// Update 360 orientation [yaw, pitch]
		if(this.image.is360) {
			this.center[3] = centerCoords[3]; // Yaw
			this.center[4] = centerCoords[4]; // Pitch
		}
		// Update Omni frame index
		if(this.image.isOmni) this.center[5] = this.image.swiper?.currentIndex;

		// Update the Svelte stores only if the view actually changed or if resizing/animating
		if(this.center.join(',') != prevCenterStr || this.image.wasm.micrio.canvas.resizing || this.image.wasm.e._areaAnimating(this.image.ptr)) {
			this.image.state.view.set(this._view);
			// Note: view360 will be automatically updated via the bidirectional sync in state.ts
		}
	}

	/** Converts relative coordinates within an area to absolute image coordinates.
	 * @internal
	 */
	private cooToArea = (x:number, y:number, a:Models.Camera.View) : {x:number, y:number} => ({
		x: a[0] + x * (a[2]-a[0]),
		y: a[1] + y * (a[3]-a[1])
	});

	/** Converts a relative view within an area to an absolute image view.
	 * @internal
	 */
	private viewToArea = (v:Models.Camera.View, a:Models.Camera.View) : Models.Camera.View => [
		...Object.values(this.cooToArea(v[0], v[1], a)), // Top-left
		...Object.values(this.cooToArea(v[2],v[3], a))  // Bottom-right
	];

	/** Type guard to check if a parameter is a View360 object.
	 * @internal
	 */
	private isView360 = (view: Models.Camera.View | Models.Camera.View360): view is Models.Camera.View360 => {
		return typeof view === 'object' && !Array.isArray(view) && 
			'centerX' in view && 'centerY' in view && 'width' in view && 'height' in view;
	};

	/** Converts a View360 (center + dimensions) to a standard View (rectangle).
	 * @internal
	 */
	view360ToView = (v360: Models.Camera.View360): Models.Camera.View => [
		v360.centerX - v360.width / 2,   // x0
		v360.centerY - v360.height / 2,  // y0
		v360.centerX + v360.width / 2,   // x1
		v360.centerY + v360.height / 2   // y1
	];

	/** Converts a standard View (rectangle) to a View360 (center + dimensions).
	 * @internal
	 */
	viewToView360 = (view: Models.Camera.View): Models.Camera.View360 => {
		const centerX = view[0] + (view[2] - view[0]) / 2;
		const centerY = view[1] + (view[3] - view[1]) / 2;
		return {
			centerX,
			centerY,
			width: view[2] - view[0],
			height: view[3] - view[1]
		};
	};



	/**
	 * Gets screen coordinates [x, y, scale, depth] for given image coordinates. Calls Wasm directly.
	 * @internal
	 * @param x Image X coordinate (0-1).
	 * @param y Image Y coordinate (0-1).
	 * @param opts Options: abs (absolute screen coords), radius/rotation (for 360 offsets), noTrueNorth.
	 * @returns Float64Array buffer containing the result.
	 */
	getXYDirect(x:number, y:number, opts: {
		abs?:boolean; // Use absolute screen coordinates?
		radius?:number; // Offset radius for 360
		rotation?:number; // Offset rotation for 360
		noTrueNorth?:boolean; // Ignore true north correction?
	} = {}) {
		// Adjust for true north offset in 360 images
		const tNDiff = (this.image.is360 && !opts.noTrueNorth) ? .5 - (this.image.$settings._360?.trueNorth??.5) : 0;
		this.e._getXY(this.image.ptr, x-tNDiff, y, opts.abs===true, opts.radius, opts.rotation);
		return this._xy; // Return direct buffer reference
	}

	/**
	 * Gets image coordinates [x, y, scale, depth, yaw?, pitch?] for given screen coordinates. Calls Wasm directly.
	 * @internal
	 * @param x Screen X coordinate.
	 * @param y Screen Y coordinate.
	 * @param abs Are screen coordinates absolute (window)?
	 * @param noLimit Allow coordinates outside image bounds?
	 * @returns Float64Array buffer containing the result.
	 */
	getCooDirect(x:number, y:number, abs:boolean=false, noLimit:boolean=false) {
		if(abs) { // Adjust absolute coordinates to be relative to the element
			const box = this.image.wasm.micrio.getBoundingClientRect();
			x-=box.left;
			y-=box.top;
		}
		this.e._getCoo(this.image.ptr, x, y, abs===true, noLimit===true);
		return this._coo; // Return direct buffer reference
	}

	/**
	 * Gets the current image view rectangle [x0, y0, x1, y1] relative to the image (0-1).
	 * @returns A copy of the current screen viewport array, or undefined if not initialized.
	 */
	public getView = () : Models.Camera.View|undefined => this._view?.slice(0);

	/**
	 * Sets the camera view instantly to the specified viewport.
	 * @param view The target viewport as either a View [x0, y0, x1, y1] or View360 {centerX, centerY, width, height}.
	 * @param opts Options for setting the view.
	 */
	public setView(view: Models.Camera.View | Models.Camera.View360, opts: {
		/** If true, allows setting a view outside the normal image boundaries. */
		noLimit?: boolean;
		/** If true (for 360), corrects the view based on the `trueNorth` setting. */
		correctNorth?: boolean;
		/** If true, prevents triggering a Wasm render after setting the view. */
		noRender?: boolean;
		/** If provided, interprets `view` relative to this sub-area instead of the full image. */
		area?: Models.Camera.View;
	} = {}): void {
		if (!this.e) return; // Exit if Wasm not ready

		let centerX, centerY, width, height;
		if (this.isView360(view)) {
			({ centerX, centerY, width, height } = view);
		} else {
			centerX = (view[0] + view[2]) / 2;
			centerY = (view[1] + view[3]) / 2;
			width = view[2] - view[0];
			height = view[3] - view[1];
		}
		if (opts.area) {
			const absCoords = this.cooToArea(centerX, centerY, opts.area);
			centerX = absCoords.x;
			centerY = absCoords.y;
			width *= (opts.area[2] - opts.area[0]);
			height *= (opts.area[3] - opts.area[1]);
		}
		this.e._setView(this.image.ptr, centerX, centerY, width, height, !!opts.noLimit, false, opts.correctNorth);
		
		if (!opts.noRender) this.image.wasm.render(); // Trigger render unless suppressed
	}

	/**
	 * Gets the current image view as a 360-degree area {centerX, centerY, width, height}.
	 * @returns A View360 object representing the current viewport, or undefined if not initialized.
	 */
	public getView360 = (): Models.Camera.View360|undefined => {
		if (!this.e) return undefined; // Exit if Wasm not ready
		
		// Use native WASM function for optimal performance
		this.e._getView360(this.image.ptr);
		
		return {
			centerX: this._view[0],
			centerY: this._view[1],
			width: this._view[2],
			height: this._view[3]
		};
	};



	/**
	 * Gets the relative image coordinates [x, y, scale, depth, yaw?, pitch?] corresponding to a screen coordinate.
	 * Rounds the result for cleaner output.
	 * @param x The screen X coordinate in pixels.
	 * @param y The screen Y coordinate in pixels.
	 * @param absolute If true, treats x/y as absolute browser window coordinates.
	 * @param noLimit If true, allows returning coordinates outside the image bounds (0-1).
	 * @returns A Float64Array containing the relative image coordinates [x, y, scale, depth, yaw?, pitch?].
	 */
	public getCoo = (
		x:number,
		y:number,
		absolute:boolean=false,
		noLimit:boolean=false
	) : Float64Array => this.getCooDirect(x, y, absolute, noLimit)
		.slice(0).map(d => Math.round(d*1000000)/1000000); // Get direct result, copy, and round

	/**
	 * Sets the center of the screen to the specified image coordinates and scale instantly.
	 * @param x The target image X coordinate (0-1).
	 * @param y The target image Y coordinate (0-1).
	 * @param scale The target scale (optional, defaults to current scale).
	 */
	public setCoo(x:number, y:number, scale:number=this.center[2]??1) : void {
		if (!this.e) return; // Exit if Wasm not ready
		this.e._setCoo(this.image.ptr, x, y, scale, 0, 0); // Call Wasm function
		this.image.wasm.render(); // Trigger render
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
	public getXY = (x:number,y:number,abs:boolean=false, radius?:number, rotation?:number, noTrueNorth?:boolean) : Float64Array =>
		this.getXYDirect(x, y, {abs, radius, rotation, noTrueNorth}).slice(0); // Get direct result and copy

	/** Gets the current camera zoom scale. */
	public getScale = () : number => {
		return this.center[2]??1; // Return scale from center property
	}

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
	getMatrix(x:number, y:number, scale?:number, radius?:number, rotX?:number, rotY?:number, rotZ?:number, transY?:number, scaleX?:number, scaleY?:number) : Float32Array {
		if (!this.e) return new Float32Array(16); // Return identity matrix if Wasm not ready
		this.e._getMatrix(this.image.ptr, x, y, scale, radius, rotX||0, rotY||0, rotZ||0, transY||0, scaleX??1, scaleY??1);
		return this._mat; // Return direct buffer reference
	}

	/**
	 * Sets the camera zoom scale instantly.
	 * @param s The target scale.
	*/
	public setScale = (s:number) : void => this.setCoo(this.center[0],this.center[1], s);

	/** Gets the scale at which the image fully covers the viewport. */
	public getCoverScale = () : number => this.e?._getCoverScale(this.image.ptr) ?? 1; // Add fallback

	/**
	 * Gets the minimum allowed zoom scale for the image.
	 * @returns The minimum scale.
	*/
	public getMinScale = () : number => this.e?._getMinScale(this.image.ptr) ?? 0.1; // Add fallback

	/**
	 * Sets the minimum allowed zoom scale.
	 * @param s The minimum scale to set.
	*/
	public setMinScale(s:number) : void { this.e?._setMinScale(this.image.ptr, s); }

	/**
	 * Sets the minimum screen size the image should occupy when zooming out (0-1).
	 * Allows zooming out further than the image boundaries, creating margins.
	 * Note: Does not work with albums.
	 * @param s The minimum screen size fraction (0-1).
	*/
	public setMinScreenSize(s:number) : void { if(!this.image.album) this.e?._setMinSize(this.image.ptr, Math.max(0, Math.min(1, s??1))); }

	/** Returns true if the camera is currently zoomed in to its maximum limit. */
	public isZoomedIn = () : boolean => this.e?._isZoomedIn(this.image.ptr) == 1;

	/**
	 * Returns true if the camera is currently zoomed out to its minimum limit.
	 * @param full If true, checks against the absolute minimum scale (ignoring `setMinScreenSize`).
	*/
	public isZoomedOut = (full:boolean = false) : boolean => this.e?._isZoomedOut(this.image.ptr, full) == 1;

	/**
	 * Sets a rectangular limit for camera navigation within the image.
	 * @param l The viewport limit rectangle [x0, y0, x1, y1].
	*/
	public setLimit(l:Models.Camera.View) : void {
		if (!this.e) return;
		const lCenterX = (l[0] + l[2]) / 2;
		const lCenterY = (l[1] + l[3]) / 2;
		const lWidth = l[2] - l[0];
		const lHeight = l[3] - l[1];
		this.e._setLimit(this.image.ptr, lCenterX, lCenterY, lWidth, lHeight);
		this.image.wasm.render();
	}

	/**
	 * Sets whether the camera view should be limited to always cover the viewport.
	 * @param b If true, limits the view to cover the screen.
	*/
	public setCoverLimit(b:boolean) : void {
		if (!this.e) return;
		this.e._setCoverLimit(this.image.ptr, !!b);
	}

	/** Gets whether the cover limit is currently enabled. */
	public getCoverLimit = () : boolean => !!this.e?._getCoverLimit(this.image.ptr);

	/**
	 * Limits the horizontal and vertical viewing range for 360 images.
	 * @param xPerc The horizontal arc limit as a percentage (0-1, where 1 = 360°). 0 disables horizontal limit.
	 * @param yPerc The vertical arc limit as a percentage (0-1, where 1 = 180°). 0 disables vertical limit.
	*/
	public set360RangeLimit(xPerc:number=0, yPerc:number=0) : void {
		if (!this.e) return;
		this.e._set360RangeLimit(this.image.ptr, xPerc, yPerc);
		this.image.wasm.render();
	}

	/** Sets the internal Promise resolve/reject functions for the current animation.
	 * @internal
	*/
	private setAniPromises(ok:(...a:any[])=>any, abort:(...a:any[])=>any) : void {
		this.aniDone = ok;
		this.aniAbort = abort;
	}

	/**
	 * Animates the camera smoothly to a target viewport.
	 * @param view The target viewport as either a View [x0, y0, x1, y1] or View360 {centerX, centerY, width, height}.
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes, or rejects if aborted.
	 */
	public flyToView = (
		view: Models.Camera.View | Models.Camera.View360,
		opts: Models.Camera.AnimationOptions & {
			/** Set the starting animation progress percentage (0-1). */
			progress?: number;
			/** Base the progress override on this starting view. */
			prevView?: Models.Camera.View;
			/** Base the progress override on this starting 360-degree area. */
			prevView360?: Models.Camera.View360;
			/** If true, performs a "jump" animation (zooms out then in). */
			isJump?: boolean;
			/** For Omni objects: the target image frame index to animate to. */
			omniIndex?: number;
			/** If true (for 360), ignores the `trueNorth` correction. */
			noTrueNorth?: boolean;
			/** If provided, interprets `view` relative to this sub-area. */
			area?: Models.Camera.View;
			/** If true, respects the image's maximum zoom limit during animation. */
			limitZoom?: boolean;
		} = {}
	): Promise<void> => new Promise((ok, abort) => {
		if (!this.e) return abort(new Error("Wasm not ready")); // Reject if Wasm not ready

		let centerX, centerY, width, height;
		if (this.isView360(view)) {
			({ centerX, centerY, width, height } = view);
		} else {
			centerX = (view[0] + view[2]) / 2;
			centerY = (view[1] + view[3]) / 2;
			width = view[2] - view[0];
			height = view[3] - view[1];
		}
		if (opts.area) {
			const absCoords = this.cooToArea(centerX, centerY, opts.area);
			centerX = absCoords.x;
			centerY = absCoords.y;
			width *= (opts.area[2] - opts.area[0]);
			height *= (opts.area[3] - opts.area[1]);
		}
		if (opts.prevView) {
			const pv = opts.prevView;
			const pvCenterX = (pv[0] + pv[2]) / 2;
			const pvCenterY = (pv[1] + pv[3]) / 2;
			const pvWidth = pv[2] - pv[0];
			const pvHeight = pv[3] - pv[1];
			this.e._setStartView(this.image.ptr, pvCenterX, pvCenterY, pvWidth, pvHeight);
		} else if (opts.prevView360) {
			const pv360 = opts.prevView360;
			this.e._setStartView(this.image.ptr, pv360.centerX, pv360.centerY, pv360.width, pv360.height);
		}
		if (this.image.$settings.omni?.frames) {
			const numLayers = this.image.$settings.omni.layers?.length ?? 1;
			const numPerLayer = (this.image.$settings.omni.frames / numLayers);
			if (opts.omniIndex == undefined && Array.isArray(view) && view[5] !== undefined) {
				opts.omniIndex = Math.round(mod(view[5] / (Math.PI * 2)) * numPerLayer);
			}
			if (opts.omniIndex != undefined) opts.omniIndex = mod(opts.omniIndex, numPerLayer);
		}
		const duration = this.e._flyTo(this.image.ptr, centerX, centerY, width, height, opts.duration ?? -1, opts.speed ?? -1, opts.progress ?? 0, !!opts.isJump, !!opts.limit, !!opts.limitZoom, opts.omniIndex ?? 0, !!opts.noTrueNorth, Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'], performance.now());
		this.image.wasm.render(); // Trigger render loop
		if (duration == 0) ok(); // Resolve immediately if duration is 0
		else this.setAniPromises(ok, abort); // Store promise callbacks
	});



	/**
	 * Animates the camera to a view showing the entire image (minimum zoom).
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes.
	 */
	public flyToFullView = (opts:Models.Camera.AnimationOptions = {}) : Promise<void> =>
		this.flyToCoo([.5, .5, this.getMinScale()], opts); // Fly to center at min scale

	/**
	 * Animates the camera to a view where the image covers the viewport.
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes.
	 */
	public flyToCoverView = (opts:Models.Camera.AnimationOptions = {}) : Promise<void> => {
		const focus = (this.image.$settings.focus ?? [.5,.5]) as Models.Camera.Coords; // Use focus point or center
		focus[2] = this.getCoverScale(); // Set target scale to cover scale
		return this.flyToCoo(focus, opts);
	}

	/**
	 * Animates the camera to center on specific image coordinates and scale.
	 * @param coords The target coordinates [x, y, scale]. Scale is optional.
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes.
	 */
	 public flyToCoo = (coords:Models.Camera.Coords, opts: Models.Camera.AnimationOptions = {}) : Promise<void> => new Promise((ok, abort) => {
		if (!this.e) return abort(new Error("Wasm not ready")); // Reject if Wasm not ready
		// Call Wasm function to start animation
		opts.duration = this.e._setCoo(this.image.ptr, coords[0], coords[1], coords[2]||this.center[2], opts.duration??-1, opts.speed??-1, opts.limit??false, Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'], performance.now());
		this.image.wasm.render(); // Trigger render loop
		if(opts.duration==0) ok(); // Resolve immediately if duration is 0
		else this.setAniPromises(ok, abort); // Store promise callbacks
	});

	/**
	 * Performs an animated zoom centered on a specific screen point (or the current center).
	 * @param delta The amount to zoom (positive zooms out, negative zooms in).
	 * @param duration Forced duration in ms (0 for instant).
	 * @param x Screen pixel X-coordinate for zoom focus (optional, defaults to center).
	 * @param y Screen pixel Y-coordinate for zoom focus (optional, defaults to center).
	 * @param speed Animation speed multiplier (optional).
	 * @param noLimit If true, allows zooming beyond image boundaries.
	 * @returns A Promise that resolves when the zoom animation completes.
	 */
	public zoom = (
		delta:number,
		duration:number=0,
		x:number|undefined=undefined,
		y:number|undefined=undefined,
		speed:number=1,
		noLimit:boolean=false
	) : Promise<void> => new Promise((ok, abort) => {
		if (!this.e) return abort(new Error("Wasm not ready")); // Reject if Wasm not ready
		// Get current center screen coordinates if x/y not provided
		const coo = this.getXY(this.center[0], this.center[1]);
		if(x == undefined) x = coo[0];
		if(y == undefined) y = coo[1];
		// Prevent zooming if part of an album and not hooked (likely inactive)
		if(this.image.album && !this.image.album.hooked) return ok(); // Resolve immediately if zoom prevented
		// Call Wasm function to start zoom animation
		duration = this.e._zoom(this.image.ptr, delta, x,y, duration, speed, noLimit, performance.now());
		this.image.wasm.render(); // Trigger render loop
		if(duration==0) ok(); // Resolve immediately if duration is 0
		else this.setAniPromises(ok, abort); // Store promise callbacks
	});

	/**
	 * Zooms in by a specified factor.
	 * @param factor Zoom factor (e.g., 1 = standard zoom step).
	 * @param duration Animation duration in ms.
	 * @param speed Animation speed multiplier.
	 * @returns A Promise that resolves when the animation completes.
	 */
	public zoomIn = (factor:number=1, duration:number=250, speed:number=1) : Promise<void> =>
		this.zoom(-factor*200,duration,undefined,undefined,speed).catch(() => {}); // Call zoom with negative delta

	/**
	 * Zooms out by a specified factor.
	 * @param factor Zoom factor (e.g., 1 = standard zoom step).
	 * @param duration Animation duration in ms.
	 * @param speed Animation speed multiplier.
	 * @returns A Promise that resolves when the animation completes.
	 */
	public zoomOut = (factor:number=1, duration:number=250, speed:number=1) : Promise<void> => {
		// Calculate appropriate delta based on aspect ratios to feel consistent
		const c = this.image.wasm.micrio.canvas.viewport, rat = (c.width / c.height),
			imgRat = (this.image.$info!.width / this.image.$info!.height);
		return this.zoom(factor*(400 / Math.max(1, rat / imgRat / 2)),duration,undefined,undefined,speed).catch(() => {}); // Call zoom with positive delta
	}

	/**
	 * Pans the camera view by a relative pixel amount.
	 * @param x The horizontal pixel distance to pan.
	 * @param y The vertical pixel distance to pan.
	 * @param duration Animation duration in ms (0 for instant).
	 * @param opts Options: render (force render), noLimit (allow panning outside bounds).
	*/
	public pan(x:number, y:number, duration:number=0, opts:{
		render?: boolean; // Force render even if duration is 0?
		noLimit?: boolean; // Allow panning outside image bounds?
	} = {}) : void {
		if (!this.e) return; // Exit if Wasm not ready
		this.e._pan(this.image.ptr, x, y, duration, !!opts.noLimit, performance.now());
		if(opts.render) this.image.wasm.render(); // Trigger render if animating or forced
	}

	/** Stops any currently running camera animation immediately. */
	public stop() : void {
		if (!this.e) return;
		this.e._aniStop(this.image.ptr);
	}

	/** Pauses the current camera animation. */
	public pause() : void {
		if (!this.e) return;
		this.e._aniPause(this.image.ptr, performance.now());
	}

	/** Resumes a paused camera animation. */
	public resume() : void {
		if (!this.e) return;
		this.e._aniResume(this.image.ptr, performance.now());
		this.image.wasm.render(); // Trigger render loop
	}

	/** Returns true if the camera is currently performing a kinetic pan/zoom (coasting). */
	public aniIsKinetic() : boolean {
		return !!this.e?._isKinetic(this.image.ptr);
	}

	/** Gets the current viewing direction (yaw) in 360 mode.
	 * @returns The current yaw in radians.
	 */
	getDirection = () : number => this.e?._getYaw(this.image.ptr) ?? 0; // Add fallback

	/**
	 * Sets the viewing direction (yaw and optionally pitch) instantly in 360 mode.
	 * @param yaw The target yaw in radians.
	 * @param pitch Optional target pitch in radians.
	*/
	setDirection(yaw:number, pitch?:number) : void {
		if (!this.e) return;
		const w = this.image.wasm;
		w.e._setDirection(this.image.ptr, yaw, pitch);
		w.render();
	}

	/**
	 * Gets the current viewing pitch in 360 mode.
	 * @returns The current pitch in radians.
	*/
	getPitch = () : number => this.e?._getPitch(this.image.ptr) ?? 0; // Add fallback

	/**
	 * Sets the rendering area for this image within the main canvas.
	 * Used for split-screen and potentially other layout effects. Animates by default.
	 * @param v The target area rectangle [x0, y0, x1, y1] relative to the main canvas (0-1).
	 * @param opts Options for setting the area.
	 */
	setArea(v:Models.Camera.View, opts:{
		/** If true, sets the area instantly without animation. */
		direct?:boolean;
		/** If true, prevents dispatching view updates during the animation. */
		noDispatch?:boolean;
		/** If true, prevents triggering a Wasm render after setting the area. */
		noRender?:boolean;
	} = {}) : void {
		if (!this.e) return; // Exit if Wasm not ready
		const e = this.image.wasm.e;
		const centerX = (v[0] + v[2]) / 2;
		const centerY = (v[1] + v[3]) / 2;
		const width = v[2] - v[0];
		const height = v[3] - v[1];
		if(this.image.opts.isEmbed) {
			if(this.image.ptr > 0) {
				this.image.opts.area = v;
				e._setImageArea(this.image.ptr, centerX, centerY, width, height);
			}
		}
		else {
			this.image.opts.area = v;
			e._setArea(this.image.ptr, centerX, centerY, width, height, !!opts.direct, !!opts.noDispatch);
		}
		if(!opts.noRender) this.image.wasm.render(); // Trigger render unless suppressed
	}

	/** Sets the 3D rotation for an embedded image (used for placing embeds in 360 space). */
	setRotation(rotX:number=0, rotY:number=0, rotZ: number=0) : void {
		if(!this.image.opts.isEmbed || this.image.ptr <= 0 || !this.e) return; // Only applicable to embeds with valid Wasm pointer
		this.image.wasm.e._setImageRotation(this.image.ptr, rotX, rotY, rotZ);
		this.image.wasm.render();
	}

	/** [Omni] Gets the current rotation angle in degrees based on the active frame index. */
	public getOmniRotation() : number {
		const omni = this.image.$settings.omni;
		if (!omni || !this.e) return 0; // Add check for Wasm readiness
		// Calculate rotation based on current index, total frames, and layers
		return (this.image.swiper?.currentIndex ?? 0) / ((omni?.frames ?? 1) / (omni?.layers?.length ?? 1)) * Math.PI * 2
	}

	/** [Omni] Gets the frame index corresponding to a given rotation angle (radians). */
	public getOmniFrame(rot?:number) : number|undefined {
		const omni = this.image.$settings.omni;
		if(!omni || rot == undefined) return; // Exit if not Omni or no rotation provided
		const numFrames = omni.frames / (omni.layers?.length ?? 1); // Frames per layer
		// Calculate frame index based on rotation percentage
		return Math.floor((rot / (Math.PI * 2)) * numFrames);
	}

	/** [Omni] Gets the screen coordinates [x, y, scale, depth] for given 3D object coordinates. */
	public getOmniXY(x:number, y:number, z:number) : Float64Array {
		if (!this.e) return new Float64Array(5); // Return empty array if Wasm not ready
		this.e._getOmniXY(this.image.ptr, x, y, z);
		return this._xy; // Return direct buffer reference
	}

	/** [Omni] Applies Omni-specific camera settings (distance, FoV, angle) to Wasm. */
	public setOmniSettings() : void {
		const i = this.image;
		const omni = i.$settings.omni;
		if(!omni || !this.e) return; // Exit if not Omni or Wasm not ready
		i.wasm.e._setOmniSettings(i.ptr, -omni.distance||0, omni.fieldOfView??0, omni.verticalAngle??0, omni.offsetX??0);
		this.image.state.view.set(this._view); // Update view store after settings change
	}

}
