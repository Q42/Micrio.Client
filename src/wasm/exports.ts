
import { segsX as _sX, segsY as _sY} from './globals';
import { Main } from './main';
import { easeInOut, easeIn, easeOut, linear } from './utils';
import Canvas from './canvas';
import Image from './image';

/** Number of horizontal segments used for 360 sphere geometry. */
export const segsX:u32 = _sX;
/** Number of vertical segments used for 360 sphere geometry. */
export const segsY:u32 = _sY;

/**
 * Utility function to get eased value (easeInOut). Exposed for potential JS use.
 * @param p The input progress (`0-1`).
 * @returns The `ease` bezier value.
 */
export function ease(p:f64) : f64 { return easeInOut.get(p) }

// --- Main Wasm Instance Functions ---

/**
 * The main Wasm controller constructor for this `<micr-io>` instance.
 * @returns The memory pointer in the shared Wasm memory for this Wasm instance.
 */
export function constructor() : Main { return new Main(); }
/**
 * @param m The Wasm Main instance memory pointer.
 * @returns The memory pointer in Wasm memory to the texture quad vertex buffer for 2D images.
 */
export function getVertexBuffer(m:Main) : Float32Array { return m.vertexBuffer; }
/**
 * @param m The Wasm Main instance memory pointer.
 * @returns The memory pointer in Wasm memory to the texture quad vertex buffer for 360&deg; images.
 */
export function getVertexBuffer360(m:Main) : Float32Array { return m.vertexBuffer360; }
/**
 * Sets a rendering area constraint (used for partial screen rendering).
 * @param m The Wasm Main instance memory pointer.
 * @param _w Width constraint.
 * @param _h Height constraint.
 */
export function setArea(m:Main, _w: i32, _h: i32) : void { m.el.areaWidth = _w; m.el.areaHeight = _h; }
/**
 * ONLY draw the target layer, no incremental nice fades. Handy if you want just 1 frame
 * drawn with minimal HTTP requests.
 * @param m The Wasm Main instance memory pointer.
 * @param v The value.
 */
export function setBareBone(m:Main, v:bool) : void { m.bareBone = v; }
/**
 * Animate the current user's global location and orientation for animating
 * between 2 360&deg; images.
 * @param m The Wasm Main instance memory pointer.
 * @param d The direction to animate to (Y-axis).
 * @param dX The distance to translate over the X axis.
 * @param dY The distance to translate over the Y axis.
 */
export function set360Orientation(m:Main, d:f64, dX:f64, dY:f64) : void {
	m.direction = d; m.distanceX = dX; m.distanceY = dY; }
/**
 * Set grid transition duration, in seconds.
 * @param m The Wasm Main instance memory pointer.
 * @param n Duration in seconds.
 */
export function setGridTransitionDuration(m:Main, n:f64) : void { m.gridTransitionDuration = n; }
/**
 * Set grid transition animation type.
 * @param m The Wasm Main instance memory pointer.
 * @param fn Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`.
 */
export function setGridTransitionTimingFunction(m:Main, fn:u16) : void { m.gridTransitionTimingFunction = fn == 3 ? linear : fn == 2 ? easeOut : fn == 1 ? easeIn : easeInOut; }
/**
 * Set cross fade transition duration between images.
 * @param m The Wasm Main instance memory pointer.
 * @param n The duration, in seconds.
 */
export function setCrossfadeDuration(m:Main, n:f64) : void { m.crossfadeDuration = n; }
/**
 * Set in-image embed fade transition duration.
 * @param m The Wasm Main instance memory pointer.
 * @param n The duration, in seconds.
 */
export function setEmbedFadeDuration(m:Main, n:f64) : void { m.embedFadeDuration = n; }
/**
 * Inertia sensitivity for camera fade-out movement post user dragging.
 * @param m The Wasm Main instance memory pointer.
 * @param n The elasticity, higher is smoother. Defaults to `1`.
 */
export function setDragElasticity(m:Main, n:f64) : void { m.dragElasticity = n; }
/**
 * Don't download tiles under this layer number.
 * @internal
 * @param m The Wasm Main instance memory pointer.
 * @param n Skip this number of base layers.
 */
export function setSkipBaseLevels(m:Main, n:i8) : void { m.skipBaseLevels = n; }
/**
 * Set whether the user cannot both pinch-to-zoom and pan with 2 finger
 * touch gestures. Defaults to `false` (they can do both).
 * @param m The Wasm Main instance memory pointer.
 * @param b The boolean value.
 */
export function setNoPinchPan(m:Main, b:bool) : void { m.noPinchPan = b; }
/**
 * For swipeable galleries, if `true`, updates the active image to the image
 * currently most viewed.
 * @internal
 * @param m The Wasm Main instance memory pointer.
 * @param b The boolean value.
 */
export function setIsSwipe(m:Main, b:bool) : void { m.isSwipe = b; }
/**
 * When a gallery/book/omni object has a binary MDP package, automatically
 * the number of layers will adjust to the package's available zoom levels.
 * @internal
 * @param m The Wasm Main instance memory pointer.
 * @param b The boolean value.
 * @param o The number of layers to skip.
 */
export function setHasArchive(m:Main, b:bool, o:u8) : void { m.hasArchive = b; m.archiveLayerOffset = o; }
/**
 * For pre-deepzoom-tiled images, the lowest resolution tiles is not 1px,
 * but 1024/512. This sets this automatically.
 * @internal
 * @param m The Wasm Main instance memory pointer.
 * @param b The boolean value.
 */
export function setNoUnderzoom(m:Main, b:bool) : void { m.underzoomLevels = b ? 1 : 4; }
/**
 * Return the total number of tiles of all known canvas images in this `<micr-io>` instance.
 * @param m The Wasm Main instance memory pointer.
 * @returns The total number of tiles.
 */
export function getNumTiles(m:Main) : u32 { return m.numTiles }
/**
 * Check whether a next frame should be requested.
 * @param m The Wasm Main instance memory pointer.
 * @param now Current time (performance.now()).
 * @returns boolean whether a next drawing frame should be requested. If `false`, this means there is nothing to do (all textures have fully faded in, there is no animation running and the viewport hasn't changed).
 */
export function shouldDraw(m:Main, now: f32) : bool { return m.shouldDraw(now); }
/**
 * Do the actual drawing, passing draw commands back to `wasm.ts` and WebGL.
 * @param m The Wasm Main instance memory pointer.
 */
export function draw(m:Main) : void { m.draw(); }
/**
 * Reset all image's animations, drawing states and textures.
 * @param m The Wasm Main instance memory pointer.
 */
export function reset(m:Main) : void { m.reset(); }
/**
 * Stop all running animations in all images.
 * @param m The Wasm Main instance memory pointer.
 */
export function aniStop(m:Main) : void { m.aniStop(); }
/**
 * Triggered by a window resize event, send the new `<micr-io>` size information.
 * @param m The Wasm Main instance memory pointer.
 * @param w The new element width in pixels.
 * @param h The new element height in pixels.
 * @param l The element absolute left position in pixels.
 * @param t The element absolute top position in pixels.
 * @param r The Device Pixel Ratio (ie 2 or 3).
 * @param s The relative scale to render at.
 * @param p The current viewport is in portrait mode.
 */
export function resize(m:Main, w: u16, h: u16, l: i32, t: i32, r: f64, s: f64, p: bool) : void {
	m.resize(w, h, l, t, r, s, p);
}

// --- Canvas Instance Functions (prefixed with _) ---

/**
 * Individual canvas Wasm controller constructor for a `MicrioImage` instance.
 * @param a The Wasm Main controller memory pointer.
 * @param b The original image width.
 * @param c The original image height.
 * @param d The image tile size in px.
 * @param f The image is a 360&deg; image.
 * @param h Treat this as a virtual empty canvas without image data.
 * @param i Only use the main image/video src as full-sized texture, don't use tiles.
 * @param j The initial image opacity.
 * @param k The user can pan outside the image's boundaries.
 * @param l Limit the view to the image covering the viewport.
 * @param m Start the image covering the view.
 * @param n The maximum original scale the user can zoom into (1=100%).
 * @param o Camera animation speed multiplier.
 * @param p For a 360&deg; image, an image-wide rotation adjustment to align to north.
 * @param q This is a virtual canvas for a switching image gallery.
 * @param r Gallery pages always have a white background.
 * @param s Is a rotatable omni object image.
 * @param t User cannot pinch out further than the image boundaries.
 * @param u For rotatable omni objects, the amount of virtual layers this object has.
 * @param v The omni object starting layer index.
 * @returns The memory pointer in the shared Wasm memory for this Canvas instance.
 */
export function _constructor(a: Main, b: f64, c: f64, d: u32, f: bool, h: bool,
	i: bool, j: f64, k: bool, l: bool, m: bool, n: f64, o: f64, p: f64, q: bool, r: bool,
	s: bool, t: bool, u:i32, v: i32) : Canvas {
	return new Canvas(a,b,c,d,f,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,false);
}
/**
 * Get the requested image's current view coordinates `[x0, y0, x1, y1]`.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Memory pointer to the `Float64Array` containing the coordinates.
 */
export function _getView(c:Canvas) : Float64Array { return c.getView() };
/**
 * Get the requested image's coordinates based on a screen pixel position.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x The requested pixel X coordinate.
 * @param y The requested pixel Y coordinate.
 * @param abs Get absolute screen pixel results.
 * @param noLimit Return coordinates can be outside `[0,0,1,1]`.
 * @returns Memory pointer to the `Float64Array` containing the coordinates [imageX, imageY, scale, w (depth), direction].
 */
export function _getCoo(c:Canvas, x: f64, y: f64, abs: bool, noLimit: bool) : Float64Array {
	return c.getCoo(x, y, abs, noLimit) };
/**
 * Get an image's requested `[x, y]` pixel values for input coordinates `x` and `y`.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x The requested X coordinate `[0-1]`.
 * @param y The requested Y coordinate `[0-1]`.
 * @param abs Get absolute screen pixel results.
 * @param radius In case of a rotatable object, the radius from center in 3d space.
 * @param rotation In case of a rotatable object, the absolute angle of rotation on the Y axis.
 * @returns Memory pointer to the `Float64Array` containing the pixel coordinates [screenX, screenY, scale, w (depth)].
 */
export function _getXY(c:Canvas, x: f64, y: f64, abs: bool, radius:f64, rotation:f64) : Float64Array {
	return c.getXY(x, y, abs, radius, rotation) };
/**
 * Get a 4x4 matrix to be used in CSS.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x The X coordinate.
 * @param y The Y coordinate.
 * @param s The object scale.
 * @param r The object radius (default 10).
 * @param rX The object X rotation in radians.
 * @param rY The object Y rotation in radians.
 * @param rZ The object Z rotation in radians.
 * @param t Optional Y translation in 3d space.
 * @param sX Optional X scaling.
 * @param sY Optional Y scaling.
 * @returns Memory pointer to the `Float32Array` containing the Matrix4 array.
 */
export function _getMatrix(c:Canvas, x:f64,y:f64,s:f64,r:f64,rX:f64,rY:f64, rZ:f64,t:f64,sX:f64,sY:f64) : Float32Array {
	return c.getMatrix(x,y,s,r,rX,rY,rZ,t,sX,sY) };
/**
 * Get the screen coordinates based on omni object xyz coordinates.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x Omni object X coordinate.
 * @param y Omni object Y coordinate.
 * @param z Omni object Z coordinate.
 * @returns Memory pointer to the `Float64Array` containing screen coordinates [screenX, screenY, scale, w (depth)].
 */
export function _getOmniXY(c:Canvas, x: f64, y: f64, z:f64) : Float64Array {
	return c.camera.getXYOmniCoo(x, y, z, 0, false).toArray() };
/**
 * Set the relative View area of a MicrioImage to render to, animates by default. Used in grids.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x0 The viewport X0 coordinate.
 * @param y0 The viewport Y0 coordinate.
 * @param x1 The viewport X1 coordinate.
 * @param y1 The viewport Y1 coordinate.
 * @param direct Don't animate.
 * @param noDispatch Don't do a frame draw after setting.
 */
export function _setArea(c:Canvas, x0:f64,y0:f64,x1:f64,y1:f64,direct:bool,noDispatch:bool) : void {
	c.setArea(x0, y0, x1, y1, direct, noDispatch) }
/**
 * Set the relative View area of an embedded image to render to.
 * @param i The sub image memory pointer in shared Wasm memory.
 * @param x0 The viewport X0 coordinate.
 * @param y0 The viewport Y0 coordinate.
 * @param x1 The viewport X1 coordinate.
 * @param y1 The viewport Y1 coordinate.
 */
export function _setImageArea(i:Image, x0:f64,y0:f64,x1:f64,y1:f64) : void {
	i.setArea(x0, y0, x1, y1) }
/**
 * Set an embedded sub-image rotation in 3d space for 360&deg; images.
 * @param i The sub image memory pointer in shared Wasm memory.
 * @param rotX The rotation over the X-axis.
 * @param rotY The rotation over the Y-axis.
 * @param rotZ The rotation over the Z-axis.
 */
export function _setImageRotation(i:Image, rotX:f64, rotY:f64, rotZ:f64) : void {
	i.rotX = rotX; i.rotY = rotY; i.rotZ = rotZ }
/**
 * Let Wasm know a video embed is playing, so it keeps requesting frames.
 * @param i The sub image memory pointer in shared Wasm memory.
 * @param p The boolean value.
 */
export function _setImageVideoPlaying(i:Image, p:bool) : void { i.isVideoPlaying = p }
/**
 * Force a viewport update to be propagated.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _sendViewport(c:Canvas) : void { c.sendViewport() }
/**
 * Get the memory pointer of Wasm's internal position Matrix4.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Memory pointer of the `Float32Array` matrix.
 */
export function _getPMatrix(c:Canvas) : Float32Array { return c.webgl.pMatrix.arr }
/**
 * Get the current camera yaw (Y-axis rotation) for 360&deg; images.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns The current yaw in radians.
 */
export function _getYaw(c:Canvas) : f64 { return c.webgl.yaw + c.webgl.baseYaw }
/**
 * Get the current camera pitch (X-axis rotation) for 360&deg; images.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns The current pitch in radians.
 */
export function _getPitch(c:Canvas) : f64 { return c.webgl.pitch }
/**
 * Set camera settings for viewing rotatable omni objects.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param d The camera distance the object was taken at.
 * @param fov The FoV of the camera.
 * @param vA The vertical angle at which the object was taken.
 * @param oX A horizontal offset for non-centered objects.
 */
export function _setOmniSettings(c:Canvas, d:f64, fov:f64, vA:f64, oX:f64) : void {
	c.omniDistance = d; c.omniFieldOfView = fov; c.omniVerticalAngle = vA; c.omniOffsetX = oX; }
/**
 * Set the current camera direction in a 360&deg; image.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param yaw The camera yaw (X-axis).
 * @param pitch The camera pitch (Y-axis).
 * @param resetPersp Force a reset of the perspective (ie after resize).
 */
export function _setDirection(c:Canvas, yaw: f64, pitch: f64, resetPersp: bool) : void {
	c.setDirection(yaw, pitch, resetPersp) }
/**
 * Set the current camera viewport.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x0 The viewport X0 coordinate.
 * @param y0 The viewport Y0 coordinate.
 * @param x1 The viewport X1 coordinate.
 * @param y1 The viewport Y1 coordinate.
 * @param noLimit The viewport can be outside of the image's limits.
 * @param noLastView Don't keep track of the previous viewport.
 * @param correctNorth Internally adjust relative 360&deg; rotation.
 */
export function _setView(c:Canvas, x0: f64, y0: f64, x1: f64, y1: f64, noLimit: bool, noLastView: bool, correctNorth: bool) : void {
	c.setView(x0, y0, x1, y1, noLimit, noLastView, correctNorth) }
/**
 * Set the current camera viewport using 360-degree area format.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param centerX The center X coordinate (0-1).
 * @param centerY The center Y coordinate (0-1).
 * @param width The area width (0-1).
 * @param height The area height (0-1).
 * @param noLimit The viewport can be outside of the image's limits.
 * @param noLastView Don't keep track of the previous viewport.
 * @param correctNorth Internally adjust relative 360&deg; rotation.
 */
export function _setView360(c:Canvas, centerX: f64, centerY: f64, width: f64, height: f64, noLimit: bool, noLastView: bool, correctNorth: bool) : void {
	// Convert View360 to standard View format
	const x0 = centerX - width / 2;
	const y0 = centerY - height / 2;
	const x1 = centerX + width / 2;
	const y1 = centerY + height / 2;
	if(c.is360) {
		// For 360 images, use direct camera control
		c.setView360(centerX, centerY, width, height, noLimit, correctNorth);
		// Note: Limits are automatically applied in WebGL.setView360() -> setPerspective()
		if(!noLastView) {
			// Store last view in View format for compatibility
			c.ani.lastView.set(x0, y0, x1, y1);
		}
	} else {
		// For 2D images, convert to standard View format
		c.setView(x0, y0, x1, y1, noLimit, noLastView, correctNorth);
	}
}
/**
 * Get the current camera view as a 360-degree area.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Pointer to a Float64Array containing [centerX, centerY, width, height].
 */
export function _getView360(c:Canvas) : Float64Array {
	return c.getView360();
}
/**
 * Set the current camera coordinates.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x The X coordinate.
 * @param y The Y coordinate.
 * @param s Optional zoom scale for zooming.
 * @param d Optional animation duration in ms.
 * @param v When no duration is specified, animation velocity multiplier (default `1`).
 * @param l Limit viewport during animation.
 * @param fn Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`.
 * @param n The current timestamp (`performance.now()`).
 * @returns The resulting animation duration in ms.
 */
export function _setCoo(c:Canvas, x:f64,y:f64,s:f64,d:f64,v:f64,l:bool,fn:i16,n:f64): f64 {
	return c.camera.setCoo(x,y,s,d,v,l,fn,n); }
/**
 * Only allow 1 layer to render.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param b The boolean value.
 */
export function _setLimited(c:Canvas, b:bool) : void { c.limited = b }
/**
 * Get the image's target animation opacity.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns The current target opacity `[0-1]`.
 */
export function _getTargetOpacity(c:Canvas) : f64 { return c.targetOpacity }
/**
 * Fade an image in.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _fadeIn(c:Canvas) : void { c.fadeIn() }
/**
 * Fade an image out.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _fadeOut(c:Canvas) : void { c.fadeOut() }
/**
 * Check whether the camera is maximally zoomed in to the image.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Boolean as int `0|1`.
 */
export function _isZoomedIn(c:Canvas) : bool { return c.isZoomedIn() }
/**
 * Check whether the camera is maximally zoomed out.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param b Check against full minimum size (ignoring margins).
 * @returns Boolean as int `0|1`.
 */
export function _isZoomedOut(c:Canvas, b:bool) : bool { return c.isZoomedOut(b) }
/**
 * Get the image's minimum scale (max zoom out limit).
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns The image's minimum zoom scale.
 */
export function _getMinScale(c:Canvas) : f64 { return c.camera.minScale }
/**
 * Set the image's minimum scale (max zoom out limit).
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param s The image's minimum zoom scale.
 */
export function _setMinScale(c:Canvas, s:f64) : void { c.camera.minScale = s; }
/**
 * Sets the minimum screen size you can zoom out to -- this makes you able to zoom out with margins.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param s The minimum screen size [0-1].
 */
export function _setMinSize(c:Canvas, s:f64) : void { c.camera.minSize = s; }
/**
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns The image's scale to be fully covering the viewport.
 */
export function _getCoverScale(c:Canvas) : f64 { return c.camera.coverScale }
/**
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns The image's current zoom scale.
 */
export function _getScale(c:Canvas) : f64 { return c.getScale() }
/**
 * Limit camera navigation boundaries.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x0 The viewport X0 coordinate.
 * @param y0 The viewport Y0 coordinate.
 * @param x1 The viewport X1 coordinate.
 * @param y1 The viewport Y1 coordinate.
 */
export function _setLimit(c:Canvas, x0: f64, y0: f64, x1: f64, y1: f64) : void {
	if(c.view.lX0 == x0 && c.view.lX1 == x1 && c.view.lY0 == y0 && c.view.lY1 == y1) return;
	c.view.setLimit(x0, y0, x1, y1);
	c.camera.setCanvas();
	c.camera.pan(0,0,0,false,0,true);
}
/**
 * Limit camera navigation boundaries in 360&deg; images.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x The horizontal view limits in percentage (0-1).
 * @param y The vertical view limits in percentage (0-1).
 */
export function _set360RangeLimit(c:Canvas, x:f64, y:f64) : void {
	if(c.is360) c.webgl.setLimits(x, y) }
/**
 * Pause a running image animation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param t The current timestamp in ms.
 */
export function _aniPause(c:Canvas, t:f64) : void { c.aniPause(t) }
/**
 * Resume a paused image animation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param t The current timestamp in ms.
 */
export function _aniResume(c:Canvas, t:f64) : void { c.aniResume(t) }
/**
 * Stop a running image animation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _aniStop(c:Canvas) : void { c.kinetic.stop(); c.aniStop() }
/**
 * Checks whether the current animation is a post-pan elastic movement.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Boolean as int `0|1`.
 */
export function _isKinetic(c:Canvas) : bool { return c.kinetic.started }
/**
 * User has started panning.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _panStart(c:Canvas) : void {
	c.kinetic.stop(); if(c.is360 || (c.camera.scale >= c.camera.minScale)) c.ani.stop() }
/**
 * Pan operation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param a The horizontal number of pixels to pan (or radians for 360).
 * @param b The vertical number of pixels to pan (or radians for 360).
 * @param x An optional duration (or factor for 360).
 * @param l Don't limit the viewport to the image's boundaries.
 * @param d The current timestamp in ms.
 */
export function _pan(c:Canvas, a:f64,b:f64,x:f64,l:bool,d:f64) : void {
	if(c.is360) c.webgl.rotate(a,b,x,d); else c.camera.pan(a,b,x,l,d) }
/**
 * User has stopped panning, used for post-pan elastic animation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _panStop(c:Canvas) : void {
	if(c.is360 || (c.camera.scale >= c.camera.minScale)) c.ani.stop(); c.kinetic.start() }
/**
 * Set an image's opening view.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param p0 The viewport X0 coordinate.
 * @param p1 The viewport Y0 coordinate.
 * @param p2 The viewport X1 coordinate.
 * @param p3 The viewport Y1 coordinate.
 */
export function _setStartView(c:Canvas, p0:f64, p1:f64, p2:f64, p3:f64) : void {
	c.ani.setStartView(p0, p1, p2, p3, !c.is360) }
/**
 * Fly to a specific viewport.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param toX0 The viewport X0 coordinate.
 * @param toY0 The viewport Y0 coordinate.
 * @param toX1 The viewport X1 coordinate.
 * @param toY1 The viewport Y1 coordinate.
 * @param dur The animation duration in ms, use `-1` for `auto`.
 * @param speed When duration `auto`, a speed modifier (default `1`).
 * @param perc Start the animation at a certain progress (`0-1`).
 * @param isJump Make the camera zoom out and in during this animation.
 * @param limit Limit the animation to the image's boundaries.
 * @param limitZoom Don't allow the animation to zoom in further than the maximum zoom.
 * @param toOmniIdx For rotatable omni objects, also animate to this frame.
 * @param noTrueNorth Internally apply local relative 360&deg; image rotation.
 * @param fn Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`.
 * @param time The current timestamp (`performance.now()`).
 * @returns The resulting animation duration in ms.
 */
export function _flyTo(c:Canvas, toX0: f64, toY0: f64, toX1: f64, toY1: f64, dur: f64, speed: f64,
	perc: f64, isJump: bool, limit: bool, limitZoom: bool, toOmniIdx: i32, noTrueNorth: bool, fn:i16, time: f64) : f64 {
	return c.camera.flyTo(toX0, toY0, toX1, toY1, dur, speed, perc, isJump, limit, limitZoom, toOmniIdx, noTrueNorth, fn, time) }
/**
 * Fly to a specific 360-degree area with smart longitude wrapping.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param centerX The target center X coordinate (0-1).
 * @param centerY The target center Y coordinate (0-1).
 * @param width The target area width (0-1).
 * @param height The target area height (0-1).
 * @param dur The animation duration in ms, use `-1` for `auto`.
 * @param speed When duration `auto`, a speed modifier (default `1`).
 * @param perc Start the animation at a certain progress (`0-1`).
 * @param isJump Make the camera zoom out and in during this animation.
 * @param limit Limit the animation to the image's boundaries.
 * @param limitZoom Don't allow the animation to zoom in further than the maximum zoom.
 * @param toOmniIdx For rotatable omni objects, also animate to this frame.
 * @param noTrueNorth Internally apply local relative 360&deg; image rotation.
 * @param fn Animation timing function: `0: ease`, `1: ease-in`, `2: ease-out`, `3: linear`.
 * @param time The current timestamp (`performance.now()`).
 * @returns The resulting animation duration in ms.
 */
export function _flyToView360(c:Canvas, centerX: f64, centerY: f64, width: f64, height: f64, dur: f64, speed: f64,
	perc: f64, isJump: bool, limit: bool, limitZoom: bool, toOmniIdx: i32, noTrueNorth: bool, fn:i16, time: f64) : f64 {
	return c.camera.flyTo(centerX, centerY, width, height, dur, speed, perc, isJump, limit, limitZoom, toOmniIdx, noTrueNorth, fn, time);
}
/**
 * A zoom in/out animation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param d The amount to zoom.
 * @param x Screen pixel X-coordinate as zoom focus.
 * @param y Screen pixel Y-coordinate as zoom focus.
 * @param p A forced duration in ms of the animation.
 * @param v A non-default camera speed modifier (default `1`).
 * @param l Can zoom outside of the image boundaries.
 * @param t The current timestamp (`performance.now()`).
 * @returns The resulting animation duration in ms.
 */
export function _zoom(c:Canvas, d:f64,x:f64,y:f64,p:f64,v:f64,l:bool,t:f64) : f64 {
	c.ani.stop(); c.kinetic.stop(); const s = c.el.scale;
	return c.is360 ? c.webgl.zoom(d/s,p,v,l,t) : c.camera.zoom(d,x/s,y/s,p,l,t) }
/**
 * User has started 2-finger pinch.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _pinchStart(c:Canvas) : void { c.camera.pinchStart() }
/**
 * User has made a pinch operation.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param a The first touch X coordinate in pixels.
 * @param b The first touch Y coordinate in pixels.
 * @param x The second touch X coordinate in pixels.
 * @param d The second touch Y coordinate in pixels.
 */
export function _pinch(c:Canvas, a:f64,b:f64,x:f64,d:f64) : void { c.camera.pinch(a,b,x,d) }
/**
 * User has stopped 2-finger pinch.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param time The current timestamp (`performance.now()`).
 */
export function _pinchStop(c:Canvas, time: f64) : void { c.camera.pinchStop(time) }
/**
 * Set the image's zoom to always cover the entire viewport.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param b Boolean value.
 */
export function _setCoverLimit(c:Canvas, b: bool) : void { c.coverLimit = b; c.camera.correctMinMax(); }
/**
 * Get the image's zoom to always cover the entire viewport.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Boolean value.
 */
export function _getCoverLimit(c:Canvas) : bool { return c.coverLimit; }
/**
 * Influence the image render order. Higher value means being on top of other images.
 * Used in grids.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param z The target z-index value.
 */
export function _setZIndex(c:Canvas, z:u8) : void { c.zIndex = z == 0 ? 0 : z+1 }
/**
 * Check whether an embedded image's area in the main canvas is current being animated.
 * Used in grids.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Boolean as int `0|1`.
 */
export function _areaAnimating(c:Canvas) : bool { return c.areaAnimating() }
/**
 * Get the current active embedded image's index. Used in grids.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @returns Sub-image index.
 */
export function _getActiveImageIdx(c:Canvas) : i32 { return c.activeImageIdx }
/**
 * Set an active image in a swipeable gallery, flying to its relative viewport
 * inside the containing canvas.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param x0 The viewport X0 coordinate.
 * @param y0 The viewport Y0 coordinate.
 * @param x1 The viewport X1 coordinate.
 * @param y1 The viewport Y1 coordinate.
 * @param noLimit Don't update the zoom limits.
 */
export function _setFocus(c:Canvas,x0:f64, y0:f64, x1:f64, y1:f64, noLimit:bool) : void {
	c.setFocus(x0, y0, x1, y1, noLimit) }
/**
 * Fade a main MicrioImage to a target opacity, including all of its sub-images.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param to The target opacity (`0-1`).
 * @param direct Don't animate, but immediately set this opacity.
 */
export function _fadeTo(c:Canvas, to: f64, direct: bool) : void {
	c.targetOpacity = to;
	if(direct) c.opacity = to;
}
/**
 * Fade a sub-image to a target opacity.
 * @param image The sub image memory pointer in shared Wasm memory.
 * @param target The target opacity (`0-1`).
 * @param direct Don't animate, but immediately set this opacity.
 */
export function _fadeImage(image: Image, target: f32, direct: bool) : void {
	if(direct) unchecked(image.opacity = target);
	unchecked(image.tOpacity = target);
}
/**
 * Set an active sub-image in a switch gallery or omni object, immediately switching
 * to that image.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param idx The sub-image index.
 * @param num Additional extra images to show next to it (ie. 2 images in single page spread).
 */
export function _setActiveImage(c:Canvas, idx:i32, num:i32) : void { c.setActiveImage(idx, num) }
/**
 * Set an active layer in a multi-layered omni object, immediately switching to that layer.
 * @param c The Canvas memory pointer in shared Wasm memory.
 * @param idx The omni object layer index.
 */
export function _setActiveLayer(c:Canvas, idx:i32) : void { c.setActiveLayer(idx) }
/**
 * Add an image embed.
 * @param _ The parent Canvas memory pointer in shared Wasm memory.
 * @param a The placement viewport X0 coordinate.
 * @param b The placement viewport Y0 coordinate.
 * @param c The placement viewport X1 coordinate.
 * @param d The placement viewport Y1 coordinate.
 * @param e The original image's width in pixels.
 * @param f The original image's height in pixels.
 * @param g The image's tile size in pixels.
 * @param j Use the original image always -- don't use tiles.
 * @param k The embed is a video.
 * @param l The starting opacity (`0-1`).
 * @param m For embeds in 360&deg; space, the X rotation.
 * @param n For embeds in 360&deg; space, the Y rotation.
 * @param o For embeds in 360&deg; space, the Z rotation.
 * @param p Relative scale of this embed.
 * @param s Only display when the user is zoomed over this threshold in the main image.
 * @returns The memory pointer to the Wasm `Image` object.
 */
export function _addImage(_:Canvas, a:f64,b:f64,c:f64,d:f64,e:f64,f:f64,
	g:u32, j: bool, k: bool, l:f64, m:f64, n:f64, o:f64, p:f64, s:f64) : Image {
	return _.addImage(a,b,c,d,e,f,g,j,k,l,m,n,o,p,s) }
/**
 * Add an independent image canvas object with its own camera, used in grids.
 * @param c The parent Canvas memory pointer in shared Wasm memory.
 * @param x0 The placement viewport X0 coordinate.
 * @param y0 The placement viewport Y0 coordinate.
 * @param x1 The placement viewport X1 coordinate.
 * @param y1 The placement viewport Y1 coordinate.
 * @param w The original image's width in pixels.
 * @param h The original image's height in pixels.
 * @returns The memory pointer to the Wasm `Canvas` object.
 */
export function _addChild(c:Canvas, x0:f32, y0: f32, x1: f32, y1: f32, w: f32, h: f32) : Canvas {
	return c.addChild(x0, y0, x1, y1, w, h) }
/**
 * Remove a main `MicrioImage` from the Main Wasm container.
 * @param c The Canvas memory pointer in shared Wasm memory.
 */
export function _remove(c:Canvas) : void { c.remove() }
