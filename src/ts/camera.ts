import type { MicrioImage } from './image';
import type { Models } from '$types/models';
import type TileCanvas from '$engine/canvas/canvas';

import { tick } from 'svelte';
import { View, mod } from './utils';
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

	/** Shared buffer holding the current view rectangle [centerX, centerY, width, height].
	 * TODO-- fix this, but later.
	 * @internal
	*/
	private _view!: Float64Array;

	/** CORRECT view: [x0, y0, width, height] */
	private readonly view: Models.Camera.View = [0,0,1,1];

	/** Shared buffer used for getXY calculations. [screenX, screenY, scale, depth].
	 * @internal
	 */
	private _xy!: Float64Array;

	/** Shared buffer used for getCoo calculations. [imageX, imageY, scale, depth, yaw?, pitch?].
	 * @internal
	 */
	private _coo!: Float64Array;

	/** Shared buffer holding the calculated 4x4 matrix for 360 embeds.
	 * @internal
	 */
	private _mat!: Float32Array;

	/** Y-axis sphere rotation in radians for 360 images. @internal */
	rotationY: number = 0;

	/** Direct reference to the engine TileCanvas for compute operations. @internal */
	private _engineCanvas?: TileCanvas;

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
			if(view && image.$info?.width) tick().then(() => this.setView(view));
		}
	}

	/**
	 * Binds the engine TileCanvas instance for direct compute operations.
	 * @internal
	*/
	bindEngineCanvas(canvas: TileCanvas): void {
		this._engineCanvas = canvas;
	}

	/**
	 * Assigns the shared memory buffers to the camera instance. Called by Engine controller.
	 * @internal
	*/
	assign(
		view: Float64Array,
		xy: Float64Array,
		coo: Float64Array,
		mat: Float32Array,
	) : void {
		this._view = view;
		this._xy = xy;
		this._coo = coo;
		this._mat = mat;
	}

	/** Direct reference to the bound engine TileCanvas. Throws if not yet bound. @internal */
	private get _c(): TileCanvas { return this._engineCanvas!; }

	// -- Engine delegation helpers (eliminate the old ptr-based proxy) --

	private _getXY(x: number, y: number, abs: boolean, radius?: number, rotation?: number): void {
		const c = this._c;
		if (c.is360) { c.webgl.getXYZ(x, y); }
		else if (rotation !== undefined && !isNaN(rotation)) { c.camera.getXYOmni(x, y, radius ?? 0, rotation, !!abs); }
		else { c.camera.getXY(x, y, !!abs); }
	}
	private _getCoo(x: number, y: number, abs: boolean, noLimit: boolean): void {
		const c = this._c;
		if (c.is360) { c.webgl.getCoo(x, y); }
		else { c.camera.getCoo(x, y, !!abs, !!noLimit); }
	}

	private _setMinScale(s: number): void {
		const c = this._c;
		c.camera.minScale = s;
		c.camera.correctMinMax();
		c.camera.setView();
		c.webgl.update();
	}

	/**
	 * Called by the engine when the view changes (e.g., after panning, zooming, animation frame).
	 * Updates the `center` property and the image's `view` state store.
	 * @internal
	 */
	viewChanged() {
		const v = this._view; // Current view from engine buffer
		const prevCenterStr = this.center.join(','); // Store previous center for comparison
		const centerCoords = this.getCoo(0,0); // Get image coordinates at screen center

		// Convert to [x0,y0,width,height]
		// TODO FIX THIS
		this.view[0] = v[0] - v[2]/2;
		this.view[1] = v[1] - v[3]/2;
		this.view[2] = v[2];
		this.view[3] = v[3];

		// Update center property [x, y, scale]
		this.center[0] = v[0];
		this.center[1] = v[1];
		this.center[2] = centerCoords[2]; // Scale

		// Update 360 orientation [yaw, pitch]
		if(this.image.is360) {
			this.center[3] = centerCoords[3]; // Yaw
			this.center[4] = centerCoords[4]; // Pitch
		}
		// Update Omni frame index
		if(this.image.isOmni) this.center[5] = this.image.swiper?.currentIndex;

		// Update the Svelte stores only if the view actually changed or if resizing/animating
		if(this.center.join(',') != prevCenterStr || this.image.engine.micrio.canvas.resizing || this._engineCanvas?.areaAnimating()) {
			this.image.state.view.set(this.view);
			// Note: view360 will be automatically updated via the bidirectional sync in state.ts
		}
	}

	/** Converts relative coordinates within an area to absolute image coordinates.
	 * @internal
	 */
	private cooToArea = (x:number, y:number, a:Models.Camera.ViewRect) : {x:number, y:number} => ({
		x: a[0] + x * (a[2]-a[0]),
		y: a[1] + y * (a[3]-a[1])
	});

	/**
	 * Gets screen coordinates [x, y, scale, depth] for given image coordinates. Calls engine directly.
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
		noTrueNorth?:boolean; // Ignore rotationY correction?
	} = {}) {
		const tNDiff = (this.image.is360 && !opts.noTrueNorth) ? -this.rotationY / (Math.PI * 2) : 0;
		this._getXY( x-tNDiff, y, opts.abs===true, opts.radius, opts.rotation);
		return this._xy; // Return direct buffer reference
	}

	/**
	 * Gets image coordinates [x, y, scale, depth, yaw?, pitch?] for given screen coordinates. Calls engine directly.
	 * @internal
	 * @param x Screen X coordinate.
	 * @param y Screen Y coordinate.
	 * @param abs Are screen coordinates absolute (window)?
	 * @param noLimit Allow coordinates outside image bounds?
	 * @returns Float64Array buffer containing the result.
	 */
	getCooDirect(x:number, y:number, abs:boolean=false, noLimit:boolean=false) {
		if(abs) { // Adjust absolute coordinates to be relative to the element
			const box = this.image.engine.micrio.getBoundingClientRect();
			x-=box.left;
			y-=box.top;
		}
		this._getCoo( x, y, abs===true, noLimit===true);
		return this._coo; // Return direct buffer reference
	}

	/**
	 * Gets the current image view rectangle.
	 * @returns A copy of the current screen viewport array, or undefined if not initialized.
	 */
	public getView = () : Models.Camera.View => this.view;

	/**
	 * Gets the current image view rectangle [centerX, centerY, width, height] relative to the image (0-1).
	 * @returns A copy of the current screen viewport array, or undefined if not initialized.
	 */
	public getViewRaw = () : Float64Array => this._view;

	/**
	 * Gets the current image view rectangle [x0, y0, x1, y1] relative to the image (0-1).
	 * @returns A copy of the current screen viewport array, or undefined if not initialized.
	 */
	public getViewLegacy = () : Models.Camera.ViewRect|undefined => {
		if (!this._engineCanvas) return undefined;

		return [
			this._view[0] - this._view[2] / 2,  // x0
			this._view[1] - this._view[3] / 2,  // y0
			this._view[0] + this._view[2] / 2,  // x1
			this._view[1] + this._view[3] / 2   // y1
		];
	};

	/**
	 * Sets the camera view instantly to the specified viewport.
	 * @param view The target viewport as either a View [x0, y0, x1, y1] or View {centerX, centerY, width, height}.
	 * @param opts Options for setting the view.
	 */
	public setView(view: Models.Camera.View, opts: {
		/** If true, allows setting a view outside the normal image boundaries. */
		noLimit?: boolean;
		/** If true (for 360), corrects the view based on the `trueNorth` setting. */
		correctNorth?: boolean;
		/** If true, prevents triggering a render after setting the view. */
		noRender?: boolean;
		/** If provided, interprets `view` relative to this sub-area instead of the full image. */
		area?: Models.Camera.ViewRect;
	} = {}): void {
		if (!this._engineCanvas) return; // Exit if engine not ready

		let { centerX, centerY, width, height } = View.toCenterJSON(view);

		if (opts.area) {
			const absCoords = this.cooToArea(centerX, centerY, opts.area);
			centerX = absCoords.x;
			centerY = absCoords.y;
			width *= (opts.area[2] - opts.area[0]);
			height *= (opts.area[3] - opts.area[1]);
		}
		this._c.setView( centerX, centerY, width, height, !!opts.noLimit, false, opts.correctNorth);
		
		if (!opts.noRender) this.image.engine.render(); // Trigger render unless suppressed
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
		if (!this._engineCanvas) return;
		this._c.camera.setCoo( x, y, scale, 0, 0, false, 0, performance.now());
		this.image.engine.render();
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
	getMatrix(x:number, y:number, scale?:number, radius?:number, rotX?:number, rotY?:number, rotZ?:number, transY?:number, scaleX?:number, scaleY?:number, noCorrectNorth?:boolean) : Float32Array {
		if (!this._engineCanvas) return new Float32Array(16);
		this._c.getMatrix( x, y, scale ?? 1, radius ?? 10, rotX||0, rotY||0, rotZ||0, transY||0, scaleX??1, scaleY??1, !!noCorrectNorth);
		return this._mat;
	}

	/**
	 * Sets the camera zoom scale instantly.
	 * @param s The target scale.
	*/
	public setScale = (s:number) : void => this.setCoo(this.center[0],this.center[1], s);

	/** Gets the scale at which the image fully covers the viewport. */
	public getCoverScale = () : number => this._engineCanvas?.camera.coverScale ?? 1;

	public getMinScale = () : number => this._engineCanvas?.camera.minScale ?? 0.1;

	setMinScale(s:number) : void { if(this._engineCanvas) this._setMinScale(s); }

	setMinScreenSize(s:number) : void { if(!this.image.album && this._engineCanvas) this._c.camera.minSize = Math.max(0, Math.min(1, s??1)); }

	public isZoomedIn = () : boolean => !!(this._engineCanvas?.isZoomedIn());

	public isZoomedOut = (full:boolean = false) : boolean => !!(this._engineCanvas?.isZoomedOut(full));

	/**
	 * Sets a rectangular limit for camera navigation within the image.
	 * @param v The viewport limit rectangle [x0, y0, x1, y1].
	*/
	public setLimit(v:Models.Camera.ViewRect) : void {
		if (!this._engineCanvas) return;
		const l = View.rectToCenterJSON(v)!;
		this._c.view.setLimit(l.centerX, l.centerY, l.width, l.height);
		this.image.engine.render();
	}

	/**
	 * Sets whether the camera view should be limited to always cover the viewport.
	 * @param b If true, limits the view to cover the screen.
	*/
	public setCoverLimit(b:boolean) : void {
		if (!this._engineCanvas) return;
		this._c.coverLimit = !!b;
		this._c.camera.correctMinMax();
	}

	public getCoverLimit = () : boolean => !!(this._engineCanvas?.coverLimit);

	public stop() : void { this._engineCanvas?.aniStop(); }
	public pause() : void { this._engineCanvas?.aniPause(performance.now()); }
	public resume() : void {
		this._engineCanvas?.aniResume(performance.now());
		this.image.engine.render();
	}

	public set360RangeLimit(xPerc:number=0, yPerc:number=0) : void {
		if (!this._engineCanvas) return;
		this._c.webgl.setLimits(xPerc, yPerc);
		this.image.engine.render();
	}

	public aniIsKinetic() : boolean {
		return !!(this._engineCanvas?.kinetic.started);
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
	 * @param view The target viewport as either a View [x0, y0, x1, y1] or View {centerX, centerY, width, height}.
	 * @param opts Optional animation settings.
	 * @returns A Promise that resolves when the animation completes, or rejects if aborted.
	 */
	public flyToView = (
		view: Models.Camera.ViewRect | Models.Camera.View,
		opts: Models.Camera.AnimationOptions & {
			/** Set the starting animation progress percentage (0-1). */
			progress?: number;
			/** Base the progress override on this starting view. */
			prevView?: Models.Camera.View;
			/** If true, performs a "jump" animation (zooms out then in). */
			isJump?: boolean;
			/** For Omni objects: the target image frame index to animate to. */
			omniIndex?: number;
			/** If provided, interprets `view` relative to this sub-area. */
			area?: Models.Camera.ViewRect;
			/** If true, respects the image's maximum zoom limit during animation. */
			limitZoom?: boolean;
			/** If provided, adds a margin to the view. */
			margin?: [number, number];
		} = {}
	): Promise<void> => new Promise((ok, abort) => {
		if (!this._engineCanvas) return abort(new Error("engine not ready")); // Reject if Wasm not ready

		let { centerX, centerY, width, height } = View.toCenterJSON(view);

		if(opts.margin?.length == 2) {
			centerX += opts.margin[0];
			centerY += opts.margin[1];
			width -= opts.margin[0] * 2;
			height -= opts.margin[1] * 2;
		}
		if (opts.area) {
			const absCoords = this.cooToArea(centerX, centerY, opts.area);
			centerX = absCoords.x;
			centerY = absCoords.y;
			width *= (opts.area[2] - opts.area[0]);
			height *= (opts.area[3] - opts.area[1]);
		}
		if (opts.prevView) {
			const pCV = View.toCenterJSON(opts.prevView);
			this._c.ani.setStartView(pCV.centerX, pCV.centerY, pCV.width, pCV.height, false);
		}
		if (this.image.$settings.omni?.frames) {
			const numLayers = this.image.$settings.omni.layers?.length ?? 1;
			const numPerLayer = (this.image.$settings.omni.frames / numLayers);
			if (opts.omniIndex == undefined) {
				const idx = view[4] ? view[4] : Array.isArray(view) && view[5] !== undefined ? view[5] : undefined;
				if(idx !== undefined)opts.omniIndex = Math.round(mod(idx / (Math.PI * 2)) * numPerLayer);
			}
			if (opts.omniIndex != undefined) opts.omniIndex = mod(opts.omniIndex, numPerLayer);
		}
		const duration = this._c.camera.flyTo( centerX, centerY, width, height, opts.duration ?? -1, opts.speed ?? -1, opts.progress ?? 0, !!opts.isJump, !!opts.limit, !!opts.limitZoom, opts.omniIndex ?? 0, Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'], performance.now());
		this.image.engine.render(); // Trigger render loop
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
		if (!this._engineCanvas) return abort(new Error("engine not ready")); // Reject if Wasm not ready
		// Call engine to start animation
	 const fn = Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'];
	 opts.duration = this._c.camera.setCoo( coords[0]!, coords[1]!, (coords[2]||this.center[2])!, (opts.duration ?? -1)!, (opts.speed ?? -1)!, opts.limit ?? false, fn!, performance.now());
		this.image.engine.render(); // Trigger render loop
		if(opts.duration==0) ok(); // Resolve immediately if duration is 0
		else this.setAniPromises(ok, abort); // Store promise callbacks
	});

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
	public zoom = (
		delta:number,
		duration:number=0,
		x:number|undefined=undefined,
		y:number|undefined=undefined,
		_speed:number=1,
		noLimit:boolean=false
	) : Promise<void> => new Promise((ok, abort) => {
		if (!this._engineCanvas) return abort(new Error("engine not ready")); // Reject if Wasm not ready
		// Get current center screen coordinates if x/y not provided
		const coo = this.getXY(this.center[0], this.center[1]);
		if(x == undefined) x = coo[0];
		if(y == undefined) y = coo[1];
		// Prevent zooming if part of an album and not hooked (likely inactive)
		if(this.image.album && !this.image.album.hooked) return ok(); // Resolve immediately if zoom prevented
		// Call engine to start zoom animation
		duration = this._c.camera.zoom( delta, x,y, duration, noLimit, performance.now());
		this.image.engine.render(); // Trigger render loop
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
		const c = this.image.engine.micrio.canvas.viewport, rat = (c.width / c.height),
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
		if (!this._engineCanvas) return; // Exit if engine not ready
		this._c.camera.pan( x, y, duration, !!opts.noLimit, performance.now());
		if(duration > 0 || opts.render) this.image.engine.render();
	}

	/** Gets the current viewing direction (yaw) in 360 mode.
	 * @returns The current yaw in radians.
	 */
	getDirection = () : number => this._engineCanvas ? this._c.webgl.yaw : 0;

	getPitch = () : number => this._engineCanvas ? this._c.webgl.pitch : 0;

	setDirection(yaw:number, pitch?:number) : void {
		if (!this._engineCanvas) return;
		this._c.setDirection(yaw, pitch ?? this._c.webgl.pitch, false);
		this.image.engine.render();
	}

	/**
	 * Sets the rendering area for this image within the main canvas.
	 * Used for split-screen and potentially other layout effects. Animates by default.
	 * @param v The target area rectangle [x0, y0, x1, y1] relative to the main canvas (0-1).
	 * @param opts Options for setting the area.
	 */
	setArea(v:Models.Camera.ViewRect, opts:{
		/** If true, sets the area instantly without animation. */
		direct?:boolean;
		/** If true, prevents dispatching view updates during the animation. */
		noDispatch?:boolean;
		/** If true, prevents triggering a render after setting the area. */
		noRender?:boolean;
	} = {}) : void {
		if (!this._engineCanvas) return;
		if(this.image.opts.isEmbed) {
			if(this.image.ptr > 0) {
				this.image.opts.area = v;
				for (const img of this._c.images) {
					if (img.localIdx > 0) { img.setArea(v[0], v[1], v[2], v[3]); return; }
				}
			}
		}
		else {
			this.image.opts.area = v;
			this._c.setArea(v[0], v[1], v[2], v[3], !!opts.direct, !!opts.noDispatch);
		}
		if(!opts.noRender) this.image.engine.render();
	}

	/** Sets the 3D rotation for an embedded image (used for placing embeds in 360 space). */
	setRotation(rotX:number=0, rotY:number=0, rotZ: number=0) : void {
		if(!this.image.opts.isEmbed || !this._engineCanvas || !this.image.engine.ready) return;
		for (const img of this._c.images) {
			if (img.localIdx > 0) { img.rotX = rotX; img.rotY = rotY; img.rotZ = rotZ; break; }
		}
		this.image.engine.render();
	}

	/** [Omni] Gets the current rotation angle in degrees based on the active frame index. */
	public getOmniRotation() : number {
		const omni = this.image.$settings.omni;
		if (!omni || !this._engineCanvas) return 0; // Add check for engine readiness
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
		if (!this._engineCanvas) return new Float64Array(5);
		this._c.camera.getXYOmniCoo( x, y, z, 0, false);
		return this._xy;
	}

	/** [Omni] Applies Omni-specific camera settings (distance, FoV, angle) to the engine canvas. */
	public setOmniSettings() : void {
		const omni = this.image.$settings.omni;
		if(!omni || !this._engineCanvas) return;
		const c = this._c;
		c.omniDistance = -omni.distance || 0;
		c.omniFieldOfView = omni.fieldOfView ?? 0;
		c.omniVerticalAngle = omni.verticalAngle ?? 0;
		c.omniOffsetX = omni.offsetX ?? 0;
		this.image.state.view.set(this.view);
	}

}
