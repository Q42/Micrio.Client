import { DrawRect, PI } from './shared';
import { setTileOpacity } from './main';
import { atan2, twoNth } from './utils';
import { Vec4, Mat4 } from './webgl.mat';
import Canvas from './canvas';

/** Represents a single image source (tiled or single) within a Canvas. */
export default class Image {
	/** Static array to temporarily store tile indices to draw in the current frame for this image. */
	private static readonly toDraw: u32[] = []

	/** Reusable vector for 3D calculations (e.g., embed positioning). */
	readonly vec: Vec4 = new Vec4;
	/** Reusable matrix for 3D calculations. */
	readonly mat: Mat4 = new Mat4;

	/** Relative scale factor based on aspect ratios (used for non-360 tile calculations). */
	rScale: f64 = 0;
	/** Array of resolution layers for this image. */
	readonly layers: Layer[] = [];
	/** Total number of resolution layers. */
	numLayers: u8 = 0;
	/** Index of the target resolution layer for the current view scale. */
	targetLayer: u8 = 0;

	// --- Area within the parent Canvas (for embeds) ---
	/** Relative X0 coordinate within the parent canvas (0-1). */
	public x0: f64 = 0;
	/** Relative Y0 coordinate within the parent canvas (0-1). */
	public y0: f64 = 0;
	/** Relative X1 coordinate within the parent canvas (0-1). */
	public x1: f64 = 1;
	/** Relative Y1 coordinate within the parent canvas (0-1). */
	public y1: f64 = 1;
	/** Calculated relative width within the parent canvas. */
	rWidth: f64 = 1;
	/** Calculated relative height within the parent canvas. */
	rHeight: f64 = 1;

	/** Timestamp when the base layer (lowest resolution) was first successfully drawn. 0 if not yet drawn. */
	gotBase: f32 = 0;

	/** Global tile index offset for the end of this image's tiles. */
	/** @ts-ignore this is correct */
	readonly endOffset: u32;
	/** Aspect ratio of this image source (width / height). */
	aspect: f32 = 0;

	/** Number of tiles from this image successfully drawn in the last frame (used for progress calculation). */
	doneTotal:u16 = 0;

	/** Flag indicating if this image should be rendered (set by JS, e.g., for video embeds). */
	doRender:bool = false;

	/** Flag indicating if this image is an embed within a 360 canvas. */
	private is360Embed:bool = false;

	/** Flag indicating if this image is a video embed and currently playing (controlled by JS). */
	public isVideoPlaying:bool = true;

	constructor(
		private readonly canvas: Canvas, // Reference to the parent Canvas
		readonly index: u32,        // Global index of this image across all canvases
		readonly localIdx: u32,     // Index of this image within its parent canvas's `images` array
		readonly width: f64,        // Original width of the image source in pixels
		readonly height: f64,       // Original height of the image source in pixels
		readonly tileSize: u32,     // Tile size in pixels (e.g., 1024)
		readonly isSingle: bool,    // Is this a single image source (not tiled)?
		readonly isVideo: bool,     // Is this image source a video?
		readonly startOffset: u32,  // Global tile index offset for the start of this image's tiles
		public opacity: f64,        // Current opacity (animated)
		public tOpacity: f64,       // Target opacity (for fading)
		public rotX: f64,           // 3D Rotation X (for 360 embeds)
		public rotY: f64,           // 3D Rotation Y
		public rotZ: f64,           // 3D Rotation Z
		readonly scale: f64,        // Relative scale factor (for 360 embeds)
		readonly fromScale : f64    // Minimum parent canvas scale required to render this image
	) {
		// Determine maximum dimension for layer calculation
		const maxi:u32 = <u32>(width > height ? width : height);
		// Check if this is an embed within a 360 canvas
		this.is360Embed = this.canvas.is360 && this.localIdx > 0;

		// --- Calculate Number of Layers ---
		// Start with 2 base layers (often 0 and 1)
		this.numLayers = 2;
		// Add layers until tile size reaches max dimension * underzoom factor
		for(let s=tileSize; s < maxi * canvas.main.underzoomLevels; s*=2) this.numLayers++;
		// Adjust layer count if using archive or scale-based visibility
		if(canvas.main.hasArchive || this.fromScale > 0) this.numLayers -= 3 - canvas.main.archiveLayerOffset;
		if(this.fromScale > 0) this.numLayers--;
		// Ensure at least one layer
		this.numLayers = max(1, this.numLayers);

		// --- Create Layer Objects ---
		let o = startOffset, s:u32 = tileSize;
		for(let l : u8 = 0; l < this.numLayers; s*=2, l++) {
			// Calculate columns and rows for this layer
			const s2 = twoNth(l) * this.tileSize; // Size of tiles at this layer
			const c = <u32>ceil(width / s2);  // Number of columns
			const r = <u32>ceil(height / s2); // Number of rows
			// Create Layer instance and update global tile offset
			this.layers.push(new Layer(this, <u8>this.layers.length, o, this.endOffset=o+=c*r, s,c,r));
		}
	}

	/** Sets the relative area this image occupies within its parent canvas. */
	setArea(x0:f64, y0:f64, x1:f64, y1:f64) : void {
		this.x0 = x0;
		this.y0 = y0;
		this.x1 = x1;
		this.y1 = y1;
		// Calculate relative width/height, handling wrap-around for X if needed
		this.rWidth = x1 + (x1 < x0 ? 1 : 0) - x0;
		this.rHeight = y1 - y0;
		// Calculate image aspect ratio
		this.aspect = <f32>this.width / <f32>this.height;
		// Calculate relative scale factor based on aspect ratios
		this.rScale = this.aspect > this.canvas.aspect ?
			this.canvas.width / this.width * this.rWidth : this.canvas.height / this.height * this.rHeight;
	}

	/** Checks if the image's bounding box is completely outside the current view. */
	private outsideView() : bool {
		const v = this.canvas.view;
		if(this.is360Embed) {
			// Special logic for 360 embeds, considering wrap-around and view frustum
			const cW = this.canvas.el.width, cH = this.canvas.el.height;
			let mx0 = this.x0, mx1 = this.x1;
			// Handle horizontal wrap-around for embed coordinates
			if(mx0 < 0) { mx0++; }
			if(mx0 > mx1) { // If wrapped (e.g., x0=0.9, x1=0.1)
				// Adjust based on which side of the seam the center of the view is on
				if(v.centerX < .5 && v.x1 <= 1) mx0--; else mx1++;
			}
			// Get view boundaries in image coordinates (approximated)
			let lx0 = min(v.x0, this.canvas.webgl.getCoo(0, cH / 2).x),
				lx1 = max(v.x1, this.canvas.webgl.getCoo(cW, cH / 2).x);
			// Handle view wrap-around
			if(lx1 > 1) { lx0--; lx1--; }
			// Check for non-overlap
			const outside = mx0>lx1||mx1<lx0||this.y0>v.y1||this.y1<v.y0;
			return outside;
		}
		else { // Standard 2D check
			return this.x1 <= v.x0 || this.x0 >= v.x1 || this.y1 <= v.y0 || this.y0 >= v.y1;
		}
	}

	/** Determines if this image should be rendered in the current frame. */
	shouldRender() : bool {
		// Don't render if below the minimum scale threshold (for embeds)
		if(this.fromScale > 0 && this.fromScale > this.canvas.camera.scale) return false;
		// Don't render if fully transparent (for videos/embeds)
		if((this.isVideo || this.localIdx > 0) && this.opacity == 0 && this.tOpacity == 0) return false;
		// Always render if it's the active image in the canvas or the main image in a 360 view
		if(this.index == this.canvas.activeImageIdx || (this.canvas.is360 && this.index == 0)) return true;
		// Otherwise, render only if it's within the current view
		return !this.outsideView();
	}

	/**
	 * Steps the opacity animation for this image.
	 * @param direct If true, snap to target opacity immediately.
	 * @returns True if the opacity changed (animation is active or snapped).
	 */
	opacityTick(direct:bool) : bool {
		const tOp = this.tOpacity;
		if(this.opacity == tOp) return false; // No change needed
		// Calculate opacity delta based on frame time and fade duration
		const delta = 1 / (this.canvas.main.frameTime * this.canvas.main.embedFadeDuration);
		// Update opacity towards target, clamped between 0 and 1
		this.opacity = min(1, max(0, !direct ? tOp > this.opacity
				? min(tOp, this.opacity + delta) : max(tOp, this.opacity - delta) : tOp));
		return this.opacity >= 0; // Return true if opacity is non-negative (might be redundant)
	}

	/**
	 * Calculates the set of tiles needed to render the current view for this image.
	 * Populates the parent Canvas's `toDraw` array.
	 * @param scale The current effective scale factor of the parent canvas.
	 * @returns The number of tiles from this image that are already loaded/drawn.
	 */
	getTiles(scale:f64) : u16 {
		// Skip if image is fully transparent
		if(this.opacity <= 0) return 0;
		this.doneTotal = 0; // Reset count of drawn tiles for this frame

		// Adjust scale for 360 embeds based on their projected size
		if(this.is360Embed) {
			scale = this.getEmbeddedScale(scale);
			// If calculated scale is 0 or less, mark as not needing render and exit
			if(!(this.doRender = (scale > 0))) return 0;
		}
		// For standard 2D images/embeds, apply relative scale factor
		else scale *= this.rScale;

		// --- Base Layer Handling ---
		// If the base layer hasn't been drawn yet, always add it to the draw list
		if(this.gotBase == 0) {
			Image.toDraw.push(this.endOffset - 1); // Add base tile index (last tile)
			setTileOpacity(this.endOffset-1, true, 1); // Tell JS to set its opacity immediately
		}
		// If it's a 360 embed and base is loaded, still add base tile (needed for positioning?) and count as done
		else if(this.is360Embed) {
			Image.toDraw.push(this.endOffset - 1);
			this.doneTotal++;
		}

		// --- Target Layer Tile Calculation ---
		// Determine the ideal layer index based on the current scale
		const lIdx:u8 = this.getTargetLayer(scale);
		const c = this.canvas;
		const v = c.view;

		// Special logic for main 360 image: calculate tiles radially from view center
		if(this.localIdx==0 && c.is360) {
			const l=unchecked(this.layers[lIdx]);
			// Get center coordinates in 360 space
			const m=c.webgl.getCoo(c.el.width/2, c.el.height/2);
			m.x -= c.webgl.offX; // Apply true north offset
			// Start recursive column calculation from the center tile
			this.getColumn(l, 0, <i32>floor(m.x/l.tileWidth), <i32>floor(m.y/l.tileHeight));
		}
		// Logic for 2D images or 360 embeds
		else {
			// Calculate tiles needed for the visible portion of the view
			if(c.is360) { // For 360 embeds, use the full logical view
				this.getTilesRect(lIdx,v.x0,v.y0,v.x1,v.y1);
			} else if(c.visible.x0 < c.visible.x1 && c.visible.y0 < c.visible.y1) { // For 2D, use the calculated visible intersection
				this.getTilesRect(lIdx,
					max(c.visible.x0,v.x0), max(c.visible.y0,v.y0), // Clamp min coords
					min(c.visible.x1,v.x1), min(c.visible.y1,v.y1)  // Clamp max coords
				);
			}
			// Hack: Increment doneTotal for 360 embeds? Seems incorrect.
			if(this.is360Embed) this.doneTotal++;
		}

		// Sort tiles (descending index for potential drawing order optimization?) and add to canvas draw list
		Image.toDraw.sort((a, b) => a>b?-1:a<b?1:0);
		while(Image.toDraw.length)
			c.toDraw.push(Image.toDraw.shift());
		Image.toDraw.length = 0; // Clear static array

		return this.doneTotal; // Return count of already loaded tiles for progress calculation
	}

	/** Calculates the target layer index based on the current scale. */
	private getTargetLayer(scale: f64) : u8 {
		// Start from highest layer if single image or limited mode, else start from layer 1 + skipBaseLevels
		let l:u8 = this.isSingle || this.canvas.limited ? this.numLayers : 1 + this.canvas.main.skipBaseLevels;
		// If not single/limited, find the first layer where tile size * scale >= 1 pixel
		if(!this.isSingle && !this.canvas.limited) {
			for(;l<this.numLayers;l++) {
				if(twoNth(l) * scale >= 1) break; // twoNth(l) = 2^l
			}
		}
		// Store and return the target layer index (adjusting for 0-based index)
		return (this.targetLayer = l) - 1;
	}

	/** Calculates and adds tiles within a given rectangular area for a specific layer. */
	private getTilesRect(layerIdx:u8, x0:f64, y0:f64, x1:f64, y1:f64) : void {
		// Exit if the image is outside the view (redundant check?)
		if(this.outsideView()) return;

		const layer = unchecked(this.layers[layerIdx]);
		const tW=layer.tileWidth, tH=layer.tileHeight; // Tile dimensions relative to image (0-1)
		const rW=this.rWidth, rH=this.rHeight; // Relative width/height of image within canvas

		// Calculate tile column/row indices covering the rectangle
		const r:u32=<u32>min(layer.cols-1,<u32>floor(max(0, x1-this.x0)/rW/tW)); // Right column
		const b:u32=<u32>floor(max(0,y1-this.y0)/rH/tH); // Bottom row (clamped at max rows - 1 implicitly by loop)
		const l:u32=<u32>floor(max(0,x0-this.x0)/rW/tW); // Left column
		let y:u32=<u32>floor(max(0,y0-this.y0)/rH/tH); // Top row

		// Iterate through rows and columns, adding tiles to draw list
		for(;y<=b;y++) {
			// Ensure row does not exceed layer bounds
			if (y >= <u32>layer.rows) continue;
			for(let x:u32=l;x<=r;x++) {
				this.setToDraw(layer, x, y);
			}
		}
	}

	/** Adds a tile index to the draw list if not already present, and recursively adds parent tiles if needed. */
	private setToDraw(l:Layer, x:u32, y:u32): void {
		// Calculate global tile index, clamping to valid range
		const idx:u32 = min(this.endOffset-1, l.start + (y * l.cols) + x);
		// Avoid adding duplicates to the static temporary list
		if(Image.toDraw.indexOf(idx) >= 0) return;
		Image.toDraw.push(idx);

		// Check tile opacity (loading state) via JS call
		if(setTileOpacity(idx, idx == this.endOffset - 1, this.canvas.opacity) >= 1) {
			// If tile is fully opaque (loaded), increment done count
			this.doneTotal++;
		}
		// If tile is not fully loaded, not single/limited, and not the highest resolution layer:
		else if(!this.isSingle && !this.canvas.limited && l.index < this.numLayers - 1) {
			// Recursively find tiles for the next higher resolution layer covering the same area
			const r=l.getTileRect(idx,this.canvas.rect); // Get the rect for the current tile
			this.getTilesRect(l.index+1, r.x0, r.y0, r.x1, r.y1); // Request tiles for the parent layer
		}
	}

	/** Recursively calculates tiles needed for a 360 view, expanding column by column from the center. */
	private getColumn(l:Layer,dX:i32, cX:i32, cY:i32) : void {
		// Calculate wrapped column index
		let tX = (cX + dX)%l.cols; if(tX < 0) tX+=l.cols;

		const wasDrawn = Image.toDraw.length; // Store current draw list length
		const c = <i32>ceil(l.cols / 2); // Half the number of columns

		// Add tiles in the current column if they are on screen
		if(dX == 0) this.setToDraw(l, tX, cY); // Add center tile directly
		else this.inScreen(l, tX, cY); // Check if center tile of column is on screen
		// Check tiles above center
		for(let y=cY-1;y>=0;y--) if(!this.inScreen(l, tX, y)) break; // Stop if tile is off-screen
		// Check tiles below center
		for(let y=cY+1;y<l.rows;y++) if(!this.inScreen(l, tX, y)) break; // Stop if tile is off-screen

		// If any tiles were added in this column, recursively check adjacent columns
		if(Image.toDraw.length != wasDrawn) {
			if(dX <= 0 && dX >= -c) this.getColumn(l, dX-1, cX, cY); // Check left column
			if(dX >= 0 && dX <= c) this.getColumn(l, dX+1, cX, cY); // Check right column
		}
	}

	/** Checks if any part of a tile is visible on screen in 360 mode. */
	private inScreen(l:Layer, x:i32, y:i32) : bool {
		const c = this.canvas, el = c.el, m = el.width * 0.05; // Screen margin
		// Check multiple points within the tile against screen boundaries
		for(let dY:f64=0;dY<=1;dY+=0.05) { // Check vertical points
			for(let dX:f64=0;dX<=1;dX+=0.25) { // Check horizontal points
				// Get screen coordinates for the point within the tile
				const px = c.webgl.getXYZ(min(1,(x+dX)*l.tileWidth),min(1,(y+dY)*l.tileHeight));
				// If the point is within screen bounds (plus margin)
				if(!(px.x<-m||px.x>el.width+m||px.y<-m||px.y>el.height+m)) {
					this.setToDraw(l, x, y); // Add the tile to the draw list
					return true; // Tile is at least partially visible
				}
			}
		}
		return false; // Tile is completely off-screen
	}

	/** Calculates the vertex positions for an embedded image within a 360 canvas. */
	setDrawRect(r: DrawRect) : void {
		const v = this.canvas.main.vertexBuffer; // Use the standard 2D vertex buffer
		const d = this.canvas.webgl.radius; // Radius of the 360 sphere
		const s:f64 = PI * 2 * d; // Circumference scale factor
		const p = this.vec; // Reusable vector
		const m = this.mat; // Reusable matrix

		// Calculate center point of the embed in image coordinates
		const cX:f64 = this.x0 + this.rWidth/2;
		const cY:f64 = this.y0 + this.rHeight/2;
		// Get the 3D position of the center point on the sphere surface
		const center = this.canvas.webgl.getVec3(cX-(.5 - this.canvas.trueNorth), cY, true, 5); // Apply true north, use smaller radius?

		// --- Build Transformation Matrix ---
		m.identity();
		// 1. Translate to the center point on the sphere
		m.translate(center.x, center.y, center.z);
		// 2. Rotate to face outwards from the sphere center, plus embed's Y rotation
		m.rotateY(atan2(center.x,center.z) + PI + this.rotY);
		// 3. Apply pitch based on latitude (cY) and embed's X rotation
		m.rotateX(-Math.sin((cY-.5)*PI) - this.rotX);
		// 4. Apply embed's Z rotation (roll)
		m.rotateZ(-this.rotZ);
		// 5. Apply embed's relative scale
		m.scale(this.scale*.5); // Halve the scale?

		// --- Calculate Vertex Positions ---
		// Calculate positions relative to the embed's center in 3D space
		// left, top
		let x = (r.x0-cX)*s, y = -(r.y0-cY)*.5*s;
		p.x=0;p.y=0;p.z=0; m.translate(x, y, 0); p.transformMat4(m); m.translate(-x, -y, 0); // Transform point
		unchecked(v[0]=<f32>p.x);unchecked(v[1]=<f32>p.y);unchecked(v[2]=<f32>p.z); // Store vertex 0 (Top-Left)

		// left, bottom
		p.x=0;p.y=0;p.z=0; m.translate(x=(r.x0-cX)*s, y=-(r.y1-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[3]=v[9]=<f32>p.x);unchecked(v[4]=v[10]=<f32>p.y);unchecked(v[5]=v[11]=<f32>p.z); // Store vertex 1 (Bottom-Left)

		// right, top
		p.x=0;p.y=0;p.z=0; m.translate(x=(r.x1-cX)*s, y=-(r.y0-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[6]=v[15]=<f32>p.x);unchecked(v[7]=v[16]=<f32>p.y);unchecked(v[8]=v[17]=<f32>p.z); // Store vertex 2 (Top-Right)

		// right, bottom
		p.x=0;p.y=0;p.z=0; m.translate(x=(r.x1-cX)*s, y=-(r.y1-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		unchecked(v[12]=<f32>p.x);unchecked(v[13]=<f32>p.y);unchecked(v[14]=<f32>p.z); // Store vertex 3 (Bottom-Right)
	}

	/** Calculates the effective scale of an embedded image based on its projection onto the screen. */
	private getEmbeddedScale(s:f64) : f64 {
		// For 360 embeds, scale depends on relative size and canvas/image dimensions
		if(this.is360Embed) return s * max(this.rWidth * 2, this.rHeight) * (this.canvas.width / this.width);

		// For 2D embeds (approximation):
		const h = this.rHeight, cY = this.y0+h/2, pH = h/2.5; // Use a fraction of height for checking
		const el = this.canvas.el, gl = this.canvas.webgl, cW = this.canvas.el.width;
		// Get screen coords of top-left and check visibility
		let px = gl.getXYZ(this.x0, cY-pH);
		let lX=px.w > 0 || px.x < 0 ? 0 : min(cW, px.x); // Clamp left screen X
		let b:u8 = 0; // Count visible corners
		if(px.inView(el)) b++;
		// Get screen coords of top-right and check visibility
		if(gl.getXYZ(this.x1, cY-pH).inView(el)) b++;
		// Calculate width based on projected top edge
		const wT = ((px.w > 0 || px.x > cW ? cW : max(0, px.x))-lX);
		// Check bottom corners
		if(gl.getXYZ(this.x0, cY+pH).inView(el)) b++;
		lX=px.w > 0 || px.x < 0 ? 0 : min(cW, px.x); // Re-clamp left X based on bottom-left
		if(gl.getXYZ(this.x1, cY+pH).inView(el)) b++;
		// If no corners are visible, scale is 0
		if (b == 0) return 0;
		// Calculate width based on projected bottom edge
		const wB = (px.w > 0 || px.x > cW ? cW : max(0, px.x))-lX;
		// Return scale based on the maximum projected width relative to image width
		return min(1, max(wB, wT) / this.width);
	}
}

/** Represents a single resolution layer within an Image. */
class Layer {
	/** Width of a single tile in this layer, relative to image width (0-1). */
	readonly tileWidth:f64;
	/** Height of a single tile in this layer, relative to image height (0-1). */
	readonly tileHeight:f64;

	constructor(
		readonly image: Image, // Reference to the parent Image
		readonly index: u8,    // Index of this layer (0 is highest resolution)
		readonly start: u32,   // Global tile index offset for the start of this layer
		readonly end: u32,     // Global tile index offset for the end of this layer
		readonly tileSize: u32,// Tile size in pixels for this layer (e.g., 1024, 2048)
		readonly cols: i32,    // Number of columns in this layer
		readonly rows: i32     // Number of rows in this layer
	) {
		// Pre-calculate relative tile dimensions
		this.tileWidth = tileSize / image.width;
		this.tileHeight = tileSize / image.height;
	}

	/**
	 * Calculates the DrawRect (coordinates, layer, image ref) for a given global tile index.
	 * @param idx The global tile index.
	 * @param r The DrawRect object to populate.
	 * @returns The populated DrawRect object.
	 */
	getTileRect(idx:u32, r:DrawRect) : DrawRect {
		// Calculate column (x) and row (y) from global index and layer start offset
		const localIdx = idx - this.start;
		const x = localIdx % this.cols;
		const y = floor(localIdx / this.cols);
		const i = this.image;

		// Calculate the tile's bounding box relative to the image (0-1),
		// adjusted by the image's area within the canvas (i.x0, i.y0, i.rWidth, i.rHeight).
		r.x0 = i.x0 + ((x * this.tileSize) / i.width) * i.rWidth;
		r.y0 = i.y0 + ((y * this.tileSize) / i.height) * i.rHeight;
		r.x1 = i.x0 + min((x + 1) * this.tileSize / i.width, 1) * i.rWidth;
		r.y1 = i.y0 + min((y + 1) * this.tileSize / i.height, 1) * i.rHeight;

		// Populate other DrawRect fields
		r.image = i;
		r.layer = this.index;
		r.x = x;
		r.y = y;

		return r;
	}
}
