import { pyth, easeInOut, easeIn, easeOut, linear, Bicubic } from './utils'
import { View } from './shared'
import { aniDone, aniAbort } from './main';
import Canvas from './canvas';

/** Manages camera and view animations (fly-to, zoom). */
export default class Ani {
	// --- View Animation Properties ---
	/** Flag indicating if a view animation (fly-to) is active. */
	private isView : bool = false;
	/** Starting view state for the animation. */
	private readonly vFrom : View;
	/** Target view state for the animation. */
	private readonly vTo : View;
	/** Stores the final target view requested (might differ from vTo during corrections). */
	readonly lastView : View;

	// --- Camera (Perspective/Zoom) Animation Properties ---
	/** Flag indicating if a zoom animation (perspective change in 360) is active. */
	private isZoom : bool = false;
	/** Flag indicating if the animation is a "jump" (zooms out then in). */
	private isJump : bool = false;
	/** Starting perspective value for zoom animation. */
	private zFrom : f64 = 0;
	/** Target perspective value for zoom animation. */
	private zTo : f64 = 0;
	/** Flag to disable perspective limits during zoom animation. */
	private zNoLimit : bool = false;
	/** Easing function used for the current animation. */
	private fn : Bicubic = easeInOut;

	// --- Timing Properties ---
	/** Timestamp when the animation started. */
	private started : f64 = 0;
	/** Total duration of the animation in milliseconds. */
	private duration : f64 = 0;

	// --- State Flags ---
	/** Flag indicating if the animation is currently running (not paused). */
	private isRunning : bool = false;

	/** Flag indicating if the view should be limited during animation (usually false during animation). */
	limit : bool = true;
	/** Flag indicating if the current animation step resulted in zooming out. */
	zoomingOut : bool = false;
	/** Flag indicating if the animation is a fly-to type. */
	flying : bool = false;
	/** Flag indicating if the animation is correcting the view to stay within limits. */
	correcting : bool = false;

	// --- Pause State ---
	/** Timestamp when the animation was paused. 0 if not paused. */
	private pausedAt : f64 = 0;

	// --- Jump Animation Specific Properties ---
	// Flags indicating which edge(s) are expanding (1) or contracting (2) during a jump.
	private fL:i8 = 0; // Left
	private fT:i8 = 0; // Top
	private fR:i8 = 0; // Right
	private fB:i8 = 0; // Bottom
	/** Start point for the ease-in part of the jump animation curve. */
	private mI:f64 = 0;
	/** Start point for the ease-out part of the jump animation curve. */
	private mO:f64 = 0;

	// --- Omni Object Animation Properties ---
	/** Starting frame index for omni object rotation animation. */
	private omniStartIdx:i32 = -1;
	/** Delta (number of frames) to rotate during omni animation. */
	private omniDelta:i32 = 0;

	constructor(
		private canvas: Canvas
	) {
		// Initialize View objects associated with the parent Canvas
		this.vFrom = new View(canvas);
		this.vTo = new View(canvas);
		this.lastView = new View(canvas);
	}

	/** Pauses the current animation. */
	pause(time:f64) : void {
		if(this.pausedAt > 0) return; // Already paused
		this.isRunning = false;
		this.pausedAt = time;
	}

	/** Resumes a paused animation. */
	resume(time:f64) : void {
		if(this.pausedAt == 0 || this.started == 0) return; // Not paused or not started
		// Adjust start time to account for paused duration
		this.started += time - this.pausedAt;
		this.pausedAt = 0;
		this.isRunning = true;
	}

	/** Stops the current animation completely and resets state. */
	stop() : void {
		// Notify JS host that animation was aborted (if it was running)
		if (this.isRunning) {
			aniAbort(this.canvas);
		}
		// Reset all state flags and properties
		this.started = 0;
		this.limit = true;
		this.flying = false;
		this.isRunning = false;
		this.isView = false;
		this.isZoom = false;
		this.correcting = false;
		this.pausedAt = 0;
	}

	/** Checks if a view animation is currently running. */
	isStarted() : bool {
		return this.isRunning && this.isView;
	}

	/**
	 * Starts or updates a "fly-to" animation to a target view rectangle.
	 * @param toX0 Target view X0.
	 * @param toY0 Target view Y0.
	 * @param toX1 Target view X1.
	 * @param toY1 Target view Y1.
	 * @param dur Requested duration in ms (-1 for automatic calculation).
	 * @param speed Speed factor for automatic duration calculation.
	 * @param perc Starting progress percentage (0-1).
	 * @param isJump If true, perform a zoom-out-then-in jump animation.
	 * @param limitViewport If true, limit the target view within boundaries.
	 * @param omniIdx Target frame index for omni object rotation (if applicable).
	 * @param noTrueNorth If true, disable 360 true north correction for the target view.
	 * @param fn Easing function index (0: easeInOut, 1: easeIn, 2: easeOut, 3: linear).
	 * @param time Current timestamp (performance.now()).
	 * @param correct If true, this is a correction animation towards limits.
	 * @returns Calculated or provided animation duration in ms.
	 */
	toView(
		toX0: f64, toY0: f64, toX1: f64, toY1: f64,
		dur: f64, speed: f64, perc: f64,
		isJump: bool, limitViewport:bool, omniIdx:i32,
		noTrueNorth: bool, fn: i16, time : f64, correct : bool = false) : f64 {

		// Store the final requested target view
		this.lastView.set(toX0, toY0, toX1, toY1);

		// If this is a correction animation and one is already running, just update the target
		if(correct && this.correcting) {
			this.updateTarget(toX0, toY0, toX1, toY1, true);
			return dur; // Return original duration estimate
		}

		// --- Setup Animation Parameters ---

		// Determine if true north correction should be applied to the target view
		this.vTo.correct = this.canvas.is360 && !noTrueNorth;

		const c = this.canvas;
		const v = c.view; // Current view
		const t = this.vTo; // Target view object
		const f = this.vFrom; // Starting view object

		this.isJump = isJump;

		// Select easing function based on index
		this.fn = fn == 3 ? linear : fn == 2 ? easeOut : fn == 1 ? easeIn : easeInOut;

		// Adjust target view if animating to a partial screen area (from JS setArea)
		const el = c.main.el;
		if(el.areaHeight != 0) {
			const margin:f64 = (toY1-toY0) / (1-(el.areaHeight / el.height));
			if(margin > 0) toY1 += margin; else toY0 += margin;
			el.areaHeight = 0; // Reset area constraint
		}
		if(el.areaWidth != 0) {
			const margin:f64 = (toX1-toX0) * (el.areaWidth / el.width);
			if(margin > 0) toX1 += margin; else toX0 += margin;
			el.areaWidth = 0; // Reset area constraint
		}

		// Set starting and target views
		f.set(v.x0, v.y0, v.x1, v.y1);
		t.set(toX0*1, toY0*1, toX1*1, toY1*1); // Ensure values are numbers

		// Handle 360 wrap-around logic
		if(c.is360) {
			isJump = true; // 360 transitions often involve perspective change
			// If crossing the 0/1 boundary, adjust coordinates to avoid large jumps
			if(abs(f.centerX - t.centerX) > .5) {
				if(f.x1 > 1 && t.x1 < 1) { t.x0++; t.x1++; } // Wrap target right
				if(t.x1 > 1 && f.x1 < 1) { f.x0++; f.x1++; } // Wrap start right
			}
		}

		// Apply viewport limits and aspect ratio correction if requested
		if(limitViewport) {
			t.correctAspectRatio();
			t.limit(false); // Limit target view without correcting zoom yet
		}

		// --- Jump Animation Setup ---
		this.fL = 0; this.fR = 0; this.fT = 0; this.fB = 0; // Reset jump flags
		let durFact:f64=1; // Duration multiplier for jumps

		if(this.isJump) {
			// Adjust target aspect ratio for non-360 jumps to match start aspect ratio initially
			if(!c.is360) {
				const cX = t.centerX, cY = t.centerY;
				if(t.aspect > f.aspect) { const nh = t.width * f.aspect; t.y0 = cY-nh/2; t.y1 = cY+nh/2; }
				else { const nw = t.height * f.aspect; t.x0 = cX-nw/2; t.x1 = cX+nw/2; }
			}
			// Check which edges are expanding/contracting
			const el = t.x0 < f.x0, et = t.y0 < f.y0, er = t.x1 > f.x1, eb = t.y1 > f.y1;
			// If expanding/contracting on some but not all edges, set jump flags and increase duration
			if((el || et || er || eb) && !(el && et && er && eb)) {
				this.fL = el?1:2; this.fR = er?1:2; this.fT = et?1:2; this.fB = eb?1:2;
				durFact=1.5;
			}
			// Otherwise, reset target view to original requested values (no aspect adjustment needed)
			else t.set(toX0*1, toY0*1, toX1*1, toY1*1);
		}

		// Apply final limits if this is a correction animation
		if(correct) t.limit(true, !limitViewport); // Limit target view, correcting zoom if needed

		// --- Duration Calculation ---
		// Base duration factor on canvas size
		const resoFact = max(10000, min(15000, sqrt(c.width * c.width + c.height * c.height) / 2));
		// Calculate distance between start and target views
		const dst = v.getDistance(t, dur < 0); // Pass true if duration is auto
		// Calculate easing curve parameters for jump animation
		this.mI = max(.5, .8 - dst * (c.is360 ? 1 : 2)); // Ease-in end point
		this.mO = max(.05, min(.9, dst - (c.is360 ? .2 : .1))); // Ease-out start point
		// Calculate final duration
		this.duration = dur < 0 ? (dst * resoFact / c.camSpeed * durFact) / (speed <= 0 ? 1 : speed) : dur;

		// --- Omni Object Rotation ---
		const numPerLayer = this.canvas.images.length / this.canvas.omniNumLayers;
		this.omniStartIdx = this.canvas.activeImageIdx;
		this.omniDelta = 0;
		// If a target omni index is provided and different from current
		if(!isNaN(omniIdx) && omniIdx > 0 && omniIdx != this.omniStartIdx) {
			// Calculate shortest rotation delta (wrapping around)
			this.omniDelta = omniIdx - this.omniStartIdx;
			if(this.omniDelta < -numPerLayer/2) this.omniDelta += numPerLayer;
			if(this.omniDelta > numPerLayer / 2) this.omniDelta -= numPerLayer;
			// Add time to duration based on rotation distance
			this.duration += abs(this.omniDelta) / <f64>this.canvas.images.length * 6000; // Add ~6s for full rotation
		}

		// --- Start Animation ---
		// If duration is zero, set view directly and finish
		if(this.duration == 0) {
			c.setView(t.x0, t.y0, t.x1, t.y1, false, true); // Set view, don't update lastView
			aniDone(this.canvas); // Notify JS host
			this.stop(); // Reset animation state
			return this.duration;
		}

		this.stop(); // Stop any previous animation

		// Set animation state flags
		this.isView = true;
		this.limit = false; // Don't limit view during animation steps
		this.flying = true;
		this.isZoom = false;
		if(correct) this.correcting = true;

		// Set start time, adjusting for initial progress if provided
		this.started = time - (perc * this.duration);
		this.isRunning = true;

		// Return the remaining duration
		return this.duration * (1 - perc);
	}

	/** Updates the target view of a running animation. Used for corrections. */
	updateTarget(toX0: f64, toY0: f64, toX1: f64, toY1: f64, limiting : bool = false) : void {
		this.vTo.set(toX0, toY0, toX1, toY1);
		if(limiting) this.vTo.limit(limiting); // Apply limits if requested
	}

	/**
	 * Starts a zoom animation (perspective change for 360).
	 * @param to Zoom delta factor.
	 * @param dur Requested duration in ms (-1 for automatic).
	 * @param speed Speed factor for automatic duration.
	 * @param noLimit If true, ignore perspective limits.
	 * @param time Current timestamp (performance.now()).
	 * @returns Calculated or provided animation duration in ms.
	 */
	zoom(to: f64, dur: f64, speed: f64, noLimit: bool, time: f64) : f64 {
		this.stop(); // Stop previous animations
		// Set state flags
		this.isView = false;
		this.flying = false;
		this.isZoom = true;
		this.zNoLimit = noLimit;

		const c = this.canvas;
		const webgl = c.webgl;

		// Calculate start and target perspective values
		this.zFrom = webgl.perspective;
		// Adjust delta based on current scale and canvas size
		this.zTo = this.zFrom + (to / (webgl.scale * <f64>pyth(c.width, c.height) / 20));
		// Apply limits if not disabled
		if(!noLimit) this.zTo = min(webgl.maxPerspective, max(webgl.minPerspective, this.zTo));

		// Set timing and start
		this.started = time;
		this.isRunning = true;

		// Calculate duration
		this.duration = dur >= 0 ? dur : abs(this.zFrom - this.zTo) * 1000 / speed;
		return dur; // Return original requested duration
	}

	/** Sets the starting view for progress calculation in flyTo animations. */
	setStartView(p0:f64, p1:f64, p2: f64, p3: f64, correctRatio: bool) : void {
		this.vFrom.set(p0, p1, p2, p3, correctRatio);
		// Also set vTo initially to prevent issues if animation is interrupted early
		this.vTo.set(p0, p1, p2, p3, correctRatio);
	}

	/**
	 * Calculates and applies the animation step for the current frame.
	 * @param time Current timestamp (performance.now()).
	 * @returns Current animation progress (0-1).
	 */
	step(time: f64) : f64 {
		// Calculate progress, clamped between 0 and 1
		const p : f64 = this.started == 0 ? 1 : min(1, max(0, (time - this.started) / this.duration));
		// Apply easing function to progress
		const pE = this.fn.get(p);
		// Get current scale before applying changes
		const scale = this.canvas.getScale();

		if(this.isRunning) {
			// --- Apply View Animation Step ---
			if(this.isView) {
				const f = this.vFrom, t = this.vTo;
				// Special easing for jump animations based on edge flags (fL, fT, fR, fB)
				const mo=this.mO, i = this.fn.get(min(1, p/this.mI)), // Ease-in part
					o = this.fn.get(max(0,(p-mo)/(1-mo))); // Ease-out part
				let n:i8=0; // Temp variable for edge flag

				// Interpolate each coordinate using either standard eased progress (pE)
				// or the jump-specific ease-in (i) or ease-out (o) progress.
				this.canvas.setView(
					f.x0+(t.x0-f.x0)*(!(n=this.fL)?pE:n==1?i:o), // x0
					f.y0+(t.y0-f.y0)*(!(n=this.fT)?pE:n==1?i:o), // y0
					f.x1+(t.x1-f.x1)*(!(n=this.fR)?pE:n==1?i:o), // x1
					f.y1+(t.y1-f.y1)*(!(n=this.fB)?pE:n==1?i:o), // y1
					false, // noLimit (handled internally by animation logic)
					true   // noLastView (don't update lastView during step)
				);

				// --- Apply Omni Object Rotation Step ---
				if(this.omniDelta) {
					// Interpolate omni frame index based on eased progress
					let idx = this.omniStartIdx + <i32>(this.omniDelta * this.fn.get(min(1, p*1.5))); // Slightly faster rotation easing
					const numPerLayer = this.canvas.images.length / this.canvas.omniNumLayers;
					// Wrap index around
					if(idx < 0) idx += numPerLayer;
					if(idx >= numPerLayer) idx -= numPerLayer;
					// Set the active image in the canvas
					this.canvas.setActiveImage(idx, 0);
				}
			}

			// --- Apply Zoom Animation Step (360 Perspective) ---
			if(this.isZoom) {
				// Interpolate perspective value
				this.canvas.webgl.setPerspective(this.zFrom * (1-pE) + this.zTo * pE, this.zNoLimit);
			}

			// --- Check for Animation Completion ---
			if(p>=1) {
				// Ensure final view matches the last requested target
				this.lastView.copy(this.canvas.view);
				// Notify JS host that animation is done
				aniDone(this.canvas);
				// Reset animation state
				this.stop();
			}
		}

		// Update zoomingOut flag based on scale change
		this.zoomingOut = this.isRunning && this.canvas.getScale() < scale;

		return p; // Return current progress
	}

}
