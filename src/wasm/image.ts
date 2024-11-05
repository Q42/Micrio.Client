import { DrawRect, PI } from './shared';
import { setTileOpacity } from './main';
import { atan2, twoNth } from './utils';
import { Vec4, Mat4 } from './webgl.mat';
import Canvas from './canvas';

export default class Image {
	private static readonly toDraw: u32[] = []

	readonly vec: Vec4 = new Vec4;
	readonly mat: Mat4 = new Mat4;

	rScale: f64 = 0;
	readonly layers: Layer[] = [];
	numLayers: u8 = 0;
	targetLayer: u8 = 0;

	public x0: f64 = 0;
	public y0: f64 = 0;
	public x1: f64 = 1;
	public y1: f64 = 1;
	rWidth: f64 = 1;
	rHeight: f64 = 1;

	gotBase: f32 = 0;

	/** @ts-ignore this is correct */
	readonly endOffset: u32;
	aspect: f32 = 0;

	doneTotal:u16 = 0;

	doRender:bool = false;

	private is360Embed:bool = false;

	public isVideoPlaying:bool = true;

	constructor(
		private readonly canvas: Canvas,
		readonly index: u32,
		readonly localIdx: u32,
		readonly width: f64,
		readonly height: f64,
		readonly tileSize: u32,
		readonly isSingle: bool,
		readonly isVideo: bool,
		readonly startOffset: u32,
		public opacity: f64,
		public tOpacity: f64,
		public rotX: f64,
		public rotY: f64,
		public rotZ: f64,
		readonly scale: f64,
		readonly fromScale : f64
	) {
		const maxi:u32 = <u32>(width > height ? width : height);
		this.is360Embed = this.canvas.is360 && this.localIdx > 0;
		this.numLayers = 2;
		for(let s=tileSize; s < maxi * canvas.main.underzoomLevels; s*=2) this.numLayers++;
		if(canvas.main.hasArchive || this.fromScale > 0) this.numLayers -= 3 - canvas.main.archiveLayerOffset;
		if(this.fromScale > 0) this.numLayers--;
		this.numLayers = max(1, this.numLayers);
		let o = startOffset, s:u32 = tileSize;
		for(let l : u8 = 0; l < this.numLayers; s*=2, l++) {
			const s2 = twoNth(l) * this.tileSize, c = <u32>ceil(width / s2), r = <u32>ceil(height / s2);
			this.layers.push(new Layer(this, <u8>this.layers.length, o, this.endOffset=o+=c*r, s,c,r));
		}
	}

	setArea(x0:f64, y0:f64, x1:f64, y1:f64) : void {
		this.x0 = x0;
		this.y0 = y0;
		this.x1 = x1;
		this.y1 = y1;
		this.rWidth = x1 + (x1 < x0 ? 1 : 0) - x0; this.rHeight = y1 - y0;
		this.aspect = <f32>this.width / <f32>this.height;
		this.rScale = this.aspect > this.canvas.aspect ?
			this.canvas.width / this.width * this.rWidth : this.canvas.height / this.height * this.rHeight;
	}

	private outsideView() : bool {
		const v = this.canvas.view;
		if(this.is360Embed) {
			const cW = this.canvas.el.width, cH = this.canvas.el.height;
			let mx0 = this.x0, mx1 = this.x1;
			if(mx0 < 0) { mx0++; }
			if(mx0 > mx1) if(v.centerX < .5 && v.x1 <= 1) mx0--; else mx1++;
			let lx0 = min(v.x0, this.canvas.webgl.getCoo(0, cH / 2).x),
				lx1 = max(v.x1, this.canvas.webgl.getCoo(cW, cH / 2).x);
			if(lx1 > 1) { lx0--; lx1--; }
			const outside = mx0>lx1||mx1<lx0||this.y0>v.y1||this.y1<v.y0;
			return outside;
		}
		else return this.x1 <= v.x0 || this.x0 >= v.x1 || this.y1 <= v.y0 || this.y0 >= v.y1;
	}

	shouldRender() : bool {
		if(this.fromScale > 0 && this.fromScale > this.canvas.camera.scale) return false;
		if((this.isVideo || this.localIdx > 0) && this.opacity == 0 && this.tOpacity == 0) return false;
		if(this.index == this.canvas.activeImageIdx || (this.canvas.is360 && this.index == 0)) return true;
		return !this.outsideView();
	}

	opacityTick(direct:bool) : bool {
		const tOp = this.tOpacity;
		if(this.opacity == tOp) return false;
		const delta = 1 / (this.canvas.main.frameTime * this.canvas.main.embedFadeDuration);
		this.opacity = min(1, max(0, !direct ? tOp > this.opacity
				? min(tOp, this.opacity + delta) : max(tOp, this.opacity - delta) : tOp));
		return this.opacity >= 0;
	}

	getTiles(scale:f64) : u16 {
		if(this.opacity <= 0) return 0; this.doneTotal = 0;
		if(this.is360Embed) { if(!(this.doRender=((scale=this.getEmbeddedScale(scale))>0))) return 0; }
		else scale *= this.rScale;
		if(this.gotBase == 0) { Image.toDraw.push(this.endOffset - 1); setTileOpacity(this.endOffset-1, true, 1); }
		else if(this.is360Embed) { Image.toDraw.push(this.endOffset - 1); this.doneTotal++; }
		const lIdx:u8=this.getTargetLayer(scale),c=this.canvas,v=c.view;if(this.localIdx==0&&c.is360) {
			const l=unchecked(this.layers[lIdx]), m=c.webgl.getCoo(c.el.width/2, c.el.height/2); m.x -= c.webgl.offX;
			this.getColumn(l, 0, <i32>floor(m.x/l.tileWidth), <i32>floor(m.y/l.tileHeight));
		} else {
			if(c.is360) this.getTilesRect(lIdx,v.x0,v.y0,v.x1,v.y1);
			else if(c.visible.x0 < c.visible.x1 && c.visible.y0 < c.visible.y1) this.getTilesRect(lIdx,
				max(c.visible.x0,v.x0),max(c.visible.y0,v.y0),min(c.visible.x1,v.x1),min(c.visible.y1,v.y1));
			// The ugliest hack in the universe
			if(this.is360Embed) this.doneTotal++;
		}
		Image.toDraw.sort((a, b) => a>b?-1:a<b?1:0); while(Image.toDraw.length)
			c.toDraw.push(Image.toDraw.shift()); Image.toDraw.length = 0;
		return this.doneTotal;
	}

	private getTargetLayer(scale: f64) : u8 {
		let l:u8=this.isSingle || this.canvas.limited ? this.numLayers : 1 + this.canvas.main.skipBaseLevels;
		if(!this.isSingle && !this.canvas.limited) for(;l<this.numLayers;l++) if(twoNth(l) * scale >= 1) break;
		return (this.targetLayer = l) - 1;
	}

	private getTilesRect(layerIdx:u8, x0:f64, y0:f64, x1:f64, y1:f64) : void {
		if(this.outsideView()) return;
		const layer = unchecked(this.layers[layerIdx]), tW=layer.tileWidth, tH=layer.tileHeight,
			rW=this.rWidth, rH=this.rHeight;
		const r:u32=<u32>min(layer.cols-1,<u32>floor(max(0, x1-this.x0)/rW/tW)),
			b:u32=<u32>floor(max(0,y1-this.y0)/rH/tH),
			l:u32=<u32>floor(max(0,x0-this.x0)/rW/tW);
		let y:u32=<u32>floor(max(0,y0-this.y0)/rH/tH);
		for(;y<=b;y++) for(let x:u32=l;x<=r;x++) this.setToDraw(layer, x, y);
	}

	private setToDraw(l:Layer, x:u32, y:u32): void {
		const idx:u32 = min(this.endOffset-1, l.start + (y * l.cols) + x);
		if(Image.toDraw.indexOf(idx) >= 0) return; Image.toDraw.push(idx);
		if(setTileOpacity(idx, idx == this.endOffset - 1, this.canvas.opacity) >= 1) this.doneTotal++;
		else if(!this.isSingle && !this.canvas.limited && l.index < this.numLayers - 1) {
			const r=l.getTileRect(idx,this.canvas.rect);
			this.getTilesRect(l.index+1, r.x0, r.y0, r.x1, r.y1);
		}
	}

	private getColumn(l:Layer,dX:i32, cX:i32, cY:i32) : void {
		let tX = (cX + dX)%l.cols; if(tX < 0) tX+=l.cols;
		const wasDrawn = Image.toDraw.length, c = <i32>ceil(l.cols / 2);
		if(dX == 0) this.setToDraw(l, tX, cY); else this.inScreen(l, tX, cY);
		for(let y=cY-1;y>=0;y--) if(!this.inScreen(l, tX, y)) break;
		for(let y=cY+1;y<l.rows;y++) if(!this.inScreen(l, tX, y)) break;
		if(Image.toDraw.length != wasDrawn) {
			if(dX <= 0 && dX >= -c) this.getColumn(l, dX-1, cX, cY);
			if(dX >= 0 && dX <= c) this.getColumn(l, dX+1, cX, cY);
		}
	}

	private inScreen(l:Layer, x:i32, y:i32) : bool {
		const c = this.canvas, el = c.el, m = el.width * 0.05;
		for(let dY:f64=0;dY<=1;dY+=0.05) for(let dX:f64=0;dX<=1;dX+=0.25) {
			const px = c.webgl.getXYZ(min(1,(x+dX)*l.tileWidth),min(1,(y+dY)*l.tileHeight));
			if(!(px.x<-m||px.x>el.width+m||px.y<-m||px.y>el.height+m)) {
				this.setToDraw(l, x, y); return true; } } return false;
	}

	// Flat rects embedded into 360 image, with relative rotation support
	setDrawRect(r: DrawRect) : void {
		const v = this.canvas.main.vertexBuffer;
		const d = this.canvas.webgl.radius;
		const s:f64 = PI * 2 * d, p = this.vec, m = this.mat;
		const cX:f64 = this.x0 + this.rWidth/2, cY:f64 = this.y0 + this.rHeight/2;
		const center = this.canvas.webgl.getVec3(cX-(.5 - this.canvas.trueNorth), cY, true, 5);

		m.identity();
		m.translate(center.x, center.y, center.z);
		m.rotateY(atan2(center.x,center.z) + PI + this.rotY);
		m.rotateX(-Math.sin((cY-.5)*PI) - this.rotX);
		m.rotateZ(-this.rotZ);

		m.scale(this.scale*.5);

		// left, top
		let x = (r.x0-cX)*s, y = -(r.y0-cY)*.5*s;
		p.x=0;p.y=0;p.z=0; m.translate(x, y, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[0]=<f32>p.x);unchecked(v[1]=<f32>p.y);unchecked(v[2]=<f32>p.z);

		// left, bottom
		p.x=0;p.y=0;p.z=0; m.translate(x=(r.x0-cX)*s, y=-(r.y1-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[3]=v[9]=<f32>p.x);unchecked(v[4]=v[10]=<f32>p.y);unchecked(v[5]=v[11]=<f32>p.z);

		// right, top
		p.x=0;p.y=0;p.z=0; m.translate(x=(r.x1-cX)*s, y=-(r.y0-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[6]=v[15]=<f32>p.x);unchecked(v[7]=v[16]=<f32>p.y);unchecked(v[8]=v[17]=<f32>p.z);

		// right, bottom
		p.x=0;p.y=0;p.z=0; m.translate(x=(r.x1-cX)*s, y=-(r.y1-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[12]=<f32>p.x);unchecked(v[13]=<f32>p.y);unchecked(v[14]=<f32>p.z);
	}

	private getEmbeddedScale(s:f64) : f64 {
		if(this.is360Embed) return s * max(this.rWidth * 2, this.rHeight) * (this.canvas.width / this.width);
		const h = this.rHeight, cY = this.y0+h/2, pH = h/2.5;
		const el = this.canvas.el, gl = this.canvas.webgl, cW = this.canvas.el.width;
		let px = gl.getXYZ(this.x0, cY-pH), lX=px.w > 0 || px.x < 0 ? 0 : min(cW, px.x);
		let b:u8 = 0; if(px.inView(el)) b++; if(gl.getXYZ(this.x1, cY-pH).inView(el)) b++;
		const wT = ((px.w > 0 || px.x > cW ? cW : max(0, px.x))-lX);
		if(gl.getXYZ(this.x0, cY+pH).inView(el)) b++; lX=px.w > 0 || px.x < 0 ? 0 : min(cW, px.x);
		if(gl.getXYZ(this.x1, cY+pH).inView(el)) b++;
		return b == 0 ? 0 : min(1, max((px.w > 0 || px.x > cW ? cW : max(0, px.x))-lX, wT) / this.width);
	}

}


class Layer {
	readonly tileWidth:f64;
	readonly tileHeight:f64;

	constructor(
		readonly image: Image,
		readonly index: u8,
		readonly start: u32,
		readonly end: u32,
		readonly tileSize: u32,
		readonly cols: i32,
		readonly rows: i32
	) {
		this.tileWidth = tileSize / image.width;
		this.tileHeight = tileSize / image.height;
	}

	getTileRect(idx:u32, r:DrawRect) : DrawRect {
		// Calculate X, Y
		const localIdx = idx - this.start;
		const x = localIdx % this.cols;
		const y = floor(localIdx / this.cols);
		const i = this.image;

		r.x0 = i.x0 + ((x * this.tileSize) / i.width) * i.rWidth;
		r.y0 = i.y0 + ((y * this.tileSize) / i.height) * i.rHeight;
		r.x1 = i.x0 + min((x + 1) * this.tileSize / i.width, 1) * i.rWidth;
		r.y1 = i.y0 + min((y + 1) * this.tileSize / i.height, 1) * i.rHeight;

		r.image = i;
		r.layer = this.index;
		r.x = x;
		r.y = y;

		return r;
	}
}
