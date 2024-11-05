import type { MicrioImage } from './image';
import type { MicrioWasmExports } from '../types/wasm';
import type { Models } from '../types/models';

import { tick } from 'svelte';
import { mod } from './utils';
import { Enums } from './enums';

/**
 * The virtual Micrio camera
 * @author Marcel Duin <marcel@micr.io>
 * @copyright Q42 Internet BV, Micrio, 2015 - 2024
 * @link https://micr.io/ , https://q42.nl/en/
*/
export class Camera {
	/** Current center screen coordinates and scale */
	readonly center: Models.Camera.Coords = [0,0,1];

	/** Dynamic wasm buffers
	 * @internal
	*/
	private _view!: Float64Array;

	/** @internal */
	private _xy!: Float64Array;

	/** @internal */
	private _coo!: Float64Array;

	/** @internal */
	private _quad!: Float32Array;

	/** @internal */
	private _mat!: Float32Array;

	/** For deviating center in 360 images
	 * @internal
	 */
	trueNorth: number = .5;

	/** The Wasm direct exports
	 * @internal
	*/
	e!: MicrioWasmExports;

	/** Promise callback when animation is done
	 * @internal
	*/
	aniDone:Function|undefined;

	/** Promise callback when animation is aborted
	 * @internal
	*/
	aniAbort:Function|undefined;

	/** Additional functions to hook aniDone
	 * @internal
	*/
	aniDoneAdd:Function[] = [];

	/** Create the Camera instance
	 * @internal
	 * @param image The Micrio image
	 */
	constructor(
		/** @internal */
		public image: MicrioImage,
	) {
		if(!image.is360) {
			// Only if already loaded and not 360, set view immediately
			const view = image.state.$view;
			if(view && image.$info?.width) tick().then(() => this.setView(view));
		}
	}

	/** Assign the wasm FloatArrays
	 * @internal
	*/
	assign(
		e:MicrioWasmExports,
		view: Float64Array,
		xy: Float64Array,
		coo: Float64Array,
		mat: Float32Array,
		quad: Float32Array
	) : void {
		this.e = e;
		this._view = view;
		this._xy = xy;
		this._coo = coo;
		this._mat = mat;
		this._quad = quad;
	}

	/** Called from within Wasm
	 * @internal
	 */
	viewChanged() {
		const v = this._view;
		const pc = this.center.join(',');
		const c = this.getCoo(0,0);
		this.center[0] = v[0] + (v[2]-v[0]) / 2;
		this.center[1] = v[1] + (v[3]-v[1]) / 2;
		this.center[2] = c[2];
		if(this.image.is360) {
			this.center[3] = c[3];
			this.center[4] = c[4];
		}
		if(this.image.isOmni) this.center[5] = this.image.swiper?.currentIndex;
		if(this.center.join(',') != pc || this.image.wasm.micrio.canvas.resizing || this.image.wasm.e._areaAnimating(this.image.ptr))
			this.image.state.view.set(this._view);
	}

	/** @internal */
	private cooToArea = (x:number, y:number, a:Models.Camera.View) : {x:number, y:number} => ({
		x: a[0] + x * (a[2]-a[0]),
		y: a[1] + y * (a[3]-a[1])
	});

	/** @internal */
	private viewToArea = (v:Models.Camera.View, a:Models.Camera.View) : Models.Camera.View => [
		...Object.values(this.cooToArea(v[0], v[1], a)),
		...Object.values(this.cooToArea(v[2],v[3], a))
	];

	/** @internal */
	getXYDirect(x:number, y:number, opts: {
		abs?:boolean;
		radius?:number;
		rotation?:number;
		noTrueNorth?:boolean;
		area?:Models.Camera.View;
	} = {}) {
		const a = opts.area;
		if(a) { const n = this.cooToArea(x, y, a); x = n.x, y = n.y; }
		const tNDiff = opts.noTrueNorth ? 0 : .5 - (this.image.$settings._360?.trueNorth??.5);
		this.e._getXY(this.image.ptr, x-tNDiff, y, opts.abs===true, opts.radius, opts.rotation);
		return this._xy;
	}

	/** @internal */
	getCooDirect(x:number, y:number, abs:boolean=false, noLimit:boolean=false) {
		if(abs) {
			const box = this.image.wasm.micrio.getBoundingClientRect();
			x-=box.left;
			y-=box.top;
		}
		this.e._getCoo(this.image.ptr, x, y, abs===true, noLimit===true);
		return this._coo;
	}

	/** Get the current image view rectangle
	 * @returns The current screen viewport
	 */
	public getView = () : Models.Camera.View|undefined => this._view?.slice(0);

	/** Set the screen viewport
	 * @param v The viewport
	 * @param opts Options
	 */
	public setView(v:Models.Camera.View, opts:{
		/** Don't restrict the boundaries */
		noLimit?:boolean;
		/** [360] Correct the view to trueNorth */
		correctNorth?: boolean;
		/** Don't render */
		noRender?: boolean;
		/** Custom sub-area */
		area?:Models.Camera.View;
	} = {}) : void {
		if(opts.area) v = this.viewToArea(v, opts.area);
		this.e._setView(this.image.ptr, v[0], v[1], v[2], v[3], !!opts.noLimit, false, opts.correctNorth);
		if(!opts.noRender) this.image.wasm.render();
	}

	/** Gets the static image XY coordinates of a screen coordinate
	 * @param x The screen X coordinate in pixels
	 * @param y The screen Y coordinate in pixels
	 * @param absolute Use absolute browser window coordinates
	 * @param noLimit Allow to go out of image bounds
	 * @returns The relative image XY coordinates
	 */
	public getCoo = (
		x:number,
		y:number,
		absolute:boolean=false,
		noLimit:boolean=false
	) : Float64Array => this.getCooDirect(x, y, absolute, noLimit)
		.slice(0).map(d => Math.round(d*1000000)/1000000);

	/** Sets current coordinates as the center of the screen
	 * @param x The X Coordinate
	 * @param y The Y Coordinate
	 * @param scale The scale to set
	 */
	public setCoo(x:number, y:number, scale:number=this.center[2]??1) : void {
		this.e._setCoo(this.image.ptr, x, y, scale, 0, 0);
		this.image.wasm.render();
	}

	/** Gets the static screen XY coordinates of an image coordinate
	 * @param x The image X coordinate
	 * @param y The image Y coordinate
	 * @param abs Use absolute browser window coordinates
	 * @returns The screen XY coordinates in pixels
	 */
	public getXY = (x:number,y:number,abs:boolean=false, radius?:number, rotation?:number, noTrueNorth?:boolean) : Float64Array =>
		this.getXYDirect(x, y, {abs, radius, rotation, noTrueNorth}).slice(0);

	/** Get the current image scale */
	public getScale = () : number => {
		return this.center[2]??1;
	}

	public getQuad(cX:number, cY:number, w:number, h:number,rotX:number=0,rotY:number=0,rotZ:number=0,scaleX:number=1,scaleY:number=1) : Float32Array {
		this.e._getQuad(this.image.ptr, cX, cY, w, h, scaleX, scaleY, rotX, rotY, rotZ);
		return this._quad;
	}

	/** Get a custom matrix for 360 placed embeds
	 * @param x The X coordinate
	 * @param y The Y coordinate
	 * @param scale  The object scale
	 * @param radius The object radius (default 10)
	 * @param rotX The object X rotation in radians
	 * @param rotY The object Y rotation in radians
	 * @param rotZ The object Z rotation in radians
	 * @param transY Optional Y translation in 3d space
	 * @returns The resulting 4x4 matrix
	 */
	getMatrix(x:number, y:number, scale?:number, radius?:number, rotX?:number, rotY?:number, rotZ?:number, transY?:number, scaleX?:number, scaleY?:number) : Float32Array {
		this.e._getMatrix(this.image.ptr, x, y, scale, radius, rotX||0, rotY||0, rotZ||0, transY||0, scaleX??1, scaleY??1);
		return this._mat;
	}

	/** Set the current image scale
	 * @param s The scale
	*/
	public setScale = (s:number) : void => this.setCoo(this.center[0],this.center[1], s);

	/** Get the scale when the image would cover the screen*/
	public getCoverScale = () : number => this.e._getCoverScale(this.image.ptr);

	/** Get the minimum scale
	 * @returns The minimum scale
	*/
	public getMinScale = () : number => this.e._getMinScale(this.image.ptr);

	/** Sets the minimum scale
	 * @param s The minimum scale to set
	*/
	public setMinScale(s:number) : void { this.e?._setMinScale(this.image.ptr, s); }

	/** Sets the minimum screen size you can zoom out to -- this makes you able to zoom out with margins
	 * Note: This does not work with albums!
	 * @param s The minimum screen size [0-1]
	*/
	public setMinScreenSize(s:number) : void { if(!this.image.album) this.e?._setMinSize(this.image.ptr, Math.max(0, Math.min(1, s??1))); }

	/** Returns true when the camera is zoomed in to the max */
	public isZoomedIn = () : boolean => this.e?._isZoomedIn(this.image.ptr) == 1;

	/** Returns true when the camera is fully zoomed out
	 * @param full When using a custom .minSize, use this in the calculation
	*/
	public isZoomedOut = (full:boolean = false) : boolean => this.e?._isZoomedOut(this.image.ptr, full) == 1;

	/** Limit camera navigation boundaries
	 * @param l The viewport limit
	*/
	public setLimit(l:Models.Camera.View) : void {
		this.e._setLimit(this.image.ptr, l[0], l[1], l[2], l[3]);
		this.image.wasm.render();
	}

	/** Set the coverLimit of the image to always fill the screen
	 * @param b Limit the image to cover view
	*/
	public setCoverLimit(b:boolean) : void {
		this.e._setCoverLimit(this.image.ptr, !!b);
	}

	/** Get whether the image always fills the screen or not */
	public getCoverLimit = () : boolean => !!this.e._getCoverLimit(this.image.ptr);

	/** Limit camera navigation boundaries
	 * @param xPerc The horizontal arc to limit to, percentage (1 = 360°)
	 * @param yPerc The vertical arc to limit to, percentage (1 = 180°)
	*/
	public set360RangeLimit(xPerc:number=0, yPerc:number=0) : void {
		this.e._set360RangeLimit(this.image.ptr, xPerc, yPerc);
		this.image.wasm.render();
	}

	/** Set internal animation promises per canvas
	 * @internal
	*/
	private setAniPromises(ok:(...a:any[])=>any, abort:(...a:any[])=>any) : void {
		this.aniDone = ok;
		this.aniAbort = abort;
	}

	/** Fly to a specific view
	 * @returns Promise when the animation is done
	 * @param view The viewport to fly to
	 * @param opts Optional animation settings
	 */
	 public flyToView = (
		view:Models.Camera.View,
		opts:Models.Camera.AnimationOptions & {
			/** Set the starting animation progress percentage */
			progress?:number;
			/** Base the progress override on this starting view */
			prevView?:Models.Camera.View;
			/** Zoom out and in during the animation */
			isJump?:boolean;
			/** For omni objects: image index to animate to */
			omniIndex?: number;
			/** Don't do trueNorth correction */
			noTrueNorth?: boolean;
			/** Custom sub-area */
			area?:Models.Camera.View;
			/** Respect the image's maximum zoom limit */
			limitZoom?: boolean;
		} = {}
	) : Promise<void> => new Promise((ok, abort) => {
		if(opts.area) view = this.viewToArea(view, opts.area);
		if(opts.prevView) {
			const pv = opts.prevView;
			this.e._setStartView(this.image.ptr, pv[0], pv[1], pv[2], pv[3]);
		}
		if(this.image.$settings.omni?.frames) {
			const numLayers = this.image.$settings.omni.layers?.length ?? 1;
			const numPerLayer = (this.image.$settings.omni.frames / numLayers);
			if(opts.omniIndex == undefined && view[5] !== undefined) opts.omniIndex = Math.round(mod(view[5] / (Math.PI * 2)) * numPerLayer);
			if(opts.omniIndex) opts.omniIndex = mod(opts.omniIndex, numPerLayer);
		}
		const duration = this.e._flyTo(this.image.ptr, view[0], view[1], view[2], view[3], opts.duration ?? -1, opts.speed ?? -1, opts.progress ?? 0, !!opts.isJump, !!opts.limit, !!opts.limitZoom, opts.omniIndex ?? 0, !!opts.noTrueNorth, Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'], performance.now());
		this.image.wasm.render();
		if(duration==0) ok();
		else this.setAniPromises(ok, abort);
	});

	/** Fly to a full view of the image
	 * @param opts Animation options
	 * @returns Promise when the animation is done
	 */
	public flyToFullView = (opts:Models.Camera.AnimationOptions = {}) : Promise<void> =>
		this.flyToCoo([.5, .5, this.getMinScale()], opts);

	/** Fly to a screen-covering view of the image
	 * @param opts Animation options
	 * @returns Promise when the animation is done
	 */
	public flyToCoverView = (opts:Models.Camera.AnimationOptions = {}) : Promise<void> => {
		const focus = (this.image.$settings.focus ?? [.5,.5]) as Models.Camera.Coords;
		focus[2] = this.getCoverScale();
		return this.flyToCoo(focus, opts);
	}

	/** Fly to the specific coordinates
	 * @param coords The X, Y and scale coordinates to fly to
	 * @param opts Animation options
	 * @returns Promise when the animation is done
	 */
	 public flyToCoo = (coords:Models.Camera.Coords, opts: Models.Camera.AnimationOptions = {}) : Promise<void> => new Promise((ok, abort) => {
		opts.duration = this.e._setCoo(this.image.ptr, coords[0], coords[1], coords[2]||this.center[2], opts.duration??-1, opts.speed??-1, opts.limit??false, Enums.Camera.TimingFunction[opts.timingFunction ?? 'ease'], performance.now());
		this.image.wasm.render();
		if(opts.duration==0) ok();
		else this.setAniPromises(ok, abort);
	});

	/** Do a zooming animation
	 * @param delta The amount to zoom
	 * @param duration A forced duration in ms of the animation
	 * @param x Screen pixel X-coordinate as zoom focus
	 * @param y Screen pixel Y-coordinate as zoom focus
	 * @param speed A non-default camera speed
	 * @param noLimit Can zoom outside of the image boundaries
	 * @returns Promise when the zoom animation is done
	 */
	public zoom = (
		delta:number,
		duration:number=0,
		x:number|undefined=undefined,
		y:number|undefined=undefined,
		speed:number=1,
		noLimit:boolean=false
	) : Promise<void> => new Promise((ok, abort) => {
		const coo = this.getXY(this.center[0], this.center[1]);
		if(x == undefined) x = coo[0];
		if(y == undefined) y = coo[1];
		if(this.image.album && !this.image.album.hooked) return;
		duration = this.e._zoom(this.image.ptr, delta, x,y, duration, speed, noLimit, performance.now());
		this.image.wasm.render();
		if(duration==0) ok();
		else this.setAniPromises(ok, abort);
	});

	/** Zoom out a factor
	 * @param factor The amount to zoom in
	 * @param duration A forced duration in ms of the animation
	 * @param speed A non-default camera speed
	 * @returns Promise when the zoom animation is done
	 */
	public zoomIn = (factor:number=1, duration:number=250, speed:number=1) : Promise<void> =>
		this.zoom(-factor*200,duration,undefined,undefined,speed).catch(() => {});

	/** Zoom out a factor
	 * @param factor The amount to zoom out
	 * @param duration A forced duration in ms of the animation
	 * @param speed A non-default camera speed
	 * @returns Promise when the zoom animation is done
	 */
	public zoomOut = (factor:number=1, duration:number=250, speed:number=1) : Promise<void> => {
		const c = this.image.wasm.micrio.canvas.viewport, rat = (c.width / c.height),
			imgRat = (this.image.$info!.width / this.image.$info!.height);
		return this.zoom(factor*(400 / Math.max(1, rat / imgRat / 2)),duration,undefined,undefined,speed).catch(() => {});
	}

	/** Pan relative pixels
	 * @param x The horizontal number of pixels to pan
	 * @param y The vertical number of pixels to pan
	 * @param duration An optional duration
	*/
	public pan(x:number, y:number, duration:number=0, opts:{
		render?: boolean;
		noLimit?: boolean;
	} = {}) : void {
		this.e._pan(this.image.ptr, x, y, duration, !!opts.noLimit, performance.now());
		if(opts.render) this.image.wasm.render();
	}

	/** Stop any animation */
	public stop() : void {
		this.e._aniStop(this.image.ptr);
	}

	/** Pause any animation */
	public pause() : void {
		this.e._aniPause(this.image.ptr, performance.now());
	}

	/** Pause any animation */
	public resume() : void {
		this.e._aniResume(this.image.ptr, performance.now());
		this.image.wasm.render();
	}

	/** Returns whether the current camera movement is kinetic / rubber banding */
	public aniIsKinetic() : boolean {
		return !!this.e._isKinetic(this.image.ptr);
	}

	/** Get the current direction facing in 360 mode in radians */
	getDirection = () : number => this.image.wasm.e._getYaw(this.image.ptr);

	/** Sets the 360 viewing direction in radians
	 * @param yaw The direction in radians
	 * @param pitch Optional pitch in radians
	*/
	setDirection(yaw:number, pitch?:number) : void {
		const w = this.image.wasm;
		w.e._setDirection(this.image.ptr, yaw, pitch);
		w.render();
	}

	/** Get the current direction pitch
	 * @returns The current pitch in radians
	*/
	getPitch = () : number => this.e._getPitch(this.image.ptr);

	/** Set the relative {@link Models.Camera.View} to render to, animates by default */
	setArea(v:Models.Camera.View, opts:{
		/** Directly set the area without animation */
		direct?:boolean;
		/** Don't emit the updates back to JS */
		noDispatch?:boolean;
		/** Don't trigger a frame draw */
		noRender?:boolean;
	} = {}) : void {
		const e = this.image.wasm.e;
		if(this.image.opts.isEmbed) { if(this.image.ptr > 0) {
			this.image.opts.area = v;
			e._setImageArea(this.image.ptr, v[0], v[1], v[2], v[3]);
		} }
		else {
			this.image.opts.area = v;
			e._setArea(this.image.ptr, v[0], v[1], v[2], v[3], !!opts.direct, !!opts.noDispatch);
		}
		if(!opts.noRender) this.image.wasm.render();
	}

	/** For in-image 360 embeds */
	setRotation(rotX:number=0, rotY:number=0, rotZ: number=0) : void {
		if(!this.image.opts.isEmbed || this.image.ptr <= 0) return;
		this.image.wasm.e._setImageRotation(this.image.ptr, rotX, rotY, rotZ);
		this.image.wasm.render();
	}

	/** [Omni] Get the current rotation in degrees */
	public getOmniRotation() : number {
		const omni = this.image.$settings.omni;
		return (this.image.swiper?.currentIndex ?? 0) / ((omni?.frames ?? 1) / (omni?.layers?.length ?? 1)) * Math.PI * 2
	}

	/** [Omni] Get the corresponding frame number to current rotation */
	public getOmniFrame(rot?:number) : number|undefined {
		const omni = this.image.$settings.omni;
		if(!omni || rot == undefined) return;
		const numFrames = omni.frames / (omni.layers?.length ?? 1);
		return Math.floor((rot / (Math.PI * 2)) * numFrames);
	}

	public getOmniXY(x:number, y:number, z:number) : Float64Array {
		this.e._getOmniXY(this.image.ptr, x, y, z);
		return this._xy;
	}

	public setOmniSettings() : void {
		const i = this.image;
		const omni = i.$settings.omni;
		if(!omni) return;
		i.wasm.e._setOmniSettings(i.ptr, -omni.distance||0, omni.fieldOfView??0, omni.verticalAngle??0, omni.offsetX??0);
		this.image.state.view.set(this._view);
	}

}
