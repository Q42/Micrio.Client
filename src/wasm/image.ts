import { DrawRect, PI } from './shared';
import { setTileOpacity } from './main';
import { atan2, twoNth, mod1 } from './utils';
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

	// --- New Viewport-based Area Properties ---
	/** Center X coordinate of the embed within the parent canvas (0-1, can wrap around for 360). */
	public areaCenterX: f64 = 0.5;
	/** Center Y coordinate of the embed within the parent canvas (0-1). */
	public areaCenterY: f64 = 0.5;
	/** Width of the embed area within the parent canvas (0-1). */
	public areaWidth: f64 = 1;
	/** Height of the embed area within the parent canvas (0-1). */
	public areaHeight: f64 = 1;

	// --- 3D Sphere-based Area Properties (for accurate 360 detection) ---
	/** X coordinate on unit sphere */
	public sphere3DX: f64 = 0;
	/** Y coordinate on unit sphere */
	public sphere3DY: f64 = 0;
	/** Z coordinate on unit sphere */
	public sphere3DZ: f64 = -1;
	/** Angular width on sphere (radians) */
	public angularWidth: f64 = 0;
	/** Angular height on sphere (radians) */
	public angularHeight: f64 = 0;

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

	// Properties for sampling reuse for 360 tile calculation
	private static sampledXs: Float64Array = new Float64Array(200);
	private static sampledYs: Float64Array = new Float64Array(200);
	private static uniqueXs: Float64Array = new Float64Array(200);
	private static sampledLength: i32 = 0;
	private static uniqueLength: i32 = 0;

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

	/** Sets the relative area this image occupies within its parent canvas using viewport model. */
	setArea(x0:f64, y0:f64, x1:f64, y1:f64) : void {
		// Store legacy coordinates for backward compatibility
		this.x0 = x0;
		this.y0 = y0;
		this.x1 = x1;
		this.y1 = y1;
		
		// Calculate viewport-style coordinates
		this.areaWidth = x1 + (x1 < x0 ? 1 : 0) - x0;  // Handle wrap-around
		this.areaHeight = y1 - y0;
		this.areaCenterX = x0 + this.areaWidth / 2;      // Center calculation
		this.areaCenterY = y0 + this.areaHeight / 2;     // Simple for Y
		
		// Normalize centerX for 360 wrap-around if needed
		if(this.canvas.is360) {
			this.areaCenterX = mod1(this.areaCenterX);
		}
		
		// Keep legacy calculations
		this.rWidth = this.areaWidth;
		this.rHeight = this.areaHeight;
		this.aspect = <f32>this.width / <f32>this.height;
		this.rScale = this.aspect > this.canvas.aspect ?
			this.canvas.width / this.width * this.rWidth : this.canvas.height / this.height * this.rHeight;
		
		// Calculate 3D sphere coordinates for accurate 360 detection
		if(this.canvas.is360) {
			this.calculate3DSpherePosition();
		}
	}

	/** Converts 2D sphere coordinates (centerX, centerY) to 3D unit sphere position */
	private calculate3DSpherePosition(): void {
		// Convert centerX/Y to spherical coordinates
		let yaw = (this.areaCenterX - 0.5) * 2 * PI;  // -π to π
		const pitch = (this.areaCenterY - 0.5) * PI;    // -π/2 to π/2

		// Adjust yaw to match camera's base rotation
		yaw -= this.canvas.webgl.baseYaw;
		
		// Convert to 3D Cartesian coordinates on unit sphere
		this.sphere3DX = Math.cos(pitch) * Math.sin(yaw);
		this.sphere3DY = Math.sin(pitch);
		this.sphere3DZ = Math.cos(pitch) * Math.cos(yaw);
		
		// Calculate angular size on sphere
		this.angularWidth = this.areaWidth * 2 * PI;   // Convert to radians
		this.angularHeight = this.areaHeight * PI;     // Convert to radians
	}



	/** 
	 * Checks if embed's 3D sphere position is within camera's viewing frustum
	 * Uses 3D geometry for accurate detection at all viewing angles
	 */
	private sphere3DOverlap(): bool {
		if (!this.canvas.is360) return false;
		
		// Calculate dot product between camera forward and embed position
		const dotProduct = this.sphere3DX * this.canvas.webgl.cameraForwardX + 
		                  this.sphere3DY * this.canvas.webgl.cameraForwardY + 
		                  this.sphere3DZ * this.canvas.webgl.cameraForwardZ;
		
		// Calculate angular distance from camera center to embed center
		const angularDistance = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
		
		// Calculate the embed's angular radius (use max of width/height for safety)
		const embedAngularRadius = max(this.angularWidth, this.angularHeight) / 2;
		
		// Use the camera's field of view plus the embed's angular radius
		// This ensures the embed is visible if ANY part of it is within the FOV
		const effectiveFOV = this.canvas.webgl.fieldOfView + embedAngularRadius;
		
		// Embed is visible if any part of it could be within the field of view
		return angularDistance < effectiveFOV;
	}

	/** Checks if the image's bounding box is completely outside the current view. */
	private outsideView() : bool {
		if(this.is360Embed) {
			// For 360 embeds, use 3D sphere-based detection for accuracy
			// This handles floor/ceiling viewing and extreme angles correctly
			return !this.sphere3DOverlap();
		} else {
			// Legacy 2D check for non-360 embeds and main images
			const v = this.canvas.view;
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
		if(this.index == this.canvas.activeImageIdx || (this.canvas.is360 && this.localIdx == 0)) return true;
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

		// Special logic for main 360 image: calculate tiles using viewport-based ranges
		if(this.localIdx==0 && c.is360) {
			const l=unchecked(this.layers[lIdx]);
			this.get360Tiles(l);
		}
		// Logic for 2D images or 360 embeds
		else {
			// Calculate tiles needed for the visible portion of the view
			if(this.is360Embed) { // For 360 embeds, use new viewport-based calculation
				this.getTilesViewport(lIdx);
			} else if(c.is360) { // For other 360 images (shouldn't happen with current logic)
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
		return (this.targetLayer = l - 1);
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

	/** 
	 * Calculates tiles for 360 embeds using viewport-based coordinates.
	 * Computes the intersection between canvas view and embed area, then converts to tile indices.
	 */
	private getTilesViewport(layerIdx: u8): void {
		// Exit if the image is outside the view
		if(this.outsideView()) return;

		const layer = unchecked(this.layers[layerIdx]);
		const c = this.canvas;
		
		// Add tolerance margin to avoid edge tile culling (10% buffer)
		const tolerance = 0.1;
		
		// Get canvas viewport (where the user is looking) with tolerance buffer
		const viewCenterX = mod1(c.viewCenterX+(.5-c.trueNorth));
		const viewCenterY = c.viewCenterY;
		const viewWidth = c.viewWidth + tolerance;
		const viewHeight = c.viewHeight + tolerance;
		
		// Get embed area viewport 
		const embedCenterX = this.areaCenterX;
		const embedCenterY = this.areaCenterY;
		const embedWidth = this.areaWidth;
		const embedHeight = this.areaHeight;
		
		// Calculate intersection in Y (simpler, no wrap-around)
		const viewY0 = viewCenterY - viewHeight / 2;
		const viewY1 = viewCenterY + viewHeight / 2;
		const embedY0 = embedCenterY - embedHeight / 2;
		const embedY1 = embedCenterY + embedHeight / 2;
		
		const intersectY0 = max(viewY0, embedY0);
		const intersectY1 = min(viewY1, embedY1);
		
		// No Y intersection = no tiles needed
		if (intersectY0 >= intersectY1) return;
		
		// Calculate intersection in X (complex due to 360 wrap-around)
		let intersectX0: f64 = 0, intersectX1: f64 = 0;
		let hasIntersection = false;
		
		if (c.is360) {
			// For 360, handle wrap-around using angular distance
			const viewX0 = mod1(viewCenterX - viewWidth / 2);
			const viewX1 = mod1(viewCenterX + viewWidth / 2);
			const embedX0 = mod1(embedCenterX - embedWidth / 2);
			const embedX1 = mod1(embedCenterX + embedWidth / 2);
			

			
			// Check for intersection considering wrap-around
			// Case 1: Neither view nor embed wraps around
			if (viewX1 > viewX0 && embedX1 > embedX0) {
				intersectX0 = max(viewX0, embedX0);
				intersectX1 = min(viewX1, embedX1);
				hasIntersection = intersectX0 < intersectX1;
			}
			// Case 2: View wraps around (viewX1 < viewX0)
			else if (viewX1 < viewX0 && embedX1 > embedX0) {
				// View spans 0, embed doesn't wrap
				if (embedX0 <= viewX1 || embedX1 >= viewX0) {
					// Intersection exists, but we need to handle in two parts
					// For simplicity, calculate the full embed area intersection
					intersectX0 = embedX0;
					intersectX1 = embedX1;
					hasIntersection = true;
				}
			}
			// Case 3: Embed wraps around (embedX1 < embedX0)  
			else if (viewX1 > viewX0 && embedX1 < embedX0) {
				// Embed spans 0, view doesn't wrap
				if (viewX0 <= embedX1 || viewX1 >= embedX0) {
					// Intersection exists
					intersectX0 = viewX0;
					intersectX1 = viewX1;
					hasIntersection = true;
				}
			}
			// Case 4: Both wrap around
			else if (viewX1 < viewX0 && embedX1 < embedX0) {
				// Both span 0 - intersection likely exists
				intersectX0 = max(viewX0, embedX0);
				intersectX1 = min(viewX1, embedX1);
				hasIntersection = true;
			}
		} else {
			// For 2D, simple intersection
			const viewX0 = viewCenterX - viewWidth / 2;
			const viewX1 = viewCenterX + viewWidth / 2;
			const embedX0 = embedCenterX - embedWidth / 2;
			const embedX1 = embedCenterX + embedWidth / 2;
			
			intersectX0 = max(viewX0, embedX0);
			intersectX1 = min(viewX1, embedX1);
			hasIntersection = intersectX0 < intersectX1;
		}
		
		// No X intersection = no tiles needed
		if (!hasIntersection) return;
		
		// Convert intersection coordinates to embed-relative coordinates (0-1 within embed)
		// Handle 360 wrap-around by ensuring consistent coordinate space
		let embedLeft = embedCenterX - embedWidth / 2;
		let embedRight = embedCenterX + embedWidth / 2;
		
		// For 360, normalize the embed boundaries and intersection to the same coordinate space
		if (c.is360) {
			// If embed wraps around (embedRight > 1), normalize intersectX coordinates
			if (embedRight > 1) {
				// Embed crosses 0/1 boundary - shift everything to unwrapped space
				if (intersectX0 < embedLeft) intersectX0 += 1;
				if (intersectX1 < embedLeft) intersectX1 += 1;
			}
			// If intersectX is much larger than embedCenter, it's likely wrapped the wrong way
			else if (intersectX0 > embedCenterX + 0.5) {
				intersectX0 -= 1;
			}
			else if (intersectX1 > embedCenterX + 0.5) {
				intersectX1 -= 1;
			}
		}
		
		const embedRelX0 = (intersectX0 - embedLeft) / embedWidth;
		const embedRelX1 = (intersectX1 - embedLeft) / embedWidth;
		const embedRelY0 = (intersectY0 - (embedCenterY - embedHeight / 2)) / embedHeight;
		const embedRelY1 = (intersectY1 - (embedCenterY - embedHeight / 2)) / embedHeight;
		
		// Clamp to [0,1] and convert to tile indices
		const tW = layer.tileWidth;
		const tH = layer.tileHeight;
		
		const tileLeft = <u32>floor(max(0, min(1, embedRelX0)) / tW);
		const tileRight = <u32>min(<f64>(layer.cols - 1), floor(max(0, min(1, embedRelX1)) / tW));
		const tileTop = <u32>floor(max(0, min(1, embedRelY0)) / tH);
		const tileBottom = <u32>min(<f64>(layer.rows - 1), floor(max(0, min(1, embedRelY1)) / tH));
		
		// Add tiles to draw list
		for (let row = tileTop; row <= tileBottom; row++) {
			for (let col = tileLeft; col <= tileRight; col++) {
				this.setToDraw(layer, col, row);
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
			// Calculate parent layer and parent tile coordinates
			const parentLayer = unchecked(this.layers[l.index + 1]);
			const parentX = x >> 1; // floor division by 2
			const parentY = y >> 1; // floor division by 2
			// Recursively add the covering parent tile
			this.setToDraw(parentLayer, parentX, parentY);
		}
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
		// For 360 embeds, scale depends on area size and canvas/image dimensions
		if(this.is360Embed) {
			// Use new viewport-based area properties for more accurate scale calculation
			const areaFactor = max(this.areaWidth * 2, this.areaHeight);
			const sizeFactor = this.canvas.width / this.width;
			return s * areaFactor * sizeFactor;
		}

		// For 2D embeds (approximation using new viewport model):
		const embedWidth = this.areaWidth;
		const embedHeight = this.areaHeight;
		const embedX0 = this.areaCenterX - embedWidth / 2;
		const embedX1 = this.areaCenterX + embedWidth / 2;
		const embedY0 = this.areaCenterY - embedHeight / 2;
		const embedY1 = this.areaCenterY + embedHeight / 2;
		
		const cY = this.areaCenterY; // Center Y of embed
		const pH = embedHeight / 2.5; // Use a fraction of height for checking
		const el = this.canvas.el, gl = this.canvas.webgl, cW = this.canvas.el.width;
		
		// Get screen coords of top-left and check visibility
		let px = gl.getXYZ(embedX0, cY - pH);
		let lX = px.w > 0 || px.x < 0 ? 0 : min(cW, px.x); // Clamp left screen X
		let b:u8 = 0; // Count visible corners
		if(px.inView(el)) b++;
		
		// Get screen coords of top-right and check visibility
		if(gl.getXYZ(embedX1, cY - pH).inView(el)) b++;
		// Calculate width based on projected top edge
		const wT = ((px.w > 0 || px.x > cW ? cW : max(0, px.x)) - lX);
		
		// Check bottom corners
		if(gl.getXYZ(embedX0, cY + pH).inView(el)) b++;
		lX = px.w > 0 || px.x < 0 ? 0 : min(cW, px.x); // Re-clamp left X based on bottom-left
		if(gl.getXYZ(embedX1, cY + pH).inView(el)) b++;
		
		// If no corners are visible, scale is 0
		if (b == 0) return 0;
		
		// Calculate width based on projected bottom edge
		const wB = (px.w > 0 || px.x > cW ? cW : max(0, px.x)) - lX;
		// Return scale based on the maximum projected width relative to image width
		return min(1, max(wB, wT) / this.width);
	}

	private get360Tiles(l: Layer): void {
		const c = this.canvas;
		const el = c.el;

		// Reset arrays
		Image.sampledLength = 0;
		Image.uniqueLength = 0;

		// Adaptive samples
		const samplesPerEdge: i32 = c.webgl.fieldOfView > PI/2 ? 40 : 20;

		const epsilon: f64 = 1e-8; // Tolerance for considering X values equal

		// Inline sampling for top edge
		for (let i: i32 = 0; i <= samplesPerEdge; i++) {
			const t = <f64>i / <f64>samplesPerEdge;
			const pxX = 0 + t * (el.width - 0);
			const pxY = 0 + t * (0 - 0);
			const coo = c.webgl.getCoo(pxX, pxY);
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
		}
		// Inline sampling for right edge
		for (let i: i32 = 0; i <= samplesPerEdge; i++) {
			const t = <f64>i / <f64>samplesPerEdge;
			const pxX = el.width + t * (el.width - el.width);
			const pxY = 0 + t * (el.height - 0);
			const coo = c.webgl.getCoo(pxX, pxY);
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
		}
		// Inline sampling for bottom edge
		for (let i: i32 = 0; i <= samplesPerEdge; i++) {
			const t = <f64>i / <f64>samplesPerEdge;
			const pxX = el.width + t * (0 - el.width);
			const pxY = el.height + t * (el.height - el.height);
			const coo = c.webgl.getCoo(pxX, pxY);
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
		}
		// Inline sampling for left edge
		for (let i: i32 = 0; i <= samplesPerEdge; i++) {
			const t = <f64>i / <f64>samplesPerEdge;
			const pxX = 0 + t * (0 - 0);
			const pxY = el.height + t * (0 - el.height);
			const coo = c.webgl.getCoo(pxX, pxY);
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
		}

		// Add internal samples: center and 4 quadrants
		const centerX = el.width / 2;
		const centerY = el.height / 2;
		const quarterW = el.width / 4;
		const quarterH = el.height / 4;

		// Center
		let coo = c.webgl.getCoo(centerX, centerY);
		unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
		unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
		Image.sampledLength++;

		// Top-left quadrant center
		coo = c.webgl.getCoo(centerX - quarterW, centerY - quarterH);
		unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
		unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
		Image.sampledLength++;

		// Top-right
		coo = c.webgl.getCoo(centerX + quarterW, centerY - quarterH);
		unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
		unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
		Image.sampledLength++;

		// Bottom-left
		coo = c.webgl.getCoo(centerX - quarterW, centerY + quarterH);
		unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
		unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
		Image.sampledLength++;

		// Bottom-right
		coo = c.webgl.getCoo(centerX + quarterW, centerY + quarterH);
		unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
		unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
		Image.sampledLength++;

		// Add extra samples near top and bottom for better pole coverage on wide screens
		for (let i: i32 = 1; i <= 3; i++) {
			const frac = <f64>i / 4.0;
			// Near top
			coo = c.webgl.getCoo(el.width * frac, quarterH / 2);
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
			// Near bottom
			coo = c.webgl.getCoo(el.width * frac, el.height - quarterH / 2);
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
		}

		// Add even more samples very close to the bottom for south pole coverage
		for (let i: i32 = 0; i <= 5; i++) {
			const frac = <f64>i / 5.0;
			coo = c.webgl.getCoo(el.width * frac, el.height - 1); // 1 pixel from bottom
			unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
			unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
			Image.sampledLength++;
		}

		// After existing internal samples (center + quadrants + extras)
		// Add 3x3 grid of internal samples for better central coverage
		const gridSize = 3;
		const stepX = el.width / (gridSize + 1);
		const stepY = el.height / (gridSize + 1);
		for (let gy: i32 = 1; gy <= gridSize; gy++) {
			for (let gx: i32 = 1; gx <= gridSize; gx++) {
				const sampleX = gx * stepX;
				const sampleY = gy * stepY;
				coo = c.webgl.getCoo(sampleX, sampleY);
				unchecked(Image.sampledXs[Image.sampledLength] = coo.x);
				unchecked(Image.sampledYs[Image.sampledLength] = coo.y);
				Image.sampledLength++;
			}
		}

		// Step 2: Compute Y range
		let minY: f64 = Infinity;
		let maxY: f64 = -Infinity;
		for (let i: i32 = 0; i < Image.sampledLength; i++) {
			const val = unchecked(Image.sampledYs[i]);
			if (val < minY) minY = val;
			if (val > maxY) maxY = val;
		}

		// Clamp to [0,1]
		minY = max<f64>(0, minY);
		maxY = min<f64>(1, maxY);

		// Conservatively expand for floating-point safety
		minY -= 0.001;
		maxY += 0.05; // Further increased expansion for maxY to ensure south pole inclusion
		minY = max<f64>(0, minY);
		maxY = min<f64>(1, maxY);

		// Step 3: Compute minimal covering arc for X
		// Normalize all x to [0,1)
		for (let i: i32 = 0; i < Image.sampledLength; i++) {
			unchecked(Image.sampledXs[i] = mod1(Image.sampledXs[i]));
		}
		// Remove duplicates with tolerance
		Image.uniqueLength = 0;
		for (let i: i32 = 0; i < Image.sampledLength; i++) {
			const val = unchecked(Image.sampledXs[i]);
			let exists = false;
			for (let j: i32 = 0; j < Image.uniqueLength; j++) {
				if (Math.abs(unchecked(Image.uniqueXs[j]) - val) < epsilon) {
					exists = true;
					break;
				}
			}
			if (!exists) {
				unchecked(Image.uniqueXs[Image.uniqueLength] = val);
				Image.uniqueLength++;
			}
		}
		// Manual bubble sort
		for (let i: i32 = 0; i < Image.uniqueLength - 1; i++) {
			for (let j: i32 = 0; j < Image.uniqueLength - i - 1; j++) {
				if (unchecked(Image.uniqueXs[j]) > unchecked(Image.uniqueXs[j + 1])) {
					const temp = unchecked(Image.uniqueXs[j]);
					unchecked(Image.uniqueXs[j] = unchecked(Image.uniqueXs[j + 1]));
					unchecked(Image.uniqueXs[j + 1] = temp);
				}
			}
		}

		const n: i32 = Image.uniqueLength;
		if (n < 2) {
			// Fallback: full view if insufficient samples
			minY = 0; maxY = 1;
			Image.uniqueLength = 0;
			unchecked(Image.uniqueXs[0] = 0);
			unchecked(Image.uniqueXs[1] = 1);
			Image.uniqueLength = 2;
		} else {
			// Compute gaps
			let maxGap: f64 = 0;
			let maxGapIdx: i32 = -1;
			for (let i: i32 = 0; i < n - 1; i++) {
				const gap: f64 = unchecked(Image.uniqueXs[i + 1]) - unchecked(Image.uniqueXs[i]);
				if (gap > maxGap) {
					maxGap = gap;
					maxGapIdx = i;
				}
			}
			// Wrap-around gap
			const wrapGap: f64 = unchecked(Image.uniqueXs[0]) + 1 - unchecked(Image.uniqueXs[n - 1]);
			let isWrapMax: bool = wrapGap > maxGap;
			if (isWrapMax) {
				maxGap = wrapGap;
				maxGapIdx = n - 1;
			}

			// Minimal arc length = 1 - maxGap
			const arcLength: f64 = 1 - maxGap;

			let arcStart: f64 = 0;
			let arcEnd: f64 = 0;
			if (isWrapMax) {
				// Non-wrapping arc
				arcStart = unchecked(Image.uniqueXs[0]);
				arcEnd = unchecked(Image.uniqueXs[n - 1]);
			} else {
				// Wrapping arc
				arcStart = unchecked(Image.uniqueXs[(maxGapIdx + 1) % n]);
				arcEnd = unchecked(Image.uniqueXs[maxGapIdx]) + 1; // Extend to wrap
			}

			// If arcLength nearly 1, treat as full
			if (arcLength >= 1 - 1e-6) {
				arcStart = 0;
				arcEnd = 1;
			}

			// Update uniqueXs to represent the arc for column calculation
			Image.uniqueLength = 0;
			unchecked(Image.uniqueXs[0] = arcStart);
			unchecked(Image.uniqueXs[1] = arcEnd);
			Image.uniqueLength = 2;
		}

		// After computing isFullArc, force full arc if near poles
		let isFullArc: bool = unchecked(Image.uniqueXs[1]) - unchecked(Image.uniqueXs[0]) >= 1 - 1e-6;
		if (minY < 0.05 || maxY > 0.95) { // Lowered threshold for maxY to trigger earlier for south pole
			isFullArc = true;
		}

		// Step 4: Compute visible rows and columns
		let minRow: u32 = max<u32>(0, <u32>max<f64>(0, floor((minY - 0.001) / l.tileHeight))); // Ensure non-negative before cast
		let maxRow: u32 = min<u32>(l.rows - 1, <u32>max<f64>(0, floor((maxY + l.tileHeight - 1e-10) / l.tileHeight))); // Adjusted to include last row if maxY close to boundary

		// Force include edge rows if near 0 or 1
		if (minY < 1e-5) minRow = 0;
		if (maxY > 1 - 1e-5) maxRow = l.rows - 1;

		const tileWidth = l.tileWidth;
		const isWrapping: bool = unchecked(Image.uniqueXs[1]) > 1;

		// Step 5: Add tiles in bulk
		for (let row: u32 = minRow; row <= maxRow; row++) {
			if (isFullArc) {
				// All columns
				for (let col: u32 = 0; col < <u32>l.cols; col++) {
					this.setToDraw(l, col, row);
				}
			} else if (!isWrapping) {
				// Single non-wrapping range (Ensure non-negative)
				const minCol: u32 = max<u32>(0, <u32>max<f64>(0, floor((unchecked(Image.uniqueXs[0]) - 0.001) / tileWidth) - 1));
				const maxCol: u32 = min<u32>(l.cols - 1, <u32>ceil((unchecked(Image.uniqueXs[1]) + 0.001) / tileWidth));
				for (let col: u32 = minCol; col <= maxCol; col++) {
					this.setToDraw(l, col, row);
				}
			} else {
				// Wrapping: two ranges (Ensure non-negative)
				// First range: arcStart to end of image
				const minCol1: u32 = max<u32>(0, <u32>max<f64>(0, floor((unchecked(Image.uniqueXs[0]) - 0.001) / tileWidth) - 1));
				for (let col: u32 = minCol1; col < l.cols; col++) {
					this.setToDraw(l, col, row);
				}
				// Second range: 0 to mod1(arcEnd)
				const maxCol2: u32 = min<u32>(l.cols - 1, <u32>ceil((mod1(unchecked(Image.uniqueXs[1]) + 0.001)) / tileWidth));
				for (let col: u32 = 0; col <= maxCol2; col++) {
					this.setToDraw(l, col, row);
				}
			}
		}
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
		readonly cols: u32,    // Number of columns in this layer
		readonly rows: u32     // Number of rows in this layer
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
