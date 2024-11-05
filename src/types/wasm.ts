/** @internal */
export interface MicrioWasmExports extends WebAssembly.Exports {
	segsX: { value: number };
	segsY: { value: number };
	ease(p:number): number;

	// Main Wasm controller
	constructor() : number;
	getVertexBuffer(ptr:number) : number;
	getVertexBuffer360(ptr:number) : number;
	shouldDraw(ptr:number, now:number) : number;
	draw(ptr:number) : void;
	reset(ptr:number) : void;
	aniStop(ptr:number) : void;
	resize(ptr:number, w: number, h: number, l: number, t: number, r: number, s: number, p: boolean) : void;
	setPosition(ptr:number, _l: number, _t: number) : void;
	setArea(ptr:number, _w: number, _h: number) : void;
	setBareBone(ptr:number, v: boolean) : void;
	set360Orientation(ptr:number, distance: number, dirX: number, dirY: number) : void;
	setGridTransitionDuration(ptr:number, n: number) : void;
	setGridTransitionTimingFunction(ptr:number, n:number) : void;
	setCrossfadeDuration(ptr:number, n: number) : void;
	setEmbedFadeDuration(ptr:number, n: number) : void;
	setDragElasticity(ptr:number, n: number) : void;
	setNoPinchPan(ptr:number, v: boolean) : void;
	setSkipBaseLevels(ptr:number, n: number) : void;
	setIsSwipe(ptr:number, v: boolean) : void;
	setHasArchive(ptr:number, v: boolean, n:number) : void;
	setNoUnderzoom(ptr:number, v:boolean) : void;
	getNumTiles(ptr:number) : number;

	// Canvas Wasm instance
	_constructor(mainPtr:number, width: number, height: number, tileSize: number, is360: boolean,
		noImage: boolean, isSingle: boolean, targetOpacity: number,
		freeMove: boolean, coverLimit: boolean, coverStart: boolean, maxScale: number, camSpeed: number,
		trueNorth: number, isGallerySwitch: boolean, pagesHaveBackground: boolean,
		isOmni: boolean, pinchZoomOutLimit: boolean, numLayers: number) : number;
	_getView(ptr:number) : number;
	_getCoo(ptr:number, x: number, y: number, abs?: boolean, noLimit?: boolean) : number;
	_getQuad(ptr:number, cX: number, cY: number, w: number, h: number,scaleX: number, scaleY: number, rotX?:number,rotY?:number,rotZ?:number) : number;
	_getXY(ptr:number, x: number, y: number, abs?: boolean, radius?:number, rotation?:number) : number;
	_getMatrix(ptr:number, x?:number,y?:number,s?:number,r?:number,rX?:number,rY?:number, rZ?:number,t?:number,sX?:number,sY?:number) : number;
	_getOmniXY(ptr:number, x: number, y: number, z: number) : number;
	_setArea(ptr:number, x0:number,y0:number,x1:number,y1:number,direct:boolean,noDispatch:boolean) : void;
	_setImageArea(imgPtr:number, x0:number,y0:number,x1:number,y1:number) : void;
	_setImageRotation(imgPtr:number, rotX:number,rotY:number,rotZ:number) : void;
	_setImageVideoPlaying(imgPtr:number, p:boolean) : void;
	_sendViewport(ptr:number) : void;
	_getPMatrix(ptr:number) : number;
	_setOmniSettings(ptr:number, distance:number, fieldOfView:number, verticalAngle:number, offsetX:number) : void;
	_setDirection(ptr:number, yaw: number, pitch?: number, resetPersp?: boolean) : void;
	_setView(ptr:number, x0: number, y0: number, x1: number, y1: number, noLimit?: boolean, noLastView?: boolean, correctNorth?: boolean) : void;
	_setCoo(ptr:number, x:number,y:number,s?:number,d?:number,v?:number,l?:boolean,fn?:number,n?:number) : number;
	_setLimited(ptr:number, b:boolean) : void;
	_getYaw(ptr:number) : number;
	_getPitch(ptr:number) : number;
	_getTargetOpacity(ptr: number) : number;
	_fadeIn(ptr: number) : void;
	_fadeOut(ptr: number) : void;
	_isZoomedIn(ptr:number) : number;
	_isZoomedOut(ptr:number, b:boolean) : number;
	_getMinScale(ptr:number) : number;
	_setMinScale(ptr:number, v:number) : void;
	_setMinSize(ptr:number, v:number) : void;
	_getCoverScale(ptr:number) : number;
	_getScale(ptr:number) : number;
	_setLimit(ptr:number, x0: number, y0: number, x1: number, y1: number) : void;
	_set360RangeLimit(ptr:number, x:number, y:number) : void;
	_aniPause(ptr:number, t:number) : void;
	_aniResume(ptr:number, t:number) : void;
	_aniStop(ptr:number) : void;
	_isKinetic(ptr:number) : boolean;
	_panStart(ptr:number) : void;
	_pan(ptr:number, a:number,b:number,c:number,l:boolean, d:number) : void;
	_panStop(ptr:number) : void;
	_setStartView(ptr: number, x0:number, y0:number, x1:number, y1:number) : void;
	_flyTo(ptr:number, toX0: number, toY0: number, toX1: number, toY1: number, dur: number, speed: number,
		perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, noTrueNorth: boolean, fn:number, time: number) : number;
	_zoom(ptr:number, d:number,x:number,y:number,p:number,v:number,l:boolean,t:number) : number;
	_pinchStart(ptr: number) : void;
	_pinch(ptr: number, a:number, b:number, c:number, d:number) : void;
	_pinchStop(ptr:number, t:number) : void;
	_setCoverLimit(ptr:number, b:boolean) : void;
	_getCoverLimit(ptr:number) : number;
	_setZIndex(ptr:number, z:number) : void;
	_areaAnimating(ptr:number) : number;
	_getActiveImageIdx(ptr:number) : number;
	_setFocus(ptr:number, x0:number, y0:number, x1:number, y1:number, noLimit:boolean) : void;
	_fadeTo(ptr:number, o:number, p:boolean) : void;
	_fadeImage(imgPtr:number, o:number, p:boolean) : void;
	_setActiveImage(ptr:number, idx:number, num: number) : void;
	_setActiveLayer(ptr:number, idx:number) : void;
	_addImage(ptr:number, x0:number,y0:number,x1:number,y1:number,w:number,h:number,
		tileSize:number, isSingle: boolean, isVideo: boolean,
		opa:number, rotX:number, rotY:number, rotZ:number, scale:number, fromScale:number) : number;
	_addChild(ptr:number, x0:number, y0: number, x1: number, y1: number, w: number, h: number) : number;
	_remove(ptr:number) : void;
}
