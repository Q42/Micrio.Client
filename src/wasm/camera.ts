import { Coordinates, PI } from './shared'
import Canvas from './canvas'
import { longitudeDistance } from './utils';

/** Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch. */
export default class Camera {
	/** Current effective scale factor (combining base scale and zoom). */
	scale : f64 = 1.0;
	/** Minimum allowed scale factor (based on contain/cover and limits). */
	minScale : f64 = 1.0;
	/** Minimum screen size factor (0-1, allows zooming out with margins). */
	minSize : f64 = 1.0;
	/** Maximum allowed scale factor (based on image resolution and settings). */
	maxScale : f64 = 1.0;
	/** Scale factor required to fit the entire image within the viewport (contain). */
	fullScale : f64 = 1.0;
	/** Scale factor required to cover the entire viewport with the image. */
	coverScale : f64 = 1.0;

	// --- Internal State ---
	/** Reusable Coordinates object for getXY calculations. */
	private readonly xy : Coordinates = new Coordinates;
	/** Reusable Coordinates object for getCoo calculations. */
	private readonly coo : Coordinates = new Coordinates;
	/** Stores initial coordinates if set before camera is fully initialized. */
	private readonly startCoo : Coordinates = new Coordinates;

	/** Flag indicating if a pinch gesture is currently active. */
	private pinching : bool = false;
	/** Flag indicating if the camera has been initialized. */
	private inited : bool = false;
	/** Flag indicating if initial coordinates need to be applied on first setView. */
	private hasStartCoo : bool = false;
	/** Cached ratio of canvas element width to image width. */
	cpw : f64 = -1;
	/** Cached ratio of canvas element height to image height. */
	cph : f64 = -1;
	/** Cached coverLimit state to detect changes. */
	private wasCoverLimit : bool = true;

	constructor(
		private canvas: Canvas
	) {
		// 360 cameras are handled by WebGL, consider initialized immediately
		if(canvas.is360) this.inited = true;
	}

	/**
	 * Converts screen pixel coordinates to relative image coordinates [0-1].
	 * @param x Screen X coordinate.
	 * @param y Screen Y coordinate.
	 * @param abs If true, x/y are absolute window coordinates.
	 * @param noLimit If true, allows coordinates outside image bounds [0-1] and limits.
	 * @returns A Coordinates object containing the calculated image coordinates (x, y) and current scale.
	 */
	getCoo(x: f64, y: f64, abs: bool, noLimit: bool) : Coordinates {
		const c = this.canvas;
		// Always allow unlimited coordinates if freeMove is enabled or it's a virtual canvas
		if(c.noImage || c.freeMove)
			noLimit = true;

		const el = c.el; // Canvas element viewport
		// Use parent's ratio if this is a child canvas (grid item)
		const r = c.hasParent ? c.parent.el.ratio : el.ratio;

		// Adjust coordinates if absolute window coordinates are provided
		if(abs) {
			x -= el.left;
			y -= el.top;
		}

		// Calculate relative image coordinates based on screen position, scale, ratio, and current view offset
		const rX = (x / this.scale * r) / c.width + c.view.x0;
		const rY = (y / this.scale * r) / c.height + c.view.y0;

		// Apply limits unless noLimit is true
		this.coo.x = noLimit ? rX : max(c.view.lX0, min(c.view.lX1, rX));
		this.coo.y = noLimit ? rY : max(c.view.lY0, min(c.view.lY1, rY));
		this.coo.scale = this.scale; // Include current scale in the result

		return this.coo;
	}

	/**
	 * Converts relative image coordinates [0-1] to screen pixel coordinates.
	 * @param x Relative image X coordinate.
	 * @param y Relative image Y coordinate.
	 * @param abs If true, return absolute window coordinates instead of relative to the canvas element.
	 * @returns A Coordinates object containing the calculated screen coordinates (x, y) and screen scale.
	 */
	getXY(x: f64, y: f64, abs: bool) : Coordinates {
		const c = this.canvas;
		const el = c.el;
		const rat = c.hasParent ? c.parent.el.ratio : el.ratio; // Device pixel ratio
		// Calculate screen coordinates based on image position, view offset, scale, ratio, and element offset (if abs)
		this.xy.x = ((x - c.view.x0) * c.width) * this.scale / rat + (abs ? el.left : 0);
		this.xy.y = ((y - c.view.y0) * c.height) * this.scale / rat + (abs ? el.top : 0);
		this.xy.scale = this.scale / rat; // Screen scale
		return this.xy;
	}

	/**
	 * Helper for getXYOmniCoo, adjusting coordinates to be relative to center (0,0).
	 */
	getXYOmni(x: f64, y: f64, radius:f64, rotation:f64, abs: bool) : Coordinates {
		// Convert [0-1] coordinates to [-0.5 - 0.5] relative to center
		return this.getXYOmniCoo(x-.5, y-.5, radius, rotation, abs);
	}

	/**
	 * Converts 3D coordinates relative to an omni object's center to screen pixel coordinates.
	 * @param x X coordinate relative to object center.
	 * @param y Y coordinate relative to object center.
	 * @param z Z coordinate (radius/depth) relative to object center.
	 * @param rotation Additional rotation offset in radians.
	 * @param abs If true, return absolute window coordinates.
	 * @returns A Coordinates object containing the calculated screen coordinates (x, y) and depth (w).
	 */
	getXYOmniCoo(x: f64, y: f64, z:f64, rotation:f64, abs:bool) : Coordinates {
		const c = this.canvas;
		const el = c.el;
		const mat = c.webgl.pMatrix, vec4 = c.webgl.vec4; // Use WebGL matrix/vector objects
		const rat = c.hasParent ? c.parent.el.ratio : el.ratio;

		// Set up input vector
		vec4.x = x;
		vec4.y = y;
		vec4.z = z;
		vec4.w = 1;

		// --- Apply Transformations ---
		mat.identity(); // Start with identity matrix

		// Apply perspective if calculating relative screen coordinates
		if(!abs && c.omniFieldOfView) mat.perspective(c.omniFieldOfView, c.aspect, 0.0001, 100);
		// Apply camera distance
		if(c.omniDistance) mat.translate(0,0,c.omniDistance);
		// Apply horizontal offset
		if(c.omniOffsetX) mat.translate(c.omniOffsetX, 0, 0);
		// Apply vertical camera angle if calculating relative screen coordinates
		if(!abs && c.omniVerticalAngle) mat.rotateX(c.omniVerticalAngle);

		// Apply current object rotation based on active frame/layer
		const numPerLayer = c.images.length / c.omniNumLayers;
		const offset = c.layer * numPerLayer;
		const currRot = (c.images.length > 0 ? -(<f64>(c.activeImageIdx+1-offset) / (numPerLayer)) * 2 * PI : 0);
		mat.rotateY(rotation + currRot); // Add requested rotation offset

		// Transform the input vector
		vec4.transformMat4(mat);

		// --- Convert Transformed Vector to Screen Coordinates ---
		// Project normalized device coordinates (-1 to 1) to screen pixels
		this.xy.x = ((.5 + vec4.x - c.view.x0) * c.width) * this.scale / rat + (abs ? el.left : 0);
		this.xy.y = ((.5 + vec4.y - c.view.y0) * c.height) * this.scale / rat + (abs ? el.top : 0);
		// Store depth information (w component) adjusted by camera distance
		this.xy.w = -vec4.w-c.omniDistance;
		return this.xy;
	}

	/** Recalculates scale limits (minScale, maxScale, coverScale, fullScale) based on current canvas and image dimensions. */
	setCanvas() : void {
		const c = this.canvas;
		const el = c.el; // Canvas element viewport

		// Calculate ratios of element dimensions to image dimensions
		const cpw = el.width / c.width;
		const cph = el.height / c.height;

		// If dimensions/limits haven't changed significantly, only check coverLimit change
		if(!c.view.limitChanged && this.cpw == cpw && this.cph == cph) {
			if(c.coverLimit != this.wasCoverLimit) this.correctMinMax(); // Recalculate if coverLimit changed
			return;
		}

		// Cache new ratios
		this.cpw = cpw;
		this.cph = cph;

		// Calculate base scales for contain (fullScale) and cover (coverScale)
		this.fullScale = min(cpw, cph);
		this.coverScale = max(cpw, cph);

		// Adjust coverScale if view limits are smaller than the image
		const lRat = c.view.lWidth / c.view.lHeight; // Aspect ratio of the limit box
		c.view.limitChanged = false; // Reset flag
		if(c.view.lWidth < 1 || c.view.lHeight < 1) { // If limits are active
			const rat = cpw / cph; // Aspect ratio of the canvas element
			// Adjust cover scale based on the limiting dimension relative to aspect ratios
			if(lRat < rat) this.coverScale /= c.view.lWidth / rat;
			else this.coverScale /= c.view.lHeight * rat;
		}

		// Recalculate min/max scales based on new base scales
		this.correctMinMax();

		// If initialized and not animating, re-apply the last known view to adjust for resize
		if(el.width && el.height && !this.canvas.ani.isStarted()) {
			c.view.copy(c.ani.lastView, true); // Restore last animated view
			if(!c.is360) { // Only apply for 2D
				const pLimit = c.ani.limit; // Preserve animation limit flag
				c.ani.limit = false; // Temporarily disable limits for setView
				this.setView(); // Re-calculate scale and position based on restored view
				c.ani.limit = pLimit; // Restore animation limit flag
			}
		}
	}

	/** Corrects minScale and maxScale based on coverLimit and focus area. */
	correctMinMax(noLimit:bool=false) : void {
		const c = this.canvas;
		// Set base minScale based on coverLimit setting
		this.minScale = c.coverLimit ? this.coverScale : this.fullScale;

		// Adjust minScale further if a focus area is set (used in galleries/grids)
		// and not in swipe mode or coverLimit is off for the main image.
		if(!noLimit && !c.main.isSwipe && (c.activeImageIdx == 0 && !c.coverLimit || c.activeImageIdx > 0)) {
			const aW = c.focus.width * c.width, aH = c.focus.height * c.height; // Focus area dimensions
			const cW = c.el.width, cH = c.el.height; // Canvas element dimensions
			// Calculate scale needed to fit the focus area, constrained by canvas aspect ratio
			this.minScale = cW / cH > aW / aH ? cH / aH : cW / aW;
		}

		// Calculate maxScale based on settings, ensuring it's at least minScale
		this.maxScale = this.minScale > 1 ? this.minScale : max(this.minScale, c.maxScale / c.el.scale); // c.maxScale is from settings (e.g., 1 for 100%)
		this.wasCoverLimit = c.coverLimit; // Cache coverLimit state
	}

	/** Checks if the current scale is below the minimum allowed scale (considering minSize margin). */
	isUnderZoom() : bool { return this.minSize < 1 && this.scale < this.minScale };
	/** Checks if the camera is fully zoomed out (at or below minScale, considering minSize margin). */
	isZoomedOut(b:bool = false) : bool { return <i32>((this.scale-this.minScale*(b ? this.minSize : 1))*1E6)/1E6 <= 0; }
	/** Checks if the camera is fully zoomed in (at or above maxScale). */
	isZoomedIn() : bool { return <f32>(this.scale / this.maxScale) >= 1; }

	// --- Camera Actions ---

	/**
	 * Calculates and sets the current camera scale and view offsets based on the logical view rectangle.
	 * This is the core function translating the logical view into the effective scale and position.
	 * @returns True if the view was successfully set, false if initialization is pending.
	 */
	setView() : bool {
		// Don't proceed if canvas dimensions are not yet known
		if(this.cpw == -1) return false;
		const c = this.canvas;
		const v = this.canvas.view; // The logical view rectangle

		// Determine if view limits should be applied during this calculation
		const limited = !c.freeMove && c.ani.limit;

		// Apply limits if needed (and not correcting after animation or pinch)
		// Also apply if coverLimit is enabled and not flying (prevents panning outside bounds when covered)
		if(!c.ani.correcting && (limited || (!c.ani.flying && c.coverLimit))) v.limit(false); // Limit view bounds, but don't correct zoom yet

		const vw:f64 = v.width; // Logical view width
		const vh:f64 = v.height; // Logical view height
		const cw = this.cpw; // Ratio: canvas_width / image_width
		const ch = this.cph; // Ratio: canvas_height / image_height

		// Calculate the scale required to fit the logical view into the canvas element
		// min = contain (fit entire view), max = cover (fill entire element)
		// During pinching, don't cap to allow temporary overzooming
		if (this.pinching || c.ani.correcting) {
			this.scale = min(cw / vw, ch / vh);
		} else {
			this.scale = min(min(this.maxScale, cw / vw), min(this.maxScale, ch / vh));
		}

		// Apply max scale limit if applicable and not pinching and during animation
		if(limited && !this.pinching && this.isZoomedIn() && c.ani.flying) this.scale = this.maxScale;

		// Apply min scale limit if applicable (considering minSize margin) or if coverLimit is on
		if((!c.ani.correcting && !this.pinching) || c.coverLimit) this.scale = max(this.minScale*this.minSize, this.scale);

		// Override scale if initializing with coverStart enabled
		if(!this.inited && c.coverStart) this.scale = this.coverScale;

		// Calculate the overflow needed to center the logical view within the scaled viewport
		const overflowX:f64 = (cw / this.scale - vw);
		const overflowY:f64 = (ch / this.scale - vh);

		// Apply overflow to center the view within the aspect ratio
		v.set(v.centerX, v.centerY, v.width + overflowX, v.height + overflowY);

		// Store the initial view if coverStart is enabled
		if(!this.inited && c.coverStart) this.canvas.ani.lastView.copy(v);

		// Apply final boundary limits if coverLimit is enabled and not correcting
		if(!c.ani.correcting && c.coverLimit) v.limit(false);

		// Mark as initialized if canvas dimensions are valid
		this.inited = this.cpw > 0;

		// Update the Float64Array representation of the view
		v.toArray();

		// Apply initial coordinates if they were set before initialization
		if(this.hasStartCoo) {
			this.hasStartCoo = false;
			this.setCoo(this.startCoo.x, this.startCoo.y, this.startCoo.scale, 0, 0, false, 0, 0);
			return false; // Indicate that setCoo will handle the final view update
		}
		return true; // Indicate successful view update
	}

	/** Checks if the current view extends beyond the defined limits or max scale. */
	isOutsideLimit() : bool {
		const v = this.canvas.view;
		// Check if view crosses opposite limit boundaries or exceeds max scale
		return !this.canvas.freeMove && (
			(<i32>((v.x0 - v.lX0)*1E6)/1E6 < 0 !== <i32>((v.x1 - v.lX1)*1E6)/1E6 > 0) // Crosses left AND right limit
			|| (<i32>((v.y0 - v.lY0)*1E6)/1E6 < 0 !== <i32>((v.y1 - v.lY1)*1E6)/1E6 > 0) // Crosses top AND bottom limit
			|| <i32>((this.scale - this.maxScale)*1E6)/1E6 > 0 // Exceeds max scale
		);
	}

	/**
	 * Pans the view by a given pixel delta.
	 * @param xPx Horizontal pixel delta.
	 * @param yPx Vertical pixel delta.
	 * @param duration Animation duration (0 for immediate pan).
	 * @param noLimit If true, ignore view limits during pan.
	 * @param time Current timestamp (performance.now()).
	 * @param force If true, pan even if under zoomed or pinching.
	 * @param isKinetic If true, this pan is part of kinetic movement.
	 */
	pan(xPx: f64, yPx: f64, duration: f64, noLimit: bool, time: f64, force: bool=false, isKinetic: bool = false) : void {
		// Ignore pan if under zoomed or pinching, unless forced
		if((this.isUnderZoom() || this.pinching) && !force) return;

		// Always allow unlimited panning if freeMove is enabled
		if(this.canvas.freeMove) noLimit = true;

		const c = this.canvas;
		const r = c.hasParent ? c.parent.el.ratio : c.el.ratio; // Device pixel ratio
		const v = c.view;

		// Convert pixel delta to relative image coordinate delta
		const dX : f64 = xPx / c.width / this.scale * r;
		const dY : f64 = yPx / c.height / this.scale * r;

		// Calculate new view coordinates
		const newCenterX = v.centerX + dX;
		const newCenterY = v.centerY + dY;
		const viewWidth = v.width;
		const viewHeight = v.height;

		if(this.pinching) {
			// If pinching, apply pan directly without animation or kinetic tracking
			c.view.set(newCenterX, newCenterY, viewWidth, viewHeight);
			c.setView(newCenterX, newCenterY, viewWidth, viewHeight, noLimit, false, false, false);
		} else if(!force && this.isOutsideLimit() && !isKinetic) {
			// If starting drag outside limits, animate back towards the limit
			c.ani.toView(newCenterX, newCenterY, viewWidth, viewHeight, duration || 150, 0, 0, false, false, -1, false, 0, time, !noLimit); // correct=true
		} else {
			// Stop any ongoing animation
			c.ani.stop();

			// If immediate pan (duration 0)
			if(duration == 0) {
				// Add step to kinetic tracker if not already kinetic movement
				if(!isKinetic) c.kinetic.addStep(xPx*4, yPx*4, time); // Multiply delta for more sensitivity?
				// Set view directly
				c.view.set(newCenterX, newCenterY, viewWidth, viewHeight);
				if (!noLimit) {
					c.view.limit(false, false, c.freeMove); // Apply limits, passing freeMove
				}
				c.setView(newCenterX, newCenterY, viewWidth, viewHeight, noLimit, false, false, isKinetic);
				c.view.changed = true; // Mark as changed
			} else {
				// Otherwise, start a pan animation
				c.ani.toView(newCenterX, newCenterY, viewWidth, viewHeight, duration, 0, 0, false, false, -1, false, 0, time);
			}
		}
	}

	/**
	 * Zooms the view by a given delta, centered on screen coordinates.
	 * @param delta Zoom amount (negative zooms in, positive zooms out).
	 * @param xPx Screen X coordinate for zoom center.
	 * @param yPx Screen Y coordinate for zoom center.
	 * @param duration Animation duration (0 for immediate zoom).
	 * @param noLimit If true, ignore scale limits.
	 * @param time Current timestamp (performance.now()).
	 * @returns The calculated animation duration.
	 */
	zoom(delta: f64, xPx: f64, yPx: f64, duration: f64, noLimit: bool, time: f64) : f64 {
		// Prevent zooming further in if already at max zoom (unless pinching)
		if(!this.pinching && this.isZoomedIn() && delta < 0) return 0;
		const c = this.canvas;

		// Always allow unlimited zoom if freeMove is enabled
		if(this.canvas.freeMove) noLimit = true;

		// Prevent zooming further out if already at min zoom (and minSize >= 1), unless pinching without coverLimit
		if(delta > 0 && this.isZoomedOut() && this.minSize >= 1 && (!this.pinching || c.coverLimit)) return 0;

		const el = c.el;
		const v = c.view;

		// Calculate zoom factor based on delta, element size, image size, and current scale
		const ratio : f64 = (this.cpw/this.cph); // canvas_w/img_w / canvas_h/img_h
		let fact : f64 = delta * (el.width / 512) / c.width / this.scale; // Factor for width change
		let factY : f64 = fact / ratio; // Factor for height change

		// Prevent inversion (scale becoming negative)
		if(delta < 0 && fact < -1) fact = -.9999;
		if(delta < 0 && factY < -1) factY = -.9999;

		// Determine if limits should be applied during the zoom step (only if immediate and not freeMove)
		const limit = !noLimit && !c.freeMove && c.ani.limit && duration == 0;
		const r = c.hasParent ? c.parent.el.ratio : el.ratio; // Device pixel ratio

		// Adjust screen coordinates relative to canvas element
		xPx-=el.left;
		yPx-=el.top;
		// Determine zoom center point (use center if under zoomed)
		const uZ = this.isUnderZoom();
		const pX : f64 = xPx > 0 && !uZ ? xPx / el.width * r : .5; // Relative X center (0-1)
		const pY : f64 = yPx > 0 && !uZ ? yPx / el.height * r : .5; // Relative Y center (0-1)

		// Calculate new center and sizes
		const targetCenterX = v.centerX + fact * (0.5 - pX);
		const targetCenterY = v.centerY + factY * (0.5 - pY);
		const targetWidth = v.width + fact;
		const targetHeight = v.height + factY;

		// Set animation limit flag
		c.ani.limit = limit;
		// Start the view animation
		duration = c.ani.toView(targetCenterX, targetCenterY, targetWidth, targetHeight, duration, 0, 0, false, !noLimit && !this.pinching, -1, false, 0, time, limit);
		// Store the resulting view as the last view for potential resizing adjustments
		c.ani.lastView.copy(c.view);
		// Restore animation limit flag
		c.ani.limit = !noLimit;

		return duration;
	}

	// --- Pinch Gesture State ---
	/** Previous distance between pinch fingers. */
	prevSize: f64 = -1;
	/** Previous X coordinate of pinch center. */
	prevCenterX: f64 = -1;
	/** Previous Y coordinate of pinch center. */
	prevCenterY: f64 = -1;

	/** Handles pinch gesture updates. */
	pinch(xPx1: f64, yPx1: f64, xPx2: f64, yPx2: f64) : void {
		const c = this.canvas;
		const el = c.main.el; // Use main element for coordinates

		// Calculate pinch bounding box relative to main element
		const left = (min(xPx1, xPx2) - el.left) / el.scale;
		const top = (min(yPx1, yPx2) - el.top) / el.scale;
		const right = (max(xPx1, xPx2) - el.left) / el.scale;
		const bottom = (max(yPx1, yPx2) - el.top) / el.scale;

		// Calculate pinch center and size
		const cX = left + (right - left) / 2;
		const cY = top + (bottom - top) / 2;
		const size: f64 = max(right-left , bottom-top); // Use max dimension as size proxy

		// Calculate delta from previous step
		const delta = this.prevSize - size; // Negative delta means zooming in

		// Stop kinetic movement during pinch
		c.kinetic.stop();

		// If not the first pinch step
		if(this.prevCenterX > 0) {
			// Calculate pan delta
			const dX = this.prevCenterX - cX;
			const dY = this.prevCenterY - cY;

			if(c.is360) {
				// Apply zoom and rotation directly in 360 mode
				c.webgl.zoom(delta*2, 0, 0, false, 1); // Multiply delta?
				c.webgl.rotate(dX, dY, 0, 0);
			}
			else { // 2D mode
				// Apply pan if enabled and not under zoomed
				if(!this.canvas.main.noPinchPan && this.scale > this.minScale) this.pan(dX, dY, 0, false, 0, true); // Force pan
				// Apply zoom centered on the pinch center
				this.zoom(delta * 2 * el.scale, cX, cY, 0, !this.canvas.pinchZoomOutLimit, 0); // Multiply delta? Apply limit setting.
				// Set animation limit based on setting for the zoom step
				c.ani.limit = !!this.canvas.pinchZoomOutLimit;
			}
		}
		// If first pinch step, stop any ongoing animation
		else c.ani.stop();

		// Store current values for next step calculation
		this.prevCenterX = cX;
		this.prevCenterY = cY;
		this.prevSize = size;
	}

	/** Signals the start of a pinch gesture. */
	pinchStart() : void {
		this.pinching = true;
	}

	/** Signals the end of a pinch gesture. */
	pinchStop(time: f64) : void {
		// Animate back to limits if the view is outside bounds after pinching and not freeMove
		if(!this.canvas.is360) this.snapToBounds(time);

		// Reset pinch state
		this.prevSize = -1;
		this.prevCenterX = -1;
		this.prevCenterY = -1;
		this.pinching = false;
	}

	private snapToBounds(time: f64) : void {
		if (this.canvas.freeMove) return;

		const v = this.canvas.view;
		const isOverzoomed = this.scale > this.maxScale;

		// Check if overzoomed (beyond maxScale) and calculate corrected dimensions
		const targetWidth = isOverzoomed ? this.cpw / this.maxScale : v.width;
		const targetHeight = isOverzoomed ? this.cph / this.maxScale : v.height;

		const halfW = targetWidth / 2;
		const halfH = targetHeight / 2;
		const lHalfW = v.lWidth / 2;
		const lHalfH = v.lHeight / 2;
		
		// If view is larger than limits (underzoomed), center it on the limit center
		// Otherwise, clamp the center so edges stay within limit bounds
		const targetCenterX = halfW >= lHalfW 
			? v.lCenterX 
			: max(v.lX0 + halfW, min(v.centerX, v.lX1 - halfW));
		const targetCenterY = halfH >= lHalfH 
			? v.lCenterY 
			: max(v.lY0 + halfH, min(v.centerY, v.lY1 - halfH));

		this.canvas.ani.toView(targetCenterX, targetCenterY, targetWidth, targetHeight, 150, 0, 0, false, false, -1, false, 0, time, true); // Short correction animation
	}

	/**
	 * Initiates a fly-to animation to a target view rectangle.
	 * @returns The calculated animation duration.
	 */
	flyTo(centerX: f64, centerY: f64, width: f64, height: f64, dur: f64, speed: f64, perc: f64, isJump: bool, limit: bool, limitZoom: bool, toOmniIdx: i32, noTrueNorth: bool, fn:i16, time: f64) : f64 {
		const c = this.canvas;
		const a = c.ani;
		c.kinetic.stop(); // Stop kinetic movement

		// For 360, apply smart wrapping
		let adjustedCenterX = centerX;
		if (c.is360) {
			const currentCenterX = c.view.centerX;
			const longitudeDist = longitudeDistance(currentCenterX, centerX);
			adjustedCenterX = currentCenterX + longitudeDist;
		}

		a.limit = false; // Disable limits during animation calculation
		// Call the animation controller's toView method with adjusted center
		dur = a.toView(adjustedCenterX, centerY, width, height, dur, speed, perc, isJump, limit, toOmniIdx, noTrueNorth, fn, time, limitZoom);
		a.limit = false; // Ensure limits are off during animation steps
		a.flying = true; // Set flying flag
		return dur;
	}

	/**
	 * Sets the view center and scale, optionally animating.
	 * @returns The calculated animation duration.
	 */
	setCoo(x: f64, y: f64, scale: f64, dur: f64, speed: f64, limit: bool, fn:i16, time: f64) : f64 {
		// If not initialized yet, store coordinates and trigger setView
		if(!this.inited) {
			this.hasStartCoo = true;
			this.startCoo.x = x;
			this.startCoo.y = y;
			this.startCoo.scale = scale;
			this.setView(); // Trigger initialization and view calculation
			return 0; // No animation duration yet
		}

		const c = this.canvas;
		const is360 = c.is360;

		// Use current scale if target scale is invalid (0 or NaN for 2D)
		if(scale == 0 || (!is360 && isNaN(scale))) scale = c.getScale();

		// Apply minimum scale limit for 2D
		if(!is360) scale = max(this.minScale, scale);

		// Stop kinetic movement
		c.kinetic.stop();

		// Calculate target view width and height based on scale and canvas ratios
		const w:f64 = isNaN(scale) && is360 ? c.view.width : (1/scale) * this.cpw;
		const h:f64 = isNaN(scale) && is360 ? c.view.height : (1/scale) * this.cph; // Fixed: removed incorrect 360° height factor

		// Clamp center coordinates if setting immediately (no animation) in 2D
		if(dur==0 && !is360) {
			if(x + w/2 > 1) x = 1 - w/2;
			if(x - w/2 < 0) x = w/2;
			if(y + h/2 > 1) y = 1 - h/2;
			if(y - h/2 < 0) y = h/2;
		}

		// Start the fly-to animation using calculated view bounds
		dur = c.ani.toView(x, y, w, h, dur, speed, 0, false, false, -1, true, fn, time);

		// Set animation flags
		c.ani.limit = dur==0 || limit; // Apply limit only if immediate or requested
		c.ani.flying = dur>0;

		return dur;
	}
}
