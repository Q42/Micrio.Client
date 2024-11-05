import { Viewport } from './shared';
import { segsX, segsY } from './globals';
import Canvas from './canvas';
import Image from './image';
import { easeInOut, Bicubic } from './utils'

export declare function aniDone(c:Canvas) : void;
export declare function aniAbort(c:Canvas) : void;
//(layer, x, y, opacity, start, length, animating, zoomingOut)
export declare function drawTile(imgIdx:u32, idx:u32, layer:u32, x:u32, y:u32, opacity:f64, animating:bool, isTargetLayer:bool) : bool;
export declare function drawQuad(opacity:f64) : bool;
export declare function getTileOpacity(idx:u32) : f32;
export declare function setTileOpacity(idx:u32, direct: bool, imageOpacity: f64) : f32;
export declare function setMatrix(arr:Float32Array) : void;
export declare function setViewport(x:number,y:number,width:number,height:number) : void;
export declare function viewSet(c:Canvas) : void;
export declare function viewportSet(c:Canvas,x:number,y:number,w:number,h:number) : void;
export declare function setVisible(c:Canvas,visible:bool) : void;
export declare function setVisible2(c:Image,visible:bool) : void;

// Debugging functions
export declare namespace console {
	export function log(a: f64) : void;
	export function log2(a: f64, b:f64) : void;
	export function log3(a: f64, b:f64, c:f64) : void;
	export function log4(a: f64, b:f64, c:f64, d:f64) : void;
}

export class Main {
	readonly el : Viewport = new Viewport;

	// [Single quad xyz coords]
	readonly vertexBuffer : Float32Array = new Float32Array(6 * 3);
	readonly vertexBuffer360 : Float32Array = new Float32Array(6 * 3 * segsX * segsY);

	// Images
	readonly canvases : Canvas[] = [];

	// Exports to JS
	numTiles : u32 = 0;
	numImages : u32 = 0;

	// Global vars per frame
	now : f32 = 0;
	animating : bool = false;
	progress : f64 = 0;
	toDrawTotal : f32 = 0;
	doneTotal : f32 = 0;

	// Default crossfade duration between canvases
	crossfadeDuration: f64 = .25;
	gridTransitionDuration:f64 = .5;
	gridTransitionTimingFunction:Bicubic = easeInOut;
	spacesTransitionDuration:f64 = .5;
	embedFadeDuration:f64 = .5;

	// Global nav variables
	dragElasticity: f64 = 1;

	// Has .mdp archive
	hasArchive: bool = false;
	archiveLayerOffset : u8 = 0;

	// Viewed image is <=3.1 and doesn't have underzoom tiles
	underzoomLevels : u8 = 4;

	// Ignore deepest scale levels
	skipBaseLevels : i8 = 0;

	// Barebone texture downloads
	bareBone: bool = false;

	// Is swipe image sequence: all same resolution
	isSwipe: bool = false;

	// Don't pan when using 2-finger pinch
	noPinchPan: bool = false;

	// Spaces 360 vars
	direction : f64 = 0;
	distanceX : f64 = 0;
	distanceY : f64 = 0;

	// Frame rate normalization
	frameTime: f64 = 1/60;

	// Return if new frame should be requested
	shouldDraw(now: f32) : bool {
		this.frameTime = 1000 / min(33, now - this.now); // Min fps is 30
		this.now = now;
		this.doneTotal = 0;
		this.toDrawTotal = 0;
		this.animating = false;
		this.canvases.forEach(c => { c.shouldDraw() });
		return this.animating || this.progress < 1;
	}
	draw() : void { this.canvases.forEach(c => { c.draw() }); }
	reset() : void { this.canvases.forEach(c => { c.reset() }); }
	aniStop() : void { this.canvases.forEach(c => { c.aniStop() }); }

	resize(w: u16, h: u16, l: i32, t: i32, r: f64, s: f64, p: bool) : void {
		this.el.set(w, h, l, t, r, s, p);
		this.canvases.forEach(c => { c.resize() });
	}
	setPosition(_l: i32, _t: i32) : void { this.el.left = _l; this.el.top = _t; }
	setArea(_w: i32, _h: i32) : void { this.el.areaWidth = _w; this.el.areaHeight = _h; }

	remove(c:Canvas) : void {
		for(let i=0;i<this.canvases.length;i++) if(unchecked(this.canvases[i] == c)) {
			this.canvases.splice(i, 1);
			return;
		}
	}
}
