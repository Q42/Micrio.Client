import { pyth } from './utils'
import Canvas from './canvas';

export default class Kinetic {
	private dX : f64 = 0;
	private dY : f64 = 0;
	private startTime : f64 = 0;
	private prevTime : f64;
	private endTime : f64 = 0;
	private lastInteraction : f64 = 0;
	private velocityX : f64 = 0;
	private velocityY : f64 = 0;
	started: bool = false;

	constructor(
		private canvas: Canvas
	) {}

	addStep(pX:f64, pY:f64, time:f64) : void {
		if(this.endTime) return;
		if(this.startTime == 0) this.startTime = time;

		// Normalize to 60FPS -- Chromium fires every ms, not frame, when devtools open
		const fact:f64 = this.prevTime > 0 ? 16.67 / (time - this.prevTime) : 1;
		if(pyth(pX,pY) * fact > 20) this.lastInteraction = time;

		const elasticity = this.canvas.main.dragElasticity;

		this.dX += pX * elasticity;
		this.dY += pY * elasticity;
		this.prevTime = time;
	}

	start() : void {
		if(this.canvas.camera.isUnderZoom()) return;
		this.started = true;
	}

	stop() : void {
		this.started = false;
		this.endTime = 0;
		this.startTime = 0;
		this.prevTime = 0;
		this.lastInteraction = 0;
		this.dX = 0;
		this.dY = 0;
	}

	step(time:f64) : f64 {
		const webgl = this.canvas.webgl;
		const cam = this.canvas.camera;
		if(!this.started || this.startTime == 0) return 1;

		if(this.endTime == 0) {
			this.endTime = time;
			const factor = 1 - min(1, (this.endTime - this.lastInteraction) / 250);
			const deltaTime = this.endTime - this.startTime;

			this.velocityX = this.dX / (deltaTime / 4) * factor;
			this.velocityY = this.dY / (deltaTime / 4) * factor;
		}
		else {
			this.velocityX*=.94;
			this.velocityY*=.94;
		}

		let v = pyth(this.velocityX, this.velocityY);
		if(this.canvas.is360) webgl.rotate(this.velocityX, this.velocityY, 0, time);
		else cam.pan(this.velocityX, this.velocityY, 0, false, time, false, true);

		if(v <= 0.01) {
			v = 0;
			this.stop();
		}

		return 1-v;
	}
}
