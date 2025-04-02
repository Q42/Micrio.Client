import { pyth } from './utils'
import Canvas from './canvas';

/** Handles kinetic scrolling/dragging behavior after user interaction stops. */
export default class Kinetic {
	/** Accumulated horizontal delta during drag. */
	private dX : f64 = 0;
	/** Accumulated vertical delta during drag. */
	private dY : f64 = 0;
	/** Timestamp when the drag interaction started. */
	private startTime : f64 = 0;
	/** Timestamp of the previous step added. */
	private prevTime : f64 = 0;
	/** Timestamp when the drag interaction ended (kinetic phase started). */
	private endTime : f64 = 0;
	/** Timestamp of the last significant interaction step. */
	private lastInteraction : f64 = 0;
	/** Current horizontal velocity for kinetic movement. */
	private velocityX : f64 = 0;
	/** Current vertical velocity for kinetic movement. */
	private velocityY : f64 = 0;
	/** Flag indicating if kinetic movement is currently active. */
	started: bool = false;

	constructor(
		private canvas: Canvas
	) {}

	/**
	 * Adds a step (delta) from the user's drag interaction.
	 * @param pX Horizontal pixel delta since last step.
	 * @param pY Vertical pixel delta since last step.
	 * @param time Current timestamp (performance.now()).
	 */
	addStep(pX:f64, pY:f64, time:f64) : void {
		// Don't add steps if kinetic phase has already started
		if(this.endTime) return;
		// Record start time on the first step
		if(this.startTime == 0) this.startTime = time;

		// --- Velocity Calculation Adjustment ---
		// Normalize delta based on time since last step to approximate 60fps,
		// mitigating issues with high-frequency events (e.g., devtools open).
		const fact:f64 = this.prevTime > 0 ? 16.67 / (time - this.prevTime) : 1;
		// Update lastInteraction time if the normalized movement is significant
		if(pyth(pX,pY) * fact > 20) this.lastInteraction = time;

		// Get elasticity factor from main settings
		const elasticity = this.canvas.main.dragElasticity;

		// Accumulate weighted deltas
		this.dX += pX * elasticity;
		this.dY += pY * elasticity;
		this.prevTime = time;
	}

	/** Starts the kinetic movement phase (called when user stops dragging). */
	start() : void {
		// Don't start kinetic movement if zoomed out beyond minimum scale (underzoom)
		if(this.canvas.camera.isUnderZoom()) return;
		this.started = true;
	}

	/** Stops the kinetic movement and resets state. */
	stop() : void {
		this.started = false;
		this.endTime = 0;
		this.startTime = 0;
		this.prevTime = 0;
		this.lastInteraction = 0;
		this.dX = 0;
		this.dY = 0;
		this.velocityX = 0;
		this.velocityY = 0;
	}

	/**
	 * Calculates and applies the kinetic movement step for the current frame.
	 * @param time Current timestamp (performance.now()).
	 * @returns Progress towards stopping (0 = max velocity, 1 = stopped).
	 */
	step(time:f64) : f64 {
		const webgl = this.canvas.webgl;
		const cam = this.canvas.camera;
		// Exit if not started or interaction hasn't begun
		if(!this.started || this.startTime == 0) return 1;

		// --- Calculate Initial Velocity ---
		if(this.endTime == 0) {
			this.endTime = time; // Mark the end of user interaction
			// Calculate a factor based on how recently the last significant interaction occurred
			// (reduces velocity if user paused before releasing)
			const factor = 1 - min(1, (this.endTime - this.lastInteraction) / 250);
			const deltaTime = this.endTime - this.startTime;

			// Calculate initial velocity based on accumulated delta, time, and interaction factor
			// Division by (deltaTime / 4) seems arbitrary, might need tuning.
			this.velocityX = this.dX / (deltaTime / 4) * factor;
			this.velocityY = this.dY / (deltaTime / 4) * factor;
		}
		// --- Apply Decay ---
		else {
			// Apply friction/decay to the velocity
			this.velocityX*=.94;
			this.velocityY*=.94;
		}

		// --- Apply Movement ---
		let v = pyth(this.velocityX, this.velocityY); // Calculate current speed
		// Apply rotation (360) or pan (2D) based on current velocity
		if(this.canvas.is360) webgl.rotate(this.velocityX, this.velocityY, 0, time);
		else cam.pan(this.velocityX, this.velocityY, 0, false, time, false, true); // Pan without duration, mark as kinetic

		// --- Check for Stop Condition ---
		if(v <= 0.01) { // Stop if velocity is negligible
			v = 0;
			this.stop();
		}

		// Return progress towards stopping (inverted speed)
		return 1-v;
	}
}
