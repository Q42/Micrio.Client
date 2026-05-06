/**
 * Handles kinetic scrolling/dragging behavior after user interaction stops.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import type { default as TileCanvas } from '../canvas/canvas';

/** Handles kinetic scrolling/dragging behavior after user interaction stops. @internal */
export default class Kinetic {
	/** Accumulated horizontal delta during drag. */
	private dX: number = 0;
	/** Accumulated vertical delta during drag. */
	private dY: number = 0;
	/** Timestamp when the drag interaction started. */
	private startTime: number = 0;
	/** Timestamp of the previous step added. */
	private prevTime: number = 0;
	/** Timestamp when the drag interaction ended (kinetic phase started). */
	private endTime: number = 0;
	/** Timestamp of the last significant interaction step. */
	private lastInteraction: number = 0;
	/** Current horizontal velocity for kinetic movement. */
	private velocityX: number = 0;
	/** Current vertical velocity for kinetic movement. */
	private velocityY: number = 0;
	/** Flag indicating if kinetic movement is currently active. */
	started: boolean = false;

	constructor(
		private canvas: TileCanvas
	) {}

	/**
	 * Adds a step (delta) from the user's drag interaction.
	 * @param pX Horizontal pixel delta since last step.
	 * @param pY Vertical pixel delta since last step.
	 * @param time Current timestamp (performance.now()).
	 */
	addStep(pX: number, pY: number, time: number): void {
		if (this.endTime) return;
		if (this.startTime === 0) this.startTime = time;

		const fact: number = this.prevTime > 0 ? 16.67 / (time - this.prevTime) : 1;
		if (Math.sqrt(pX * pX + pY * pY) * fact > 20) this.lastInteraction = time;

		const elasticity = this.canvas.main.dragElasticity;

		this.dX += pX * elasticity;
		this.dY += pY * elasticity;
		this.prevTime = time;
	}

	/** Starts the kinetic movement phase (called when user stops dragging). */
	start(): void {
		if (this.canvas.camera.isUnderZoom()) return;
		this.started = true;
	}

	/** Stops the kinetic movement and resets state. */
	stop(): void {
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
	 * @returns Progress towards stopping (0 = max velocity, 1 = stopped).
	 */
	step(time: number): number {
		const webgl = this.canvas.webgl;
		const cam = this.canvas.camera;
		if (!this.started || this.startTime === 0) return 1;

		if (this.endTime === 0) {
			this.endTime = time;
			const factor = 1 - Math.min(1, (this.endTime - this.lastInteraction) / 250);
			const deltaTime = this.endTime - this.startTime;

			this.velocityX = this.dX / (deltaTime / 4) * factor;
			this.velocityY = this.dY / (deltaTime / 4) * factor;
		}
		else {
			this.velocityX *= .94;
			this.velocityY *= .94;
		}

		let v = Math.sqrt(this.velocityX * this.velocityX + this.velocityY * this.velocityY);
		if (this.canvas.is360) webgl.rotate(this.velocityX, this.velocityY, 0, time);
		else cam.pan(this.velocityX, this.velocityY, 0, false, time, false, true);

		if (v <= 0.01) {
			v = 0;
			this.stop();
		}

		return 1 - v;
	}
}
