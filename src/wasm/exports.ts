
import { segsX as _sX, segsY as _sY} from './globals';
import { Main } from './main';
import { easeInOut, easeIn, easeOut, linear } from './utils';
import Canvas from './canvas';
import Image from './image';

export const segsX:u32 = _sX;
export const segsY:u32 = _sY;

export function ease(p:f64) : f64 { return easeInOut.get(p) }

export function constructor() : Main { return new Main(); }
export function getVertexBuffer(m:Main) : Float32Array { return m.vertexBuffer; }
export function getVertexBuffer360(m:Main) : Float32Array { return m.vertexBuffer360; }
export function setArea(m:Main, _w: i32, _h: i32) : void { m.el.areaWidth = _w; m.el.areaHeight = _h; }
export function setBareBone(m:Main, v:bool) : void { m.bareBone = v; }
export function set360Orientation(m:Main, d:f64, dX:f64, dY:f64) : void {
	m.direction = d; m.distanceX = dX; m.distanceY = dY; }
export function setGridTransitionDuration(m:Main, n:f64) : void { m.gridTransitionDuration = n; }
export function setGridTransitionTimingFunction(m:Main, fn:u16) : void { m.gridTransitionTimingFunction = fn == 3 ? linear : fn == 2 ? easeOut : fn == 1 ? easeIn : easeInOut; }
export function setCrossfadeDuration(m:Main, n:f64) : void { m.crossfadeDuration = n; }
export function setEmbedFadeDuration(m:Main, n:f64) : void { m.embedFadeDuration = n; }
export function setDragElasticity(m:Main, n:f64) : void { m.dragElasticity = n; }
export function setSkipBaseLevels(m:Main, n:i8) : void { m.skipBaseLevels = n; }
export function setNoPinchPan(m:Main, b:bool) : void { m.noPinchPan = b; }
export function setIsSwipe(m:Main, b:bool) : void { m.isSwipe = b; }
export function setHasArchive(m:Main, b:bool, o:u8) : void { m.hasArchive = b; m.archiveLayerOffset = o; }
export function setNoUnderzoom(m:Main, b:bool) : void { m.underzoomLevels = b ? 1 : 4; }
export function getNumTiles(m:Main) : u32 { return m.numTiles }
export function shouldDraw(m:Main, now: f32) : bool { return m.shouldDraw(now); }
export function draw(m:Main) : void { m.draw(); }
export function reset(m:Main) : void { m.reset(); }
export function aniStop(m:Main) : void { m.aniStop(); }
export function resize(m:Main, w: u16, h: u16, l: i32, t: i32, r: f64, s: f64, p: bool) : void {
	m.resize(w, h, l, t, r, s, p);
}

export function _constructor(a: Main, b: f64, c: f64, d: u32, f: bool, h: bool,
	i: bool, j: f64, k: bool, l: bool, m: bool, n: f64, o: f64, p: f64, q: bool, r: bool,
	s: bool, t: bool, u:i32) : Canvas {
	return new Canvas(a,b,c,d,f,h,i,j,k,l,m,n,o,p,q,r,s,t,u,false);
}
export function _getView(c:Canvas) : Float64Array { return c.getView() };
export function _getCoo(c:Canvas, x: f64, y: f64, abs: bool, noLimit: bool) : Float64Array {
	return c.getCoo(x, y, abs, noLimit) };
export function _getXY(c:Canvas, x: f64, y: f64, abs: bool, radius:f64, rotation:f64) : Float64Array {
	return c.getXY(x, y, abs, radius, rotation) };
export function _getMatrix(c:Canvas, x:f64,y:f64,s:f64,r:f64,rX:f64,rY:f64, rZ:f64,t:f64,sX:f64,sY:f64) : Float32Array {
	return c.getMatrix(x,y,s,r,rX,rY,rZ,t,sX,sY) };
export function _getOmniXY(c:Canvas, x: f64, y: f64, z:f64) : Float64Array {
	return c.camera.getXYOmniCoo(x, y, z, 0, false).toArray() };
export function _setArea(c:Canvas, x0:f64,y0:f64,x1:f64,y1:f64,direct:bool,noDispatch:bool) : void {
	c.setArea(x0, y0, x1, y1, direct, noDispatch) }
export function _setImageArea(i:Image, x0:f64,y0:f64,x1:f64,y1:f64) : void {
	i.setArea(x0, y0, x1, y1) }
export function _setImageRotation(i:Image, rotX:f64, rotY:f64, rotZ:f64) : void {
	i.rotX = rotX; i.rotY = rotY; i.rotZ = rotZ }
export function _setImageVideoPlaying(i:Image, p:bool) : void { i.isVideoPlaying = p }
export function _sendViewport(c:Canvas) : void { c.sendViewport() }
export function _getPMatrix(c:Canvas) : Float32Array { return c.webgl.pMatrix.arr }
export function _getYaw(c:Canvas) : f64 { return c.webgl.yaw + c.webgl.baseYaw }
export function _getPitch(c:Canvas) : f64 { return c.webgl.pitch }
export function _setOmniSettings(c:Canvas, d:f64, fov:f64, vA:f64, oX:f64) : void {
	c.omniDistance = d; c.omniFieldOfView = fov; c.omniVerticalAngle = vA; c.omniOffsetX = oX; }
export function _setDirection(c:Canvas, yaw: f64, pitch: f64, resetPersp: bool) : void {
	c.setDirection(yaw, pitch, resetPersp) }
export function _setView(c:Canvas, x0: f64, y0: f64, x1: f64, y1: f64, noLimit: bool, noLastView: bool, correctNorth: bool) : void {
	c.setView(x0, y0, x1, y1, noLimit, noLastView, correctNorth) }
export function _setCoo(c:Canvas, x:f64,y:f64,s:f64,d:f64,v:f64,l:bool,fn:i16,n:f64): f64 {
	return c.camera.setCoo(x,y,s,d,v,l,fn,n); }
export function _setLimited(c:Canvas, b:bool) : void { c.limited = b }
export function _getTargetOpacity(c:Canvas) : f64 { return c.targetOpacity }
export function _fadeIn(c:Canvas) : void { c.fadeIn() }
export function _fadeOut(c:Canvas) : void { c.fadeOut() }
export function _isZoomedIn(c:Canvas) : bool { return c.isZoomedIn() }
export function _isZoomedOut(c:Canvas, b:bool) : bool { return c.isZoomedOut(b) }
export function _getMinScale(c:Canvas) : f64 { return c.camera.minScale }
export function _setMinScale(c:Canvas, s:f64) : void { c.camera.minScale = s; }
export function _setMinSize(c:Canvas, s:f64) : void { c.camera.minSize = s; }
export function _getCoverScale(c:Canvas) : f64 { return c.camera.coverScale }
export function _getScale(c:Canvas) : f64 { return c.getScale() }
export function _setLimit(c:Canvas, x0: f64, y0: f64, x1: f64, y1: f64) : void {
	if(c.view.lX0 == x0 && c.view.lX1 == x1 && c.view.lY0 == y0 && c.view.lY1 == y1) return;
	c.view.setLimit(x0, y0, x1, y1);
	c.camera.setCanvas();
	c.camera.pan(0,0,0,false,0,true);
}
export function _set360RangeLimit(c:Canvas, x:f64, y:f64) : void {
	if(c.is360) c.webgl.setLimits(x, y) }
export function _aniPause(c:Canvas, t:f64) : void { c.aniPause(t) }
export function _aniResume(c:Canvas, t:f64) : void { c.aniResume(t) }
export function _aniStop(c:Canvas) : void { c.kinetic.stop(); c.aniStop() }
export function _isKinetic(c:Canvas) : bool { return c.kinetic.started }
export function _panStart(c:Canvas) : void {
	c.kinetic.stop(); if(c.is360 || (c.camera.scale >= c.camera.minScale)) c.ani.stop() }
export function _pan(c:Canvas, a:f64,b:f64,x:f64,l:bool,d:f64) : void {
	if(c.is360) c.webgl.rotate(a,b,x,d); else c.camera.pan(a,b,x,l,d) }
export function _panStop(c:Canvas) : void {
	if(c.is360 || (c.camera.scale >= c.camera.minScale)) c.ani.stop(); c.kinetic.start() }
export function _setStartView(c:Canvas, p0:f64, p1:f64, p2:f64, p3:f64) : void {
	c.ani.setStartView(p0, p1, p2, p3, !c.is360) }
export function _flyTo(c:Canvas, toX0: f64, toY0: f64, toX1: f64, toY1: f64, dur: f64, speed: f64,
	perc: f64, isJump: bool, limit: bool, limitZoom: bool, toOmniIdx: i32, noTrueNorth: bool, fn:i16, time: f64) : f64 {
	return c.camera.flyTo(toX0, toY0, toX1, toY1, dur, speed, perc, isJump, limit, limitZoom, toOmniIdx, noTrueNorth, fn, time) }
export function _zoom(c:Canvas, d:f64,x:f64,y:f64,p:f64,v:f64,l:bool,t:f64) : f64 {
	c.ani.stop(); c.kinetic.stop(); const s = c.el.scale;
	return c.is360 ? c.webgl.zoom(d/s,p,v,l,t) : c.camera.zoom(d,x/s,y/s,p,l,t) }
export function _pinchStart(c:Canvas) : void { c.camera.pinchStart() }
export function _pinch(c:Canvas, a:f64,b:f64,x:f64,d:f64) : void { c.camera.pinch(a,b,x,d) }
export function _pinchStop(c:Canvas, time: f64) : void { c.camera.pinchStop(time) }
export function _setCoverLimit(c:Canvas, b: bool) : void { c.coverLimit = b; c.camera.correctMinMax(); }
export function _getCoverLimit(c:Canvas) : bool { return c.coverLimit; }
export function _setZIndex(c:Canvas, z:u8) : void { c.zIndex = z == 0 ? 0 : z+1 }
export function _areaAnimating(c:Canvas) : bool { return c.areaAnimating() }
export function _getActiveImageIdx(c:Canvas) : i32 { return c.activeImageIdx }
export function _setFocus(c:Canvas,x0:f64, y0:f64, x1:f64, y1:f64, noLimit:bool) : void {
	c.setFocus(x0, y0, x1, y1, noLimit) }
export function _fadeTo(c:Canvas, to: f64, direct: bool) : void {
	c.targetOpacity = to;
	if(direct) c.opacity = to;
}
export function _fadeImage(image: Image, target: f32, direct: bool) : void {
	if(direct) unchecked(image.opacity = target);
	unchecked(image.tOpacity = target);
}
export function _setActiveImage(c:Canvas, idx:i32, num:i32) : void { c.setActiveImage(idx, num) }
export function _setActiveLayer(c:Canvas, idx:i32) : void { c.setActiveLayer(idx) }
export function _addImage(_:Canvas, a:f64,b:f64,c:f64,d:f64,e:f64,f:f64,
	g:u32, j: bool, k: bool, l:f64, m:f64, n:f64, o:f64, p:f64, s:f64) : Image {
	return _.addImage(a,b,c,d,e,f,g,j,k,l,m,n,o,p,s) }
export function _addChild(c:Canvas, x0:f32, y0: f32, x1: f32, y1: f32, w: f32, h: f32) : Canvas {
	return c.addChild(x0, y0, x1, y1, w, h) }
export function _remove(c:Canvas) : void { c.remove() }
