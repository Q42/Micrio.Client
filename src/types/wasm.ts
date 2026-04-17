/** @internal */
export interface MicrioWasmExports extends WebAssembly.Exports {
	segsX: { value: number };
	segsY: { value: number };

	/** Get eased value (easeInOut) for progress `0-1`. */
	ease(p:number): number;

	// --- Main instance functions ---

	/** Create the main Wasm controller. Returns a memory pointer. */
	constructor() : number;
	/** Get the vertex buffer pointer for 2D tile geometry. */
	getVertexBuffer(ptr:number) : number;
	/** Get the vertex buffer pointer for 360 tile geometry. */
	getVertexBuffer360(ptr:number) : number;
	/** Check whether a next frame should be drawn. */
	shouldDraw(ptr:number, now:number) : number;
	/** Execute the draw loop for all canvases. */
	draw(ptr:number) : void;
	/** Reset all animations, drawing states and textures. */
	reset(ptr:number) : void;
	/** Stop all running animations. */
	aniStop(ptr:number) : void;
	/** Update element dimensions after a resize. */
	resize(ptr:number, w: number, h: number, l: number, t: number, r: number, s: number, p: boolean) : void;
	/** Set virtual offset margins for viewport calculations. */
	setArea(ptr:number, _w: number, _h: number) : void;
	/** Toggle barebone mode (minimal tile loading). */
	setBareBone(ptr:number, v: boolean) : void;
	/** Set 360 orientation vector for space transitions. */
	set360Orientation(ptr:number, direction: number, dstX: number, dstY: number) : void;
	/** Set grid transition duration in seconds. */
	setGridTransitionDuration(ptr:number, n: number) : void;
	/** Set grid transition timing function (0=ease, 1=ease-in, 2=ease-out, 3=linear). */
	setGridTransitionTimingFunction(ptr:number, n:number) : void;
	/** Set crossfade duration between images in seconds. */
	setCrossfadeDuration(ptr:number, n: number) : void;
	/** Set embed fade transition duration in seconds. */
	setEmbedFadeDuration(ptr:number, n: number) : void;
	/** Set drag inertia elasticity (higher = smoother, default 1). */
	setDragElasticity(ptr:number, n: number) : void;
	/** Toggle pinch-pan separation. */
	setNoPinchPan(ptr:number, v: boolean) : void;
	/** Set number of base tile layers to skip loading. */
	setSkipBaseLevels(ptr:number, n: number) : void;
	/** Toggle swipe gallery mode. */
	setIsSwipe(ptr:number, v: boolean) : void;
	/** Configure binary archive mode with layer offset. */
	setHasArchive(ptr:number, v: boolean, n:number) : void;
	/** Toggle underzoom for pre-deepzoom images. */
	setNoUnderzoom(ptr:number, v:boolean) : void;
	/** Get total tile count across all canvas images. */
	getNumTiles(ptr:number) : number;

	// --- Canvas instance functions (prefixed with _) ---

	/** Create a canvas instance for a MicrioImage. Returns a memory pointer. */
	_constructor(mainPtr:number, width: number, height: number, tileSize: number, is360: boolean,
		noImage: boolean, isSingle: boolean, targetOpacity: number,
		freeMove: boolean, coverLimit: boolean, coverStart: boolean, maxScale: number, scaleMultiplier: number, camSpeed: number,
		rotationY: number, isGallerySwitch: boolean, pagesHaveBackground: boolean,
		isOmni: boolean, pinchZoomOutLimit: boolean, omniNumLayers: number, omniLayerStartIndex:number) : number;
	/** Get current view coordinates [centerX, centerY, width, height]. */
	_getView(ptr:number) : number;
	/** Get image coordinates from screen pixel position. */
	_getCoo(ptr:number, x: number, y: number, abs?: boolean, noLimit?: boolean) : number;
	/** Get screen pixel coordinates from image coordinates. */
	_getXY(ptr:number, x: number, y: number, abs?: boolean, radius?:number, rotation?:number) : number;
	/** Get a 4x4 CSS transform matrix for 360 object placement. */
	_getMatrix(ptr:number, x?:number, y?:number, s?:number, r?:number, rX?:number, rY?:number, rZ?:number, t?:number, sX?:number, sY?:number, noCorrectNorth?: boolean) : number;
	/** Get screen coordinates from omni object xyz coordinates. */
	_getOmniXY(ptr:number, x: number, y: number, z: number) : number;
	/** Set rendering area for a canvas (used in grids). */
	_setArea(ptr:number, X0:number, Y0:number, X1:number, Y1:number, direct:boolean, noDispatch:boolean) : void;
	/** Set rendering area for an embedded image. */
	_setImageArea(imgPtr:number, X0:number, Y0:number, X1:number, Y1:number) : void;
	/** Set 3D rotation for a 360 embedded image. */
	_setImageRotation(imgPtr:number, rotX:number,rotY:number,rotZ:number) : void;
	/** Notify Wasm a video embed is playing/paused. */
	_setImageVideoPlaying(imgPtr:number, p:boolean) : void;
	/** Force a viewport update propagation. */
	_sendViewport(ptr:number) : void;
	/** Get the internal perspective matrix pointer. */
	_getPMatrix(ptr:number) : number;
	/** Set omni object camera settings (distance, FoV, angle, offset). */
	_setOmniSettings(ptr:number, distance:number, fieldOfView:number, verticalAngle:number, offsetX:number) : void;
	/** Set 360 camera direction (yaw/pitch). */
	_setDirection(ptr:number, yaw: number, pitch?: number, resetPersp?: boolean) : void;
	/** Set camera viewport directly. */
	_setView(ptr:number, centerX: number, centerY: number, width: number, height: number, noLimit?: boolean, noLastView?: boolean, correctNorth?: boolean) : void;
	/** Animate to camera coordinates. Returns animation duration in ms. */
	_setCoo(ptr:number, x:number,y:number,s?:number,d?:number,v?:number,l?:boolean,fn?:number,n?:number) : number;
	/** Toggle limited (single layer) rendering. */
	_setLimited(ptr:number, b:boolean) : void;
	/** Get current 360 camera yaw in radians. */
	_getYaw(ptr:number, noCorrectNorth?: boolean) : number;
	/** Get current 360 camera pitch in radians. */
	_getPitch(ptr:number) : number;
	/** Get target animation opacity (0-1). */
	_getTargetOpacity(ptr: number) : number;
	/** Fade a canvas image in. */
	_fadeIn(ptr: number) : void;
	/** Fade a canvas image out. */
	_fadeOut(ptr: number) : void;
	/** Check if camera is at maximum zoom. */
	_isZoomedIn(ptr:number) : number;
	/** Check if camera is at minimum zoom. */
	_isZoomedOut(ptr:number, b:boolean) : number;
	/** Get minimum zoom scale. */
	_getMinScale(ptr:number) : number;
	/** Set minimum zoom scale. */
	_setMinScale(ptr:number, v:number) : void;
	/** Set minimum screen size fraction for zoom-out margins. */
	_setMinSize(ptr:number, v:number) : void;
	/** Get the scale at which the image covers the viewport. */
	_getCoverScale(ptr:number) : number;
	/** Get current zoom scale. */
	_getScale(ptr:number) : number;
	/** Set camera navigation boundary limits. */
	_setLimit(ptr:number, lCenterX: number, lCenterY: number, lWidth: number, lHeight: number) : void;
	/** Set 360 horizontal/vertical viewing range limits. */
	_set360RangeLimit(ptr:number, x:number, y:number) : void;
	/** Pause a running camera animation. */
	_aniPause(ptr:number, t:number) : void;
	/** Resume a paused camera animation. */
	_aniResume(ptr:number, t:number) : void;
	/** Stop a running camera animation. */
	_aniStop(ptr:number) : void;
	/** Check if current animation is post-pan kinetic movement. */
	_isKinetic(ptr:number) : boolean;
	/** Notify Wasm that panning has started. */
	_panStart(ptr:number) : void;
	/** Execute a pan operation (pixels or radians for 360). */
	_pan(ptr:number, x:number,y:number,d:number,l:boolean, t:number) : void;
	/** Notify Wasm that panning has stopped (triggers kinetic). */
	_panStop(ptr:number) : void;
	/** Set the animation starting view. */
	_setStartView(ptr: number, centerX:number, centerY:number, width:number, height:number) : void;
	/** Fly to a target viewport. Returns animation duration in ms. */
	_flyTo(ptr:number, toCenterX: number, toCenterY: number, toWidth: number, toHeight: number, dur: number, speed: number, perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, fn:number, time: number) : number;
	/** Zoom in/out animation. Returns animation duration in ms. */
	_zoom(ptr:number, d:number,x:number,y:number,p:number,v:number,l:boolean,t:number) : number;
	/** Notify Wasm that 2-finger pinch has started. */
	_pinchStart(ptr: number) : void;
	/** Execute a pinch gesture with two touch coordinates. */
	_pinch(ptr: number, x0:number, y0:number, x1:number, y1:number) : void;
	/** Notify Wasm that 2-finger pinch has stopped. */
	_pinchStop(ptr:number, t:number) : void;
	/** Set whether zoom must always cover the viewport. */
	_setCoverLimit(ptr:number, b:boolean) : void;
	/** Get whether zoom must always cover the viewport. */
	_getCoverLimit(ptr:number) : number;
	/** Set z-index render order for grid stacking. */
	_setZIndex(ptr:number, z:number) : void;
	/** Check if an image's area is being animated (grid transitions). */
	_areaAnimating(ptr:number) : number;
	/** Get the current active embedded image index. */
	_getActiveImageIdx(ptr:number) : number;
	/** Set active gallery focus area and zoom limits. */
	_setFocus(ptr:number, x0:number, y0:number, x1:number, y1:number, noLimit:boolean) : void;
	/** Fade a canvas and its sub-images to target opacity. */
	_fadeTo(ptr:number, o:number, p:boolean) : void;
	/** Fade a sub-image to target opacity. */
	_fadeImage(imgPtr:number, o:number, p:boolean) : void;
	/** Set active sub-image in a switch gallery or omni object. */
	_setActiveImage(ptr:number, idx:number, num: number) : void;
	/** Set active layer in a multi-layered omni object. */
	_setActiveLayer(ptr:number, idx:number) : void;
	/** Add an image embed with placement, dimensions, and 360 rotation. */
	_addImage(ptr:number, x0:number,y0:number,x1:number,y1:number,w:number,h:number,
		tileSize:number, isSingle: boolean, isVideo: boolean,
		opa:number, rotX:number, rotY:number, rotZ:number, scale:number, fromScale:number) : number;
	/** Add an independent canvas child with its own camera (used in grids). */
	_addChild(ptr:number, x0:number, y0: number, x1: number, y1: number, w: number, h: number) : number;
	/** Remove a MicrioImage from the Wasm container. */
	_remove(ptr:number) : void;
}
