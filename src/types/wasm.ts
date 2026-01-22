/** @internal */
export interface MicrioWasmExports extends WebAssembly.Exports {
	/** The number of X segments in 360&deg; tile geometry */
	segsX: { value: number };
	/** The number of Y segments in 360&deg; tile geometry */
	segsY: { value: number };
	/** Exposed `ease` animation
	 * @param p The input progress (`0-1`)
	 * @returns The `ease` bezier value
	*/
	ease(p:number): number;

	/** The main Wasm controller constructor for this `<micr-io>` instance.
	 * @returns The memory pointer in the shared Wasm memory for this Wasm instance.
	 */
	constructor() : number;
	/**
	 * @param ptr The Wasm Main instance memory pointer
	 * @returns The memory pointer in Wasm memory to the texture quad vertex buffer for 2D images
	*/
	getVertexBuffer(ptr:number) : number;
	/**
	 * @param ptr The Wasm Main instance memory pointer
	 * @returns The memory pointer in Wasm memory to the texture quad vertex buffer for 360&deg; images
	*/
	getVertexBuffer360(ptr:number) : number;
	/** Check whether a next frame should be requested.
	 * @param ptr The Wasm Main instance memory pointer
	 * @returns boolean whether a next drawing frame should be requested. If `false`, this means there is nothing to do (all textures have fully faded in, there is no animation running and the viewport hasn't changed)
	*/
	shouldDraw(ptr:number, now:number) : number;
	/** Do the actual drawing, passing draw commands back to `wasm.ts` and WebGL
	 * @param ptr The Wasm Main instance memory pointer
	*/
	draw(ptr:number) : void;
	/** Reset all image's animations, drawing states and textures
	 * @param ptr The Wasm Main instance memory pointer
	*/
	reset(ptr:number) : void;
	/** Stop all running animations in all images
	 * @param ptr The Wasm Main instance memory pointer
	*/
	aniStop(ptr:number) : void;
	/** Triggered by a window resize event, send the new `<micr-io>` size information
	 * @param ptr The Wasm Main instance memory pointer
	 * @param w The new element width in pixels
	 * @param h The new element height in pixels
	 * @param l The element absolute left position in pixels
	 * @param t The element absolute top position in pixels
	 * @param r The Device Pixel Ratio (ie 2 or 3)
	 * @param s The relative scale to render at
	 * @param p The current viewport is in portrait mode
	*/
	resize(ptr:number, w: number, h: number, l: number, t: number, r: number, s: number, p: boolean) : void;
	setArea(ptr:number, _w: number, _h: number) : void;
	/** ONLY draw the target layer, no incremental nice fades. Handy if you want just 1 frame
	 * drawn with minimal HTTP requests.
	 * @param ptr The Wasm Main instance memory pointer
	 * @param v The value
	 */
	setBareBone(ptr:number, v: boolean) : void;
	/** Animate the current user's global location and orientation for animating
	 * between 2 360&deg; images
	 * @param ptr The Wasm Main instance memory pointer
	 * @param direction The direction to animate to (Y-axis)
	 * @param dstX The distance to translate over the X axis
	 * @param dstY The distance to translate over the Y axis
	*/
	set360Orientation(ptr:number, direction: number, dstX: number, dstY: number) : void;
	/** Set grid transition duration, in seconds */
	setGridTransitionDuration(ptr:number, n: number) : void;
	/** Set grid transition animation type:
	 * @param ptr The Wasm Main instance memory pointer
	 * @param n Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`
	 */
	setGridTransitionTimingFunction(ptr:number, n:number) : void;
	/** Set cross fade transition duration between images
	 * @param ptr The Wasm Main instance memory pointer
	 * @param n The duration, in seconds
	*/
	setCrossfadeDuration(ptr:number, n: number) : void;
	/** Set in-image embed fade transition duration
	 * @param ptr The Wasm Main instance memory pointer
	 * @param n The duration, in seconds
	*/
	setEmbedFadeDuration(ptr:number, n: number) : void;
	/** Inertia sensitivity for camera fade-out movement post user dragging,
	 * @param ptr The Wasm Main instance memory pointer
	 * @param n The elasticity, higher is smoother. Defaults to `1`
	 */
	setDragElasticity(ptr:number, n: number) : void;
	/** Set whether the user cannot both pinch-to-zoom and pan with 2 finger
	 * touch gestures. Defaults to `false` (they can do both).
	 * @param ptr The Wasm Main instance memory pointer
	 * @param v The boolean value
	 */
	setNoPinchPan(ptr:number, v: boolean) : void;
	/** Don't download tiles under this layer number
	 * @internal
	 * @param ptr The Wasm Main instance memory pointer
	 * @param n Skip this number of base layers
	*/
	setSkipBaseLevels(ptr:number, n: number) : void;
	/** For swipeable galleries, if `true`, updates the active image to the image
	 * currently most viewed.
	 * @internal
	 * @param ptr The Wasm Main instance memory pointer
	 * @param v The boolean value
	 */
	setIsSwipe(ptr:number, v: boolean) : void;
	/** When a gallery/book/omni object has a binary MDP package, automatically
	 * the number of layers will adjust to the package's available zoom levels.
	 * @internal
	 * @param ptr The Wasm Main instance memory pointer
	 * @param v The boolean value
	 * @param n The number of layers to skip
	 */
	setHasArchive(ptr:number, v: boolean, n:number) : void;
	/** For pre-deepzoom-tiled images, the lowest resolution tiles is not 1px,
	 * but 1024/512. This sets this automatically.
	 * @internal
	 * @param ptr The Wasm Main instance memory pointer
	 * @param v The boolean value
	 */
	setNoUnderzoom(ptr:number, v:boolean) : void;
	/** Return the total number of tiles of all known canvas images in this `<micr-io>` instance.
	 * @param ptr The Wasm Main instance memory pointer
	 * @returns The total number of tiles
	*/
	getNumTiles(ptr:number) : number;

	/** Individual canvas Wasm controller constructor for a `MicrioImage` instance
	 * @param mainPtr The Wasm Main controller memory pointer
	 * @param width The original image width
	 * @param height The original image height
	 * @param tileSize The image tile size in px
	 * @param is360 The image is a 360&deg; image
	 * @param noImage Treat this as a virtual empty canvas without
	 * @param isSingle Only use the main image/video src as full-sized texture, don't use tiles
	 * @param targetOpacity The initial image opacity
	 * @param freeMove The user can pan outside the image's boundaries
	 * @param coverLimit Limit the view to the image covering the viewport
	 * @param coverStart Start the image covering the view
	 * @param maxScale The maximum original scale the user can zoom into (1=100%)
	 * @param scaleMultiplier The maximum original scale the user can zoom into (1=100%)
	 * @param camSpeed Camera animation speed multiplier
	 * @param trueNorth For a 360&deg; image, an image-wide rotation adjustment to align to north
	 * @param isGallerySwitch This is a virtual canvas for a switching image gallery
	 * @param pagesHaveBackground Gallery pages always have a white background
	 * @param isOmni Is a rotatable omni object image
	 * @param pinchZoomOutLimit User cannot pinch out further than the image boundaries
	 * @param omniNumLayers For rotatable omni objects, the amount of virtual layers this object has
	 * @param omniLayerStartIndex The omni object starting layer index
	 * @returns The memory pointer in the shared Wasm memory for this Wasm instance.
	*/
	_constructor(mainPtr:number, width: number, height: number, tileSize: number, is360: boolean,
		noImage: boolean, isSingle: boolean, targetOpacity: number,
		freeMove: boolean, coverLimit: boolean, coverStart: boolean, maxScale: number, scaleMultiplier: number, camSpeed: number,
		trueNorth: number, isGallerySwitch: boolean, pagesHaveBackground: boolean,
		isOmni: boolean, pinchZoomOutLimit: boolean, omniNumLayers: number, omniLayerStartIndex:number) : number;
	/** Get the requested image's current view coordinates [centerX, centerY, width, height]
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @returns Memory pointer to the `Uint32Array` containing the coordinates
	 */
	_getView(ptr:number) : number;
	/** Get the requested image's coordinates based on a screen pixel position
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param x The requested pixel X coordinate `[0-1]`
	 * @param y The requested pixel Y coordinate `[0-1]`
	 * @param abs Get absolute screen pixel results
	 * @param noLimit Return coordinates can be outside `[0,0,1,1]`
	 * @returns Memory pointer to the `Uint32Array` containing the coordinates
	 */
	_getCoo(ptr:number, x: number, y: number, abs?: boolean, noLimit?: boolean) : number;
	/** Get an image's requested `[x, y]` pixel values for input coordinates `x` and `y`
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param x The requested X coordinate `[0-1]`
	 * @param y The requested Y coordinate `[0-1]`
	 * @param abs Get absolute screen pixel results
	 * @param radius In case of a rotatable object, the radius from center in 3d space
	 * @param rotation In case of a rotatable object, the absolute angle of rotation on the Y axis
	 * @returns Memory pointer to the `Uint32Array` containing the pixel coordinates
	 */
	_getXY(
		ptr:number,
		x: number,
		y: number,
		abs?: boolean,
		radius?:number,
		rotation?:number
	) : number;
	/** Get a 4x4 matrix to be used in CSS
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param x The X coordinate
	 * @param y The Y coordinate
	 * @param s The object scale
	 * @param r The object radius (default 10)
	 * @param rX The object X rotation in radians
	 * @param rY The object Y rotation in radians
	 * @param rZ The object Z rotation in radians
	 * @param t Optional Y translation in 3d space
	 * @param sX Optional X scaling
	 * @param sY Optional Y scaling
	 * @param noCorrectNorth Don't correct for true north
	 * @returns Memory pointer to the `Uint32Array` containing the Matrix4 array
	 */
	_getMatrix(ptr:number, x?:number, y?:number, s?:number, r?:number, rX?:number, rY?:number, rZ?:number, t?:number, sX?:number, sY?:number, noCorrectNorth?: boolean) : number;
	/** Get the screen coordinates based on omni object xyz coordinates */
	_getOmniXY(ptr:number, x: number, y: number, z: number) : number;
	/** Set the relative View area of a MicrioImage to render to, animates by default. Used in grids.
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param X0 The viewport X0 coordinate
	 * @param Y0 The viewport Y0 coordinate
	 * @param X1 The viewport X1 coordinate
	 * @param Y1 The viewport Y1 coordinate
	 * @param direct Don't animate
	 * @param noDispatch Don't do a frame draw after setting
	 */
	_setArea(ptr:number, X0:number, Y0:number, X1:number, Y1:number, direct:boolean, noDispatch:boolean) : void;
	/** Set the relative View area of an embedded image to render to.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param X0 The viewport X0 coordinate
	 * @param Y0 The viewport Y0 coordinate
	 * @param X1 The viewport X1 coordinate
	 * @param Y1 The viewport Y1 coordinate
	 */
	_setImageArea(imgPtr:number, X0:number, Y0:number, X1:number, Y1:number) : void;
	/** Set an embedded sub-image rotation in 3d space for 360&deg; images.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param rotX The rotation over the X-axis
	 * @param rotY The rotation over the Y-axis
	 * @param rotZ The rotation over the Z-axis
	 */
	_setImageRotation(imgPtr:number, rotX:number,rotY:number,rotZ:number) : void;
	/** Let Wasm know a video embed is playing, so it keeps requesting frames
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param p The boolean value
	 */
	_setImageVideoPlaying(imgPtr:number, p:boolean) : void;
	/** Force a viewport update to be propagated
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_sendViewport(ptr:number) : void;
	/** Get the memory pointer of Wasm's internal position Matrix4
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Memory pointer of the `Uint32Array` matrix
	*/
	_getPMatrix(ptr:number) : number;
	/** Set camera settings for viewing rotatable omni objects
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param distance The camera distance the object was taken at
	 * @param fieldOfView The FoV of the camera
	 * @param verticalAngle The vertical angle at which the object was taken
	 * @param offsetX A horizontal offset for non-centered objects
	*/
	_setOmniSettings(ptr:number, distance:number, fieldOfView:number, verticalAngle:number, offsetX:number) : void;
	/** Set the current camera direction in a 360&deg; image.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param yaw The camera yaw (X-axis)
	 * @param pitch The camera pitch (Y-axis)
	 * @param resetPersp Force a reset of the perspective (ie after resize)
	*/
	_setDirection(ptr:number, yaw: number, pitch?: number, resetPersp?: boolean) : void;
	/** Set the current camera viewport
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param centerX The viewport X0 coordinate
	 * @param centerY The viewport Y0 coordinate
	 * @param width The viewport X1 coordinate
	 * @param height The viewport Y1 coordinate
	 * @param noLimit The viewport can be outside of the image's limits
	 * @param noLastView Don't keep track of the previous viewport
	 * @param correctNorth Internally adjust relative 360&deg; rotation
	*/
	_setView(ptr:number, centerX: number, centerY: number, width: number, height: number, noLimit?: boolean, noLastView?: boolean, correctNorth?: boolean) : void;
	/** Set the current camera coordinates
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param x The X coordinate
	 * @param y The Y coordinate
	 * @param s Optional zoom scale for zooming
	 * @param d Optional animation duration in ms
	 * @param v When no duration is specified, animation velocity multiplier (default `1`)
	 * @param fn Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`
	 * @param n The current timestamp (`performance.now()`)
	 * @returns The resulting animation duration in ms
	*/
	_setCoo(ptr:number, x:number,y:number,s?:number,d?:number,v?:number,l?:boolean,fn?:number,n?:number) : number;
	/** Only allow 1 layer to render
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param b The boolean value
	*/
	_setLimited(ptr:number, b:boolean) : void;
	/** Get the current camera yaw (Y-axis rotation) for 360&deg; images
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns The current yaw in radians
	*/
	_getYaw(ptr:number, noCorrectNorth?: boolean) : number;
	/** Get the current camera pitch (X-axis rotation) for 360&deg; images
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns The current pitch in radians
	*/
	_getPitch(ptr:number) : number;
	/** Get the image's target animation opacity
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns The current target opacity `[0-1]`
	*/
	_getTargetOpacity(ptr: number) : number;
	/** Fade an image in
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_fadeIn(ptr: number) : void;
	/** Fade an image out
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_fadeOut(ptr: number) : void;
	/** Check whether the camera is maximally zoomed in to the image
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Boolean as int `0|1`
	*/
	_isZoomedIn(ptr:number) : number;
	/** Check whether the camera is maximally zoomed out
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Boolean as int `0|1`
	*/
	_isZoomedOut(ptr:number, b:boolean) : number;
	/** Get the image's minimum scale (max zoom out limit)
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns The image's minimum zoom scale
	*/
	_getMinScale(ptr:number) : number;
	/** Set the image's minimum scale (max zoom out limit)
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param v The image's minimum zoom scale
	*/
	_setMinScale(ptr:number, v:number) : void;
	/** Sets the minimum screen size you can zoom out to -- this makes you able to zoom out with margins
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param v The minimum screen size [0-1]
	*/
	_setMinSize(ptr:number, v:number) : void;
	/**
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns The image's scale to be fully covering the viewport
	*/
	_getCoverScale(ptr:number) : number;
	/**
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns The image's current zoom scale
	*/
	_getScale(ptr:number) : number;
	/** Limit camera navigation boundaries
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param lCenterX The viewport center X coordinate
	 * @param lCenterY The viewport center Y coordinate
	 * @param lWidth The viewport width
	 * @param lHeight The viewport height
	*/
	_setLimit(ptr:number, lCenterX: number, lCenterY: number, lWidth: number, lHeight: number) : void;
	/** Limit camera navigation boundaries in 360&deg; images
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param x The horizontal view limits in radians
	 * @param y The vertical view limits in radians
	*/
	_set360RangeLimit(ptr:number, x:number, y:number) : void;
	/** Pause a running image animation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param t The current timestamp in ms
	*/
	_aniPause(ptr:number, t:number) : void;
	/** Resume a paused image animation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param t The current timestamp in ms
	*/
	_aniResume(ptr:number, t:number) : void;
	/** Stop a running image animation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_aniStop(ptr:number) : void;
	/** Checks whether the current animation is a post-pan elastic movement
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Boolean as int `0|1`
	*/
	_isKinetic(ptr:number) : boolean;
	/** User has started panning
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_panStart(ptr:number) : void;
	/** Pan operation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param x The horizontal number of pixels to pan
	 * @param y The vertical number of pixels to pan
	 * @param d An optional duration
	 * @param l Don't limit the viewport to the image's boundaries
	 * @param t The current timestamp in ms
	*/
	_pan(ptr:number, x:number,y:number,d:number,l:boolean, t:number) : void;
	/** User has stopped panning, used for post-pan elastic animation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_panStop(ptr:number) : void;
	/** Set an image's opening view
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param centerX The viewport X0 coordinate
	 * @param centerY The viewport Y0 coordinate
	 * @param width The viewport X1 coordinate
	 * @param height The viewport Y1 coordinate
	*/
	_setStartView(ptr: number, centerX:number, centerY:number, width:number, height:number) : void;
	/** Fly to a specific viewport
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param toCenterX The viewport X0 coordinate
	 * @param toCenterY The viewport Y0 coordinate
	 * @param toWidth The viewport X1 coordinate
	 * @param toHeight The viewport Y1 coordinate
	 * @param dur The animation duration in ms, use `-1` for `auto`
	 * @param speed When duration `auto`, a speed modifier (default `1`)
	 * @param perc Start the animation at a certain progress (`0-1`)
	 * @param isJump Make the camera zoom out and in during this animation
	 * @param limit Limit the animation to the image's boundaries
	 * @param limitZoom Don't allow the animation to zoom in further than the maximum zoom
	 * @param toOmniIdx For rotatable omni objects, also animate to this frame
	 * @param fn Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`
	 * @param time The current timestamp (`performance.now()`)
	 * @returns The resulting animation duration in ms
	*/
	_flyTo(ptr:number, toCenterX: number, toCenterY: number, toWidth: number, toHeight: number, dur: number, speed: number, perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, fn:number, time: number) : number;
	/** A zoom in/out animation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param d The amount to zoom
	 * @param x Screen pixel X-coordinate as zoom focus
	 * @param y Screen pixel Y-coordinate as zoom focus
	 * @param p A forced duration in ms of the animation
	 * @param v A non-default camera speed modifier (default `1`)
	 * @param l Can zoom outside of the image boundaries
	 * @param t The current timestamp (`performance.now()`)
	 * @returns The resulting animation duration in ms
	*/
	_zoom(ptr:number, d:number,x:number,y:number,p:number,v:number,l:boolean,t:number) : number;
	/** User has started 2-finger pinch
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_pinchStart(ptr: number) : void;
	/** User has made a pinch operation
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param x0 The first touch X coordinate in pixels
	 * @param y0 The first touch Y coordinate in pixels
	 * @param x1 The second touch X coordinate in pixels
	 * @param y1 The second touch Y coordinate in pixels
	*/
	_pinch(ptr: number, x0:number, y0:number, x1:number, y1:number) : void;
	/** User has stopped 2-finger pinch
	 * @param ptr The sub image memory pointer in shared Wasm memory
	*/
	_pinchStop(ptr:number, t:number) : void;
	/** Set the image's zoom to always cover the entire viewport
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param b Boolean value
	*/
	_setCoverLimit(ptr:number, b:boolean) : void;
	/** Get the image's zoom to always cover the entire viewport
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Boolean value
	*/
	_getCoverLimit(ptr:number) : number;
	/** Influence the image render order. Higher value means being on top of other images.
	 * Used in grids.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param z The target z-index value.
	*/
	_setZIndex(ptr:number, z:number) : void;
	/** Check whether an embedded image's area in the main canvas is current being animated.
	 * Used in grids.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Boolean as int `0|1`
	*/
	_areaAnimating(ptr:number) : number;
	/** Get the current active embedded image's index. Used in grids.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @returns Sub-image index
	*/
	_getActiveImageIdx(ptr:number) : number;
	/** Set an active image in a swipeable gallery, flying to its relative viewport
	 * inside the containing canvas.
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param x0 The viewport X0 coordinate
	 * @param y0 The viewport Y0 coordinate
	 * @param x1 The viewport X1 coordinate
	 * @param y1 The viewport Y1 coordinate
	 * @param noLimit Don't update the zoom limits
	*/
	_setFocus(ptr:number, x0:number, y0:number, x1:number, y1:number, noLimit:boolean) : void;
	/** Fade a main MicrioImage to a target opacity, including all of its sub-images
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param o The target opacity (`0-1`)
	 * @param p Don't animate, but immediately set this opacity
	*/
	_fadeTo(ptr:number, o:number, p:boolean) : void;
	/** Fade a sub-image to a target opacity
	 * @param ptr The sub image memory pointer in shared Wasm memory
	 * @param o The target opacity (`0-1`)
	 * @param p Don't animate, but immediately set this opacity
	*/
	_fadeImage(imgPtr:number, o:number, p:boolean) : void;
	/** Set an active sub-image in a switch gallery or omni object, immediately switching
	 * to that image.
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param idx The sub-image index
	 * @param num Additional extra images to show next to it (ie. 2 images in single page spread)
	*/
	_setActiveImage(ptr:number, idx:number, num: number) : void;
	/** Set an active layer in a multi-layered omni object, immediately switching to that layer.
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param idx The omni object layer index
	*/
	_setActiveLayer(ptr:number, idx:number) : void;
	/** Add an image embed
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param x0 The placement viewport X0 coordinate
	 * @param y0 The placement viewport Y0 coordinate
	 * @param x1 The placement viewport X1 coordinate
	 * @param y1 The placement viewport Y1 coordinate
	 * @param w The original image's width in pixels
	 * @param h The original image's height in pixels
	 * @param tileSize The image's tile size in pixels
	 * @param isSingle Use the original image always -- don't use tiles
	 * @param isVideo The embed is a video
	 * @param opa The starting opacity (`0-1`)
	 * @param rotX For embeds in 360&deg; space, the X rotation
	 * @param rotY For embeds in 360&deg; space, the Y rotation
	 * @param rotZ For embeds in 360&deg; space, the Z rotation
	 * @param scale Relative scale of this embed
	 * @param fromScale Only display when the user is zoomed over this threshold in the main image
	 * @returns The memory pointer to the Wasm `Image` object
	*/
	_addImage(ptr:number, x0:number,y0:number,x1:number,y1:number,w:number,h:number,
		tileSize:number, isSingle: boolean, isVideo: boolean,
		opa:number, rotX:number, rotY:number, rotZ:number, scale:number, fromScale:number) : number;
	/** Add an independent image canvas object with its own camera, used in grids.
	 * @param ptr The image memory pointer in shared Wasm memory
	 * @param x0 The placement viewport X0 coordinate
	 * @param y0 The placement viewport Y0 coordinate
	 * @param x1 The placement viewport X1 coordinate
	 * @param y1 The placement viewport Y1 coordinate
	 * @param w The original image's width in pixels
	 * @param h The original image's height in pixels
	 * @returns The memory pointer to the Wasm `Canvas` object
	*/
	_addChild(ptr:number, x0:number, y0: number, x1: number, y1: number, w: number, h: number) : number;
	/** Remove a main `MicrioImage` from the Main Wasm container
	 * @param ptr The image memory pointer in shared Wasm memory
	*/
	_remove(ptr:number) : void;
}
