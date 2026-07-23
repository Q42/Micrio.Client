/**
 * Handles kinetic scrolling/dragging behavior after user interaction stops.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import type { TileCanvas } from './tile-canvas';

/** Handles kinetic scrolling/dragging behavior after user interaction stops. @internal */
export default class Kinetic {
	/** Accumulated horizontal delta during drag. */
	#dX: number = 0;
	/** Accumulated vertical delta during drag. */
	#dY: number = 0;
	/** Timestamp when the drag interaction started. */
	#startTime: number = 0;
	/** Timestamp of the previous step added. */
	#prevTime: number = 0;
	/** Timestamp when the drag interaction ended (kinetic phase started). */
	#endTime: number = 0;
	/** Timestamp of the last significant interaction step. */
	#lastInteraction: number = 0;
	/** Current horizontal velocity for kinetic movement. */
	#velocityX: number = 0;
	/** Current vertical velocity for kinetic movement. */
	#velocityY: number = 0;
	/** Flag indicating if kinetic movement is currently active. */
	started: boolean = false;

	#canvas: TileCanvas;

	constructor(
		canvas: TileCanvas
	) {
		this.#canvas = canvas;
	}

	/**
	 * Adds a step (delta) from the user's drag interaction.
	 * @param pX Horizontal pixel delta since last step.
	 * @param pY Vertical pixel delta since last step.
	 */
	addStep(pX: number, pY: number): void {
		const t = this.#canvas.main.now;
		if (this.#endTime) return;
		if (this.#startTime === 0) this.#startTime = t;

		const fact: number = this.#prevTime > 0 ? 16.67 / (t - this.#prevTime) : 1;
		if (Math.sqrt(pX * pX + pY * pY) * fact > 20) this.#lastInteraction = t;

		const elasticity = this.#canvas.main._dragElasticity;

		this.#dX += pX * elasticity;
		this.#dY += pY * elasticity;
		this.#prevTime = t;
	}

	/** Starts the kinetic movement phase (called when user stops dragging). */
	start(): void {
		if (this.#canvas.camera._isUnderZoom()) return;
		this.started = true;
	}

	/** Stops the kinetic movement and resets state. */
	stop(): void {
		this.started = false;
		this.#endTime = 0;
		this.#startTime = 0;
		this.#prevTime = 0;
		this.#lastInteraction = 0;
		this.#dX = 0;
		this.#dY = 0;
		this.#velocityX = 0;
		this.#velocityY = 0;
	}

	/**
	 * Calculates and applies the kinetic movement step for the current frame.
	 * @returns Progress towards stopping (0 = max velocity, 1 = stopped).
	 */
	step(): number {
		const t = this.#canvas.main.now;
		const webgl = this.#canvas._camera360;
		const cam = this.#canvas.camera;
		if (!this.started || this.#startTime === 0) return 1;

		if (this.#endTime === 0) {
			this.#endTime = t;
			const factor = 1 - Math.min(1, (this.#endTime - this.#lastInteraction) / 250);
			const deltaTime = this.#endTime - this.#startTime;

			this.#velocityX = this.#dX / (deltaTime / 4) * factor;
			this.#velocityY = this.#dY / (deltaTime / 4) * factor;
		}
		else {
			this.#velocityX *= .94;
			this.#velocityY *= .94;
		}

		let v = Math.sqrt(this.#velocityX * this.#velocityX + this.#velocityY * this.#velocityY);
		if (this.#canvas.is360) webgl.rotate(this.#velocityX, this.#velocityY);
		else cam._pan(this.#velocityX, this.#velocityY, 0, false, false, true);

		if (v <= 0.01) {
			v = 0;
			this.stop();
		}

		return 1 - v;
	}
}
