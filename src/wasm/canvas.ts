import { View, DrawRect, Viewport } from './shared';
import { Main, getTileOpacity, drawTile, drawQuad, setMatrix, setViewport, viewSet, viewportSet, setVisible, setVisible2 } from './main';
import { easeInOut } from './utils'
import { base360Distance } from './globals';

import Kinetic from './camera.kinetic'
import Ani from './camera.ani'
import Camera from './camera'
import Image from './image'
import WebGL from './webgl'

/**
 * Represents a single rendering canvas within the Wasm module.
 * This could be the main canvas or a child canvas (e.g., in a grid).
 * It orchestrates image loading, tile calculation, camera control, and drawing for its area.
 */
export default class Canvas {
	/** The current logical view rectangle [x0, y0, x1, y1] relative to the image dimensions. */
	readonly view! : View;

	/** The current focus area within the canvas (used for galleries/grids). */
	readonly focus! : View;
	/** Animation controller instance. */
	readonly ani! : Ani;
	/** Kinetic movement controller instance. */
	readonly kinetic! : Kinetic;
	/** 2D Camera controller instance. */
	readonly camera! : Camera;
	/** WebGL controller instance (primarily for 360 rendering). */
	readonly webgl! : WebGL;
	/** Reusable DrawRect object for tile calculations. */
	readonly rect : DrawRect = new DrawRect;
	/** Viewport representing the canvas's position and size on the screen. */
	readonly el : Viewport = new Viewport;

	/** Array of Image instances associated with this canvas (tile sources). */
	readonly images : Image[] = [];

	// --- Grid/Child Canvas Properties ---
	/** Array of child Canvas instances (used for grids). */
	private readonly children: Canvas[] = [];
	/** The defined area of this canvas within its parent (if any) [x0, y0, x1, y1]. */
	readonly area!: View;
	/** The current animated area of this canvas within its parent. */
	readonly currentArea!: View;
	/** The target area for area animations. */
	readonly targetArea!: View;
	/** The portion of the logical view currently visible within the screen viewport. */
	readonly visible!: View;
	/** Represents the full view [0, 0, 1, 1]. */
	readonly full!: View;

	/** Current progress (0-1) of an area animation. */
	private areaAniPerc: f64 = 1;
	/** Flag indicating if the area animation is paused. */
	private areaAniPaused: bool = false;

	/** Z-index used for ordering canvases during transitions (e.g., grids). */
	zIndex:u8 = 0;

	/** Array of global tile indices to be drawn in the current frame. */
	readonly toDraw : u32[] = [];

	/** Aspect ratio of the image (width / height). */
	readonly aspect: f32;
	/** Index of this canvas within the main controller's list. */
	private index:u32 = 0;

	/** Flag indicating if this canvas is currently considered visible by the JS host. */
	private isVisible: bool = false;

	// --- 360 View Bounds (calculated once per frame for embed visibility detection) ---
	/** Minimum X coordinate of the current 360 view (for embed visibility detection). */
	public minViewX: f64 = 0;
	/** Maximum X coordinate of the current 360 view (for embed visibility detection). */
	public maxViewX: f64 = 1;
	/** Minimum Y coordinate of the current 360 view (for embed visibility detection). */
	public minViewY: f64 = 0;
	/** Maximum Y coordinate of the current 360 view (for embed visibility detection). */
	public maxViewY: f64 = 1;

	// --- Viewport-style View Bounds (for cleaner overlap detection) ---
	/** Center X coordinate of the current view (for viewport-style calculations). */
	public viewCenterX: f64 = 0.5;
	/** Center Y coordinate of the current view (for viewport-style calculations). */
	public viewCenterY: f64 = 0.5;
	/** Width of the current view (for viewport-style calculations). */
	public viewWidth: f64 = 1;
	/** Height of the current view (for viewport-style calculations). */
	public viewHeight: f64 = 1;



	// --- Opacity/Fading ---
	/** Current opacity value (linear). */
	opacity: f64 = 0;
	/** Current opacity value after applying easing (used for rendering). */
	bOpacity: f64 = 0; // Bezier opacity

	/** Flag indicating if the canvas (and its base image) is ready to be displayed. */
	isReady: bool = false;
	/** Index of the currently active image within the `images` array (for galleries/omni). -1 if single image. */
	activeImageIdx:i32 = -1;

	// --- Omni-object Specific Settings ---
	omniFieldOfView: number = 0;
	omniVerticalAngle: number = 0;
	omniDistance: number = 0;
	omniOffsetX: number = 0;

	/** Flag to limit tile loading (used with archives). */
	limited: bool = false;

	/** Current active layer index (for multi-layer omni objects). */
	layer: i32 = 0;

	constructor(
		readonly main: Main, // Reference to the main Wasm controller

		// --- Image Dimensions (can be dynamic for grid controllers) ---
		public width: f64,  // Original image width
		public height: f64, // Original image height

		// --- Image Properties ---
		readonly tileSize: u32, // Tile size in pixels
		readonly is360: bool,   // Is it a 360 panorama?
		readonly noImage: bool, // Is it a virtual canvas without its own image?
		readonly isSingle: bool,// Use a single image source instead of tiles?
		public targetOpacity: f64, // Initial target opacity

		// --- Camera/Interaction Settings ---
		readonly freeMove: bool, // Allow panning outside image bounds?
		public coverLimit: bool, // Limit zoom out to cover the viewport?
		readonly coverStart: bool, // Start zoomed to cover the viewport?
		readonly maxScale: f64,  // Maximum zoom scale allowed (relative to original)
		readonly camSpeed: f64,  // Camera animation speed factor

		// --- 360 Specific ---
		readonly trueNorth: f64, // Rotation offset for true north alignment

		// --- Gallery/Paged Specific ---
		readonly isGallerySwitch: bool, // Is this a canvas for a switch-style gallery?
		readonly pagesHaveBackground: bool, // Should gallery pages draw a background?

		// --- Omni Specific ---
		readonly isOmni: bool, // Is it an omni-object viewer?

		// --- Pinch Specific ---
		readonly pinchZoomOutLimit: bool, // Prevent pinching out beyond limits?

		// --- Omni Layer Specific ---
		readonly omniNumLayers: i32, // Number of layers in the omni object
		readonly omniStartLayer: i32, // Initial layer index for omni object

		// --- Grid Specific ---
		readonly hasParent: bool // Does this canvas have a parent (is it a grid item)?
	) {
		this.index = main.canvases.length; // Assign index based on current count
		// Add to main list only if it's a top-level canvas
		if(!hasParent) main.canvases.push(this);

		// Ensure coverStart implies coverLimit
		if(coverLimit) coverStart = true;

		// Calculate image aspect ratio
		this.aspect = <f32>width / <f32>height;

		// Initialize controllers and view objects
		this.view = new View(this);
		this.focus = new View(this); // Used for focus area in galleries/grids
		this.ani = new Ani(this);
		this.kinetic = new Kinetic(this);
		this.camera = new Camera(this); // 2D camera controller
		this.webgl = new WebGL(this);   // 360/WebGL controller
		this.area = new View(this);         // Defined area within parent
		this.currentArea = new View(this);  // Current animated area
		this.targetArea = new View(this);   // Target area for animation
		this.visible = new View(this);      // Visible portion of the logical view
		this.full = new View(this);         // Represents the full [0,0,1,1] view

		// Initial view adjustment for 360 (often only shows middle vertically)
		if(is360) { this.view.set(0.5, 0.5, 1, 0.5); }

		// If top-level canvas, initialize viewport and calculate initial camera state
		if(!hasParent) {
			this.el.copy(main.el); // Copy main element viewport
			// Set initial view (might be adjusted by camera.setView later)
			this.setView(this.view.centerX,this.view.centerY,this.view.width,this.view.height, false, false);
			this.resize(); // Trigger initial resize calculation
		}

		// Add the primary image source if this isn't a virtual canvas
		if(!noImage) this.addImage(0, 0, 1, 1, width, height, tileSize, isSingle, false, targetOpacity, 0, 0, 0, 1, 0);
		// If virtual canvas, mark as ready immediately
		else {
			this.main.numImages++; // Still counts as an "image" for indexing
			this.bOpacity = 1;
			this.opacity = 1;
			this.isReady = true;
			if(omniStartLayer > 0) this.setActiveLayer(omniStartLayer); // Set initial omni layer if specified
		}
	}

	/** Reference to the parent canvas (if this is a child/grid item). */
	parent!: Canvas;

	/** Sets the parent canvas for a child canvas. */
	setParent(parent: Canvas) : void {
		this.parent = parent;
		// Adjust index based on parent's children count
		this.index += parent.children.length;
	}

	/**
	 * Adds an image source (usually tiled) to this canvas.
	 * Used for the main image and for image embeds.
	 * @param x0 Relative X0 position within the canvas (for embeds).
	 * @param y0 Relative Y0 position within the canvas.
	 * @param x1 Relative X1 position within the canvas.
	 * @param y1 Relative Y1 position within the canvas.
	 * @param w Original width of the image source.
	 * @param h Original height of the image source.
	 * @param tileSize Tile size in pixels.
	 * @param isSingle If true, use a single source, not tiles.
	 * @param isVideo If true, the source is a video.
	 * @param opa Initial target opacity.
	 * @param rotX 3D rotation X (for 360 embeds).
	 * @param rotY 3D rotation Y.
	 * @param rotZ 3D rotation Z.
	 * @param scale Relative scale (for 360 embeds).
	 * @param fromScale Only render when main canvas scale is above this value.
	 * @returns The created Image instance.
	 */
	addImage(x0:f64,y0:f64,x1:f64,y1:f64,w:f64,h:f64,
		tileSize:u32, isSingle: bool, isVideo: bool,
		opa:f64, rotX:f64, rotY:f64, rotZ:f64, scale:f64, fromScale:f64) : Image {
		const image = new Image(
			this,
			this.main.numImages++, // Global image index
			this.images.length,    // Local image index within this canvas
			w, h, tileSize,
			isSingle, isVideo,
			this.main.numTiles,    // Starting global tile offset
			0, opa, rotX, rotY, rotZ, scale, fromScale);
		image.setArea(x0, y0, x1, y1); // Set relative area for embeds
		this.images.push(image);
		// Update global tile count based on the new image's layers
		this.main.numTiles = image.endOffset;
		// Set as active image if it's the first one
		if(this.images.length == 1) this.setActiveImage(0,0);
		return image;
	}

	/**
	 * Creates and adds a child Canvas instance (used for grids).
	 * Child canvases have their own independent camera/view state but render within the parent's area.
	 * @param x0 Relative X0 position within the parent canvas.
	 * @param y0 Relative Y0 position.
	 * @param x1 Relative X1 position.
	 * @param y1 Relative Y1 position.
	 * @param width Original width of the image for the child canvas.
	 * @param height Original height of the image for the child canvas.
	 * @returns The created child Canvas instance.
	 */
	addChild(x0:f32, y0: f32, x1: f32, y1: f32,
		width: f32, height: f32) : Canvas {
		// Create a new Canvas instance with default settings suitable for a grid item
		const c = new Canvas(
			this.main, width, height,
			this.tileSize, false, false, // Not 360, Not virtual (will have an image added later)
			false, 1, false, // Not single source, Start opaque, Not freeMove
			true, // Default to coverLimit
			true, // Default to coverStart
			1, this.camSpeed, 0, false, false, false, this.pinchZoomOutLimit, 1, 0, // Default settings, inherit camSpeed
			true // Mark as having a parent
		);
		c.setParent(this); // Establish parent-child relationship
		c.setArea(x0, y0, x1, y1, true, true); // Set initial area directly, no dispatch needed yet
		this.children.push(c);
		return c;
	}

	/** Notifies the JS host about visibility changes. */
	setVisible(b:bool) : void {
		setVisible(this, b); // Call imported JS function
		this.isVisible = b;
	}

	/** Initiates a fade-out animation. */
	fadeOut() : void {
		this.targetOpacity = 0;
		this.zIndex = 0; // Reset zIndex when fading out
	}

	/** Initiates a fade-in animation. */
	fadeIn() : void {
		this.isReady = true; // Mark as ready
		// If this is a top-level canvas becoming fully opaque, fade out others
		if(!this.hasParent && this.currentArea.width == 1 && this.currentArea.height == 1)
			for(let i:i16=0;i<this.main.canvases.length;i++)
				if(unchecked(this.main.canvases[i]) != this)
					unchecked(this.main.canvases[i]).fadeOut();
		this.targetOpacity = 1;
	}

	/** Checks if the canvas area is currently animating. */
	areaAnimating() : bool {
		return !this.areaAniPaused && this.areaAniPerc < 1;
	}

	/** Checks if the canvas is effectively hidden (zero opacity or zero size). */
	isHidden() : bool {
		return (this.targetOpacity == 0 && this.opacity == 0)
			|| (this.currentArea.width == 0 || this.currentArea.height == 0);
	}



	/**
	 * Calculates the min/max view bounds for 360 canvases.
	 * This is used by embed visibility detection and should be called once per frame.
	 * For non-360 canvases, this sets the bounds to the logical view coordinates.
	 */
	private calculateViewBounds() : void {
		if(this.is360) {
			// For 360, use logical view bounds directly instead of screen sampling
			// Screen sampling can give overly wide ranges due to 360 projection
			const v = this.view;
			
			// Store legacy bounds (use logical view)
			this.minViewX = v.x0;
			this.maxViewX = v.x1;
			this.minViewY = v.y0;
			this.maxViewY = v.y1;
			
			// Calculate viewport-style bounds from logical view
			this.viewCenterX = v.centerX;
			this.viewCenterY = v.centerY;
			this.viewWidth = v.width;
			this.viewHeight = v.height;
			

		} else {
			// For 2D canvases, use the logical view coordinates
			this.minViewX = this.view.x0;
			this.maxViewX = this.view.x1;
			this.minViewY = this.view.y0;
			this.maxViewY = this.view.y1;
			
			// Viewport style for 2D
			this.viewCenterX = this.view.centerX;
			this.viewCenterY = this.view.centerY;
			this.viewWidth = this.view.width;
			this.viewHeight = this.view.height;
		}
	}

	/** Determines if the canvas needs to be drawn in the next frame and calculates tiles needed. */
	shouldDraw() : void {
		// --- Visibility Check ---
		// If not animating area and effectively hidden, ensure JS knows it's not visible and exit
		if(!this.areaAnimating() && this.isHidden()) {
			if(this.isVisible) this.setVisible(false);
			return;
		}

		// If becoming visible (opacity >= 1), ensure JS knows
		if(!this.isVisible && this.opacity >= 1) this.setVisible(true);

		// --- Animation Step ---
		// Step camera animation and kinetic movement, check if still animating
		let animating: bool = this.ani.step(this.main.now) < 1
			|| this.kinetic.step(this.main.now) < 1 || !this.isReady;

		// Clear the list of tiles to draw for this frame
		this.toDraw.length = 0;

		// --- Area Animation & Viewport Calculation ---
		// Step area animation (for grids) and update screen viewport (el)
		if(this.partialView(false)) animating = true; // partialView returns true if area is animating

		// --- Culling ---
		// If the calculated visible portion is outside the screen, exit (no need to calculate tiles)
		if(!this.is360 && (this.visible.width <= 0 || this.visible.height <= 0)) return; // Use <= 0 for safety

		// --- Calculate View Bounds ---
		// Calculate view bounds once per frame for embed visibility detection
		this.calculateViewBounds();
		
		// --- Calculate 3D Frustum ---
		// Calculate 3D camera frustum for accurate 360 embed detection
		this.webgl.calculate3DFrustum();

		// --- Opacity Animation ---
		// Step opacity fade animation if needed
		if(this.isReady && this.opacity != this.targetOpacity) {
			// Calculate opacity change based on duration and frame time
			const fadeDuration = this.main.distanceX != 0 || this.main.distanceY != 0 ? this.main.spacesTransitionDuration
				// If first image, always .25s
				: this.main.canvases.length == 1 ? .25
				: this.main.crossfadeDuration;
			const delta:f64 = (1/fadeDuration)/this.main.frameTime;
			const fadingIn:bool = this.targetOpacity > 0 && this.targetOpacity >= this.opacity;
			this.opacity = fadingIn ? min(1, this.opacity + delta) : max(0, this.opacity - delta);
			this.bOpacity = easeInOut.get(this.opacity); // Calculate eased opacity for rendering

			// --- 360 Transition Movement ---
			// If moving between 360 spaces, apply translation based on opacity
			if(this.main.distanceX != 0 || this.main.distanceY != 0) {
				// If fading in, find the fading out canvas to get its yaw for smooth rotation transition
				if(fadingIn) {
					for(let i=0;i<this.main.canvases.length;i++) {
						const c = unchecked(this.main.canvases[i]);
						if(c != this && c.targetOpacity == 0 && c.opacity > 0) { // Find the one fading out
							break;
						}
					}
				}
				// Calculate translation factor based on eased opacity
				const fact:f64 = this.opacity == 0 ? 0 : easeInOut.get(1 - this.opacity) * (fadingIn ? 1 : -1);
				// Apply translation and rotation offset
				this.webgl.moveTo(
					this.main.distanceX * fact * base360Distance,
					this.main.distanceY * fact * base360Distance,
					this.main.direction,
					0);
			}
			animating = true; // Mark as animating if fading
		}

		// --- Tile Calculation ---
		// Get current scale (perspective for 360, camera scale for 2D) adjusted by element scale
		const scale:f64 = (this.is360 ? this.webgl.scale : this.camera.scale) * this.el.scale;

		// Iterate through associated images to calculate needed tiles
		for(let i:i32=0;i<this.images.length;i++) {
			const image = unchecked(this.images[i]);
			// Check if image should be rendered (visible, within scale limits, etc.)
			if(!image.shouldRender()) {
				// If it was rendering previously, notify JS to hide it
				if(image.doRender) setVisible2(image, image.doRender = false);
			}
			else { // Image should be rendered
				// If it wasn't rendering previously, notify JS to show it (for embeds)
				if(i > 0 && !image.doRender) setVisible2(image, image.doRender = true);
				// If it's a playing video embed, ensure main loop continues
				if(image.isVideo && image.isVideoPlaying) animating = true;
				// Step image-specific opacity animation (for gallery switches/embeds)
				if(image.opacityTick(this.isGallerySwitch || this.opacity < 1)) animating = true;
				// If image is visible, calculate and add its required tiles to the `toDraw` list
				if(image.opacity > 0) this.main.doneTotal += image.getTiles(scale); // getTiles adds to this.toDraw
			}
		}

		// --- Update Progress ---
		this.main.toDrawTotal += <f32>this.toDraw.length; // Add count of needed tiles to global total
		// Calculate overall loading progress
		this.main.progress = this.main.toDrawTotal == 0 ? 1
			: this.main.doneTotal / this.main.toDrawTotal;

		// --- Update View Array ---
		// Store the final calculated view coordinates in the shared array
		this.view.toArray();

		// --- Process Children ---
		// Recursively call shouldDraw for child canvases (grids)
		for(let i:i32=0;i<this.children.length;i++)
			unchecked(this.children[i]).shouldDraw();

		// Mark main loop as needing continuation if any animation is happening
		if(animating) this.main.animating = true;
	}

	/** Executes the drawing commands for the current frame for this canvas. */
	draw() : void {
		// Skip drawing if canvas is completely hidden
		if(this.targetOpacity == 0 && this.opacity == 0) return;

		const animating = this.ani.isStarted(); // Check if a camera animation is running

		// Set the WebGL viewport to this canvas's screen area
		setViewport(this.el.left, this.main.el.height - this.el.height - this.el.top, this.el.width, this.el.height);

		// Set the projection/view matrix for this canvas
		setMatrix(this.webgl.pMatrix.arr);

		// Draw background quad for gallery pages if needed
		if(this.pagesHaveBackground) for(let imgIdx:i32=0;imgIdx<this.images.length;imgIdx++) {
			const im = unchecked(this.images[imgIdx]);
			// Check if image overlaps with the current view before drawing background
			if(!(im.x1 <= this.view.x0 || im.x0 >= this.view.x1 || im.y1 <= this.view.y0 || im.y0 >= this.view.y1)) {
				this.setTile(im.endOffset-1); // Set context to the base tile of the image
				drawQuad(im.tOpacity); // Call JS to draw a quad with image's target opacity
			}
		}

		// Iterate through the list of tiles calculated in shouldDraw
		const r = this.rect; // Use reusable DrawRect object
		for(let j:i32=0;j<this.toDraw.length;j++) {
			const i:u32 = unchecked(this.toDraw[j]); // Global tile index
			this.setTile(i); // Calculate tile position and update `r` (this.rect)

			// Determine if this tile is on one of the two highest-resolution layers needed
			const isTargetLayer = r.layer == r.image.targetLayer - 1 || (!this.main.bareBone && r.layer == r.image.targetLayer);
			// Check if it's the base layer tile (lowest resolution)
			const isBaseTile = i == r.image.endOffset - 1;
			// Get the tile's current opacity (managed by JS for loading/fading)
			const opa = getTileOpacity(i);

			// Request JS to draw the tile if:
			// - It's on a target layer OR already loaded (opa==1) OR it's the base tile
			// - AND the drawTile call returns true (meaning it was drawn or already present)
			// - AND if it was the base tile, mark the canvas as ready (fadeIn)
			if((isTargetLayer || opa == 1 || isBaseTile) && drawTile(r.image.index, i, r.layer,
				r.x, r.y, opa * this.bOpacity * r.image.opacity, animating, r.layer == r.image.targetLayer - 1)
				&& isBaseTile) {
					r.image.gotBase = this.main.now; // Mark base tile loaded time
					if(!this.isReady) this.fadeIn(); // Trigger fade-in if not already ready
				}
		}

		// Draw child canvases, sorted by zIndex
		this.children.sort((a, b) => a.zIndex>b.zIndex?1:a.zIndex<b.zIndex?-1:0);
		for(let i:i32=0;i<this.children.length;i++)
			unchecked(this.children[i]).draw();

		// Notify JS if the view has changed during this frame's calculations
		if(this.view.changed) viewSet(this);
		this.view.changed = false; // Reset change flag
	}

	/**
	 * Handles the logic for calculating the visible portion of the canvas,
	 * especially when it's a child canvas within a parent (grid layout).
	 * Updates the canvas's screen viewport (`el`) and visible view (`visible`).
	 * Also steps the area animation if active.
	 * @param noDispatch If true, suppress sending viewport updates to JS.
	 * @returns True if the area is currently animating.
	 */
	private partialView(noDispatch:bool) : bool {
		const c = this.main.el; // Main element viewport
		const hP = this.hasParent; // Has parent canvas?
		// Scale factor: parent's scale if child, otherwise inverse of main DPR
		const s = hP ? this.parent.getScale() : 1 / c.ratio;
		// Parent dimensions or main element dimensions
		const pW = hP ? this.parent.width : c.width;
		const pH = hP ? this.parent.height : c.height;
		// Parent view or the full [0,0,1,1] view
		const pV = hP ? this.parent.view : this.full;
		const v = this.view; // This canvas's logical view
		const a = this.currentArea; // Current animated area within parent
		const b = this.area; // Starting area for animation
		const t = this.targetArea; // Target area for animation

		const animating = this.areaAnimating(); // Check if area animation is running

		// --- Step Area Animation ---
		if(animating) {
			// Calculate progress delta based on duration and frame time
			const delta:f64 = (1/this.main.gridTransitionDuration)/this.main.frameTime;
			this.areaAniPerc = min(1, this.areaAniPerc+delta); // Increment progress
			// Apply easing function
			const p = this.main.gridTransitionTimingFunction.get(this.areaAniPerc);
			// Interpolate currentArea between starting (b) and target (t) area
			const interpCenterX = (b.centerX + (t.centerX - b.centerX) * p);
			const interpCenterY = (b.centerY + (t.centerY - b.centerY) * p);
			const interpWidth = (b.width + (t.width - b.width) * p);
			const interpHeight = (b.height + (t.height - b.height) * p);
			a.set(interpCenterX, interpCenterY, interpWidth, interpHeight);
			// If animation finished
			if(this.areaAniPerc == 1) {
				if(this.zIndex == 1) this.zIndex = 0; // Reset zIndex if it was raised for transition
				b.copy(t); // Snap starting area to target area
			}
			this.view.changed = true; // Mark view as potentially changed due to area animation
		}

		// --- Calculate Visible View Rectangle ---
		// Determine the intersection of the logical view (v) and the portion of the parent's view (pV)
		// that corresponds to the current animated area (a) of this canvas.
		let visX0 = max(v.x0, v.x0 + (pV.x0 - a.x0) / a.width * v.width);
		let visX1 = min(v.x1, v.x0 + (1 - (a.x1 - min(a.x1, pV.x1)) / a.width) * v.width);
		// Clamp horizontal coordinates for non-360 canvases
		if(!this.is360) {
			visX0 = max(0, visX0);
			visX1 = min(1, visX1);
		}
		let visY0 = max(max(0, v.y0), v.y0 + (pV.y0 - a.y0) / a.height * v.height);
		let visY1 = min(min(1, v.y1), v.y0 + (1 - (a.y1 - min(a.y1, pV.y1)) / a.height) * v.height);
		visY0 = max(visY0, 0);
		visY1 = min(visY1, 1);

		// Compute centers and sizes for new model
		const visCenterX = (visX0 + visX1) / 2;
		const visCenterY = (visY0 + visY1) / 2;
		const visWidth = visX1 - visX0;
		const visHeight = visY1 - visY0;

		// Set visible using new model
		this.visible.set(visCenterX, visCenterY, visWidth, visHeight);

		// --- Update Screen Viewport (el) ---
		const ratio = hP ? 1 : c.ratio; // Use DPR only for top-level canvas
		const fadingOut = this.targetOpacity < this.opacity;
		// Update the screen viewport (el) based on the current animated area (a), parent scale (s),
		// parent dimensions (pW, pH), parent view offset (pV), and DPR (ratio).
		// The `el.set` method returns true if the viewport actually changed.
		if(!fadingOut && this.el.set(
			a.width * s * pW, 						// Screen width
			a.height * s * pH, 						// Screen height
			(a.x0 - pV.x0) * pW * s, 				// Screen left
			(a.y0 - pV.y0) * pH * s, 				// Screen top
			ratio, 									// Device pixel ratio
			hP ? 1 : c.scale, 						// Global scale factor (only for top-level)
			hP ? false : c.isPortrait				// Portrait flag (only for top-level)
		)) {
			// If the screen viewport changed, notify JS (unless suppressed),
			// mark view as changed, trigger resize calculations, and update camera/webgl state.
			if(!noDispatch) this.sendViewport();
			this.view.changed = true;
			this.resize();
			this.camera.setCanvas();
			this.webgl.update();
		}

		return animating; // Return whether the area was animating this frame
	}

	/** Sets the target area for this canvas within its parent, optionally animating. */
	setArea(x0: f64, y0: f64, x1: f64, y1: f64, direct:bool, noDispatch:bool) : void {
		this.areaAniPaused = false; // Ensure animation is not paused
		if(direct) { // Set area immediately
			this.area.setArea(x0, y0, x1, y1);
			this.currentArea.setArea(x0, y0, x1, y1);
		}
		else { // Start animation
			this.areaAniPerc = 0; // Reset progress
			if(this.zIndex == 0) this.zIndex = 1; // Raise zIndex for transition if needed
			this.ani.limit = false; // Disable view limits during area animation
		}
		// Set the target area
		this.targetArea.setArea(x0, y0, x1, y1);
		// Trigger initial calculation/step
		this.partialView(noDispatch);
	}

	/** Calculates the vertex positions for a given tile index and updates the vertex buffer. */
	private setTile(i:u32) : void {
		const r = this.rect; this.findTileRect(i); // Find image/layer/coords for tile `i` and store in `r`
		if(this.is360) {
			// For 360, either set sphere segment geometry (main image) or calculate embed matrix
			if(r.image.localIdx == 0) this.webgl.setTile360(r.x0, r.y0,r.x1-r.x0,r.y1-r.y0);
			else r.image.setDrawRect(r); // Calculate transformation for 360 embed
		}
		else { // For 2D, set the vertex buffer for a simple quad
			const v = this.main.vertexBuffer, a:f32 = <f32>this.aspect;
			// Calculate vertex positions based on tile rect and aspect ratio
			// Vertices are ordered for two triangles: (0,1,2) and (2,3,0)
			// Coords are relative to center (-0.5 to 0.5), adjusted by aspect ratio for X
			unchecked(v[0] = v[3] = v[9] = ((<f32>r.x0-.5) * a)); // Top-Left X, Bottom-Left X (Vert 0, 1)
			unchecked(v[1] = v[7] = v[16] = (.5-<f32>r.y0));      // Top-Left Y, Top-Right Y (Vert 0, 2)
			unchecked(v[4] = v[10] = v[13] = (.5-<f32>r.y1));     // Bottom-Left Y, Bottom-Right Y (Vert 1, 3)
			unchecked(v[6] = v[12] = v[15] = (<f32>r.x1-.5) * a); // Top-Right X, Bottom-Right X (Vert 2, 3)
			// Optional Z component for grid transitions (commented out)
			//if(this.parent && this.main.gridTransitionDuration > 0) unchecked(v[2] = v[5] = v[8] = v[11] = v[14] = v[17] = (<f32>this.bOpacity - 1)*.25);
		}
	}

	/** Notifies JS host about the current screen viewport details. */
	sendViewport() : void {
		const c = this.main.el;
		// Send viewport details adjusted by device pixel ratio
		viewportSet(this, this.el.left/c.ratio, this.el.top/c.ratio, this.el.width/c.ratio, this.el.height/c.ratio);
	}

	/** Finds the Image, Layer, and calculates the DrawRect for a given global tile index. */
	private findTileRect(i:u32) : void {
		// Find which Image this tile belongs to by checking end offsets
		let img:i32=0; while(i >= unchecked(this.images[img].endOffset)) img++;
		const image = unchecked(this.images[img]);

		// Find which Layer within that Image this tile belongs to
		let l:u32=0; while(i >= unchecked(image.layers[l]).end) l++;
		const layer = unchecked(image.layers[l]);

		// Calculate the tile's rectangle and store it in this.rect
		layer.getTileRect(i, this.rect);
	}

	/** Handles resizing of the canvas element. */
	resize() : void {
		// If this is a grid container, resize internal dimensions to match main element
		if(this.children.length) {
			const c = this.main.el;
			this.width = c.width;
			this.height = c.height;
		}
		// If this is a top-level canvas
		if(!this.hasParent) {
			if(this.is360) this.webgl.resize(); // Trigger 360-specific resize logic
			else { // Trigger 2D resize logic
				this.camera.setCanvas(); // Recalculate camera scale limits
				this.webgl.update();     // Update projection matrix (though likely identity for 2D)
			}
		}
	}

	/** Resets the canvas state (stops animations, clears base tile loaded status). */
	reset() : void {
		this.kinetic.stop();
		this.ani.stop();
		if (this.images.length > 0) {
			const mainImage = unchecked(this.images[0]);
			mainImage.gotBase = 0; // Reset flag indicating base layer is loaded
			mainImage.opacity = 0; // Reset opacity? Seems aggressive, might cause flicker.
		}
	}

	/** Removes this canvas instance from the main controller. */
	remove() : void {
		this.setVisible(false); // Ensure JS knows it's hidden
		this.main.remove(this); // Call main controller's remove method
	}

	/** Re-adds this canvas instance to the main controller (used after removal?). */
	replace() : void {
		this.main.canvases.push(this);
	}

	// --- Gallery/Omni Specific Methods ---

	/** Sets the active layer for multi-layer omni objects. */
	setActiveLayer(idx:i32) : void {
		this.layer = idx;
		// Update active image based on the new layer
		this.setActiveImage(this.activeImageIdx, 0);
		this.view.changed = true; // Mark view as changed to trigger updates
	}

	/** Sets the active image(s) for gallery/omni canvases. */
	setActiveImage(idx:i32, num:i32) : void { // num = number of adjacent images to also show (for spreads)
		const offset = this.layer * (this.images.length / this.omniNumLayers); // Calculate offset for current layer
		for(let i=0;i<this.images.length;i++) {
			const im = unchecked(this.images[i]);
			const diff = i-offset-idx; // Difference from target index within the layer
			// Set target opacity based on whether it's the active image or adjacent (for spreads)
			if(diff != 0) im.tOpacity = diff>=0 && diff <= num ? 1 : 0;
			else { // This is the target active image
				im.tOpacity = 1;
				this.activeImageIdx = idx;
				this.view.changed = true; // Mark view changed as active image affects rendering
			}
		}
		this.camera.correctMinMax(); // Recalculate scale limits based on new active image(s)
	}

	/** Sets the focus area for gallery/grid canvases. */
	setFocus(x0:f64, y0:f64, x1:f64, y1:f64, noLimit:bool) : void {
		const centerX = (x0 + x1) / 2;
		const centerY = (y0 + y1) / 2;
		const width = x1 - x0;
		const height = y1 - y0;

		if(this.focus.equals(centerX, centerY, width, height)) return;
		this.activeImageIdx = -1;
		for(let i=0;i<this.images.length;i++) {
			const im = unchecked(this.images[i]);
			if(im.x1 <= x0 || im.x0 >= x1 || im.y1 <= y0 || im.y0 >= y1) im.tOpacity = 0;
			else { im.tOpacity = 1; this.activeImageIdx = i; }
		}
		this.focus.set(centerX, centerY, width, height);
		this.camera.correctMinMax();
		if(!noLimit) {
			this.camera.setView();
			this.webgl.update();
		}
	}

	// --- Unified View/Coordinate Accessors ---

	/** Gets image coordinates from screen coordinates (delegates to Camera or WebGL). */
	getCoo(x: f64, y: f64, abs: bool, noLimit: bool) : Float64Array {
		return (this.is360 ? this.webgl.getCoo(x,y) : this.camera.getCoo(x, y, abs, noLimit)).toArray()
	}

	/** Gets screen coordinates from image coordinates (delegates to Camera or WebGL). */
	getXY(x: f64, y: f64, abs: bool, radius:f64, rotation:f64) : Float64Array {
		return (this.is360 ? this.webgl.getXYZ(x,y) : !isNaN(radius) ? this.camera.getXYOmni(x, y, radius, isNaN(rotation) ? 0 : rotation, abs) : this.camera.getXY(x, y, abs)).toArray()
	}

	/** Gets the current logical view array. */
	getView() : Float64Array { return this.view.arr }
	/** Sets the logical view directly. */
	setView(centerX: f64, centerY: f64, width: f64, height: f64, noLimit: bool, noLastView: bool, correctNorth: bool = false, forceLimit: bool = false) : void {
		const mE = this.main.el;

		// Adjust target if partial area (update to centers)
		if(mE.areaHeight > 0) { height += height / (1-(mE.areaHeight / mE.height)); this.ani.limit = false; mE.areaHeight = 0; };
		if(mE.areaWidth > 0) { width += width * (mE.areaWidth / mE.width); this.ani.limit = false; mE.areaWidth = 0; };
		if(noLimit) this.ani.limit = false;

		this.view.set(centerX, centerY, width, height);
		if(forceLimit && !noLimit) this.view.limit(false, false, this.freeMove);
		if(!noLastView) this.ani.lastView.copy(this.view);

		if(this.width > 0) {
			if(this.is360) {
				this.webgl.setView(centerX, centerY, width, height, noLimit, correctNorth);
				this.view.set(centerX, centerY, width, height); // Sync
			} else if(this.camera.setView()) {
				this.webgl.update();
			}
		}
	}

	// --- Unified Camera Accessors ---

	/** Gets the current effective scale (delegates to Camera or WebGL). */
	getScale() : f64 { return this.is360 ? this.webgl.scale : this.camera.scale }
	/** Checks if fully zoomed in (delegates to Camera or WebGL). */
	isZoomedIn() : bool { return this.is360 ? this.webgl.perspective <= this.webgl.minPerspective : this.camera.isZoomedIn() }
	/** Checks if fully zoomed out (delegates to Camera or WebGL). */
	isZoomedOut(b:bool = false) : bool { return this.is360 ? this.webgl.perspective >= this.webgl.maxPerspective : this.camera.isZoomedOut(b) }

	// --- 360 Specific Wrappers ---

	/** Sets the 360 viewing direction (delegates to WebGL). */
	setDirection(yaw: f64, pitch: f64, resetPersp: bool) : void {
		if(isNaN(pitch)) pitch = this.webgl.pitch; // Use current pitch if not provided
		this.webgl.setDirection(yaw, pitch, resetPersp ? this.webgl.defaultPerspective : 0);
	}
	/** Gets the transformation matrix for a 360 embed (delegates to WebGL). */
	getMatrix(x:f64,y:f64,s:f64,r:f64,rX:f64,rY:f64, rZ:f64,t:f64,sX:f64=1,sY:f64=1, noCorrectNorth: bool = false) : Float32Array {
		// Adjust scale factor based on canvas width? Seems odd.
		const fact:f64 = <f64>20000/this.width;
		return this.webgl.getMatrix(x,y,s*fact,r,rX,rY,rZ,t,sX,sY, noCorrectNorth).toArray()
	}

	// --- Animation Wrappers ---

	/** Pauses animations for this canvas and its area animation. */
	aniPause(time: f64) : void {
		this.areaAniPaused = true;
		this.ani.pause(time);
	};
	/** Resumes animations for this canvas and its area animation. */
	aniResume(time: f64) : void {
		this.areaAniPaused = false;
		this.ani.resume(time);
	};
	/** Stops animations for this canvas and all its children. */
	aniStop() : void {
		this.ani.stop();
		this.children.forEach(c => { c.aniStop() });
	}
}
