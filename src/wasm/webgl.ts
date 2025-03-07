import { atan2, modPI, pyth } from './utils'
import { Coordinates, PI, PI2, PIh } from './shared'
import { Vec4, Mat4 } from './webgl.mat'
import Canvas from './canvas'
import { segsX, segsY } from './globals'

export default class WebGL {
	// Exposed to webGL
	readonly pMatrix : Mat4 = new Mat4;
	private readonly iMatrix : Mat4 = new Mat4;
	private readonly rMatrix : Mat4 = new Mat4;

	readonly position : Vec4 = new Vec4;
	private readonly qPos : Vec4 = new Vec4;
	private readonly quad : Mat4 = new Mat4;

	radius : f64 = 10;

	scale : f64 = 0;

	// used for non 2:1 360-images
	scaleY : f64 = 1;
	offY : f64 = 0;
	dofY : f64 = 1;

	// Range limits
	limitX: f64 = 0;
	limitY : f64 = 0;

	baseYaw: f64 = 0;
	yaw: f64 = 0;
	pitch: f64 = 0;

	defaultPerspective : f64 = PIh; // 90deg
	perspective : f64 = PIh; // 90deg
	maxPerspective : f64 = PIh; // wide fov
	minPerspective : f64 = PIh; // most narrow fov

	// Temps
	readonly vec4: Vec4 = new Vec4();

	readonly coo: Coordinates = new Coordinates;

	offX:number = 0;

	constructor(
		private canvas: Canvas
	) {
		this.offX = .5-this.canvas.trueNorth;
		this.baseYaw = this.offX * PI * 2;

		if(this.canvas.is360) {
			this.scaleY = this.canvas.height / (this.canvas.width / 2);
			this.offY = (1 - this.scaleY) / 4;
		}
	}

	setLimits(x:f64, y:f64) : void {
		this.limitX = x;
		this.limitY = y;
		this.maxPerspective = PIh;
		if(y > 0) this.maxPerspective = min(this.maxPerspective, this.maxPerspective * y * 1.5);
		this.setPerspective(this.perspective, true);
	}

	update(noPersp:bool = false) : void {
		const c = this.canvas;
		const el = c.el;
		if(!noPersp) this.pMatrix.perspective(this.perspective, el.aspect, 0.0001, c.is360 ? 20 : 100);

		if(c.is360) {
			const pM = this.pMatrix;
			this.pitch = min(PI/2, max(-PI/2, this.pitch));
			pM.rotateX(this.pitch);
			pM.rotateY(this.yaw);
			pM.translate(this.position.x, this.position.y, this.position.z);

			// For html 3d
			const rM = this.rMatrix;
			rM.perspectiveCss(this.perspective);
			rM.translate(0,0,el.height/el.ratio/2);
			rM.rotateX(-this.pitch);
			rM.rotateY(this.yaw);

			this.coo.direction = (this.yaw / PI * 180) % 360;

			c.view.from360();

		}
		else {
			const v = c.view;

			this.pMatrix.translate(
				-(v.centerX - .5) * c.aspect,
				v.centerY - .5,
				-v.height / 2
			);
		}

		this.pMatrix.toArray();
	}

	/* EVENTS */
	// yaw = left-right
	// pitch = up-down
	rotate(xPx:f64, yPx:f64, duration: f64, time: f64) : void {
		const c = this.canvas;
		const fact = max(1, this.perspective);
		this.yaw += xPx / c.width / this.scale * PI * 2 * fact;
		this.pitch += yPx / c.height / this.scale * PI * this.scaleY * fact;

		this.yaw = modPI(this.yaw);

		if(c.coverLimit || this.limitY > 0) this.limitPitch();
		if(this.limitX > 0) this.limitYaw();

		// Kinetic scrolling
		if(duration == 0) c.kinetic.addStep(xPx*2, yPx*2, time);

		this.update();
	}

	private limitPitch() : void {
		const ph = this.perspective / 2;
		const mph = PI * this.scaleY / 2 * (this.limitY > 0 ? this.limitY : 1);

		this.pitch = this.pitch > 0 ? min(mph, this.pitch + ph) - ph
			: max(-mph, this.pitch - ph) + ph;
	}

	private limitYaw() : void {
		const ph = this.perspective/2*this.canvas.el.aspect;
		const mph = PI * (this.limitX > 0 ? this.limitX : 1);

		let y = this.yaw; while(y >= PI) y-=PI*2;
		this.yaw = modPI(min(max(mph, ph) - ph, max(min(-mph, -ph) + ph, y)));
	}

	zoom(factor: f64, dur: f64, speed: f64, noLimit: bool, t: f64) : f64 {
		const c = this.canvas;
		factor /= 2;
		if(dur != 0) dur = c.ani.zoom(factor, dur, speed, noLimit, t);
		else {
			factor /= this.scale * pyth(c.width, c.height) / 20;
			this.setPerspective(this.perspective + factor, noLimit);
		}
		return dur;
	}

	setPerspective(perspective: f64, noLimit: bool) : void {
		const c = this.canvas;
		this.perspective = perspective;
		// Zoomlevels in 360 always limited
		if(!noLimit || c.is360) this.perspective = min(this.maxPerspective, max(this.minPerspective, this.perspective));
		if(c.coverLimit || this.limitY > 0) this.limitPitch();
		if(this.limitX > 0) this.limitYaw();
		this.pMatrix.perspective(this.perspective, c.el.aspect, 0.0001, c.is360 ? 12 : 100);
		this.readScale();
		this.update(true);
	}

	readScale() : void {
		// Read scale
		const el = this.canvas.el;
		const cX:f64 = el.width/2;
		const cY:f64 = el.height/2;

		const center0 = this.getCoo(cX, cY).x;
		const center1 = this.getCoo(cX+1, cY+1).x;
		this.scale = 1 / ((center1+(center1 < center0 ? 1 : 0))-center0) / this.canvas.width;
	}

	/* END EVENTS */

	setView() : void {
		const c = this.canvas;
		const v = c.view;
		this.yaw = ((v.x0 - this.offX + v.width/2) - .5) * PI * 2;
		this.pitch = (((v.y0 + v.height/2) - .5) * PI) * this.scaleY;
		this.setPerspective(min(this.maxPerspective, v.height * PI * this.scaleY), true);
	}

	setDirection(yaw:f64, pitch:f64, persp:f64) : void {
		this.yaw = modPI(yaw - this.baseYaw);
		this.pitch = pitch;
		if(persp != 0) this.setPerspective(persp, false);
		else this.update();
	}

	moveTo(distance: f64, distanceY: f64, direction: f64, addYaw: f64) : void {
		const dir:f64 = direction * PI * 2 + addYaw;
		this.position.x = -distance * Math.sin(dir);
		this.position.y = distanceY;
		this.position.z = distance * Math.cos(dir);
		this.canvas.view.changed = true;
		this.update();
	}

	resize() : void {
		const c = this.canvas;
		const el = c.el;
		c.camera.setCanvas();
		this.minPerspective = min(.5, el.height / c.height) / c.maxScale * this.scaleY * PI / el.ratio * el.scale;
		this.setPerspective(this.perspective, true);
	}

	// Functions

	/** Screen px to image coords [0-1] */
	getCoo(pxX:f64, pxY:f64) : Coordinates {
		const el = this.canvas.el;
		this.vec4.x = (pxX / el.width) * 2 - 1;
		this.vec4.y = -((pxY / el.height) * 2 - 1);
		this.vec4.z = 1;
		this.vec4.w = 1;

		// Copy current perspective matrix to to be inverted matrix
		this.iMatrix.copy(this.pMatrix);

		// Inverted perspective matrix
		this.iMatrix.invert();

		// Multiply with vector
		this.vec4.transformMat4(this.iMatrix);

		// Normalize to get direction vector
		this.vec4.normalize();

		// Do reverse calculation as .getXYZ below
		this.coo.x = atan2(this.vec4.x,-this.vec4.z)/PI/2+.5+this.offX;
		this.coo.y = .5 - Math.asin(this.vec4.y) / PI / this.scaleY;
		this.coo.scale = this.scale;
		this.coo.w = this.position.x + this.position.z;
		this.coo.direction = this.yaw + this.baseYaw;

		return this.coo;
	}

	/** Image coords [0-1] to screen px */
	// https://stackoverflow.com/questions/8491247/c-opengl-convert-world-coords-to-screen2d-coords
	getXYZ(x: f64, y: f64) : Coordinates {
		const el = this.canvas.el;
		this.getVec3(x, y);

		this.coo.x = ((this.vec4.x + 1) / 2) * el.width / el.ratio;
		this.coo.y = ((-this.vec4.y + 1) / 2) * el.height / el.ratio;
		this.coo.scale = this.scale;
		this.coo.w = -this.vec4.w;

		return this.coo;
	}

	getVec3(x: f64, y: f64, abs:bool = false, rad:f64=this.radius) : Vec4 {
		x*=-PI*2;
		y-=.5;
		y*=-PI;
		y*=this.scaleY;

		// coordinate in 3d space, untranslated
		const cY = Math.cos(y);
		this.vec4.x = cY * Math.sin(x)*rad;
		this.vec4.y = Math.sin(y)*rad;
		this.vec4.z = cY * Math.cos(x)*rad;
		this.vec4.w = 1;

		if(!abs) this.vec4.transformMat4(this.pMatrix);

		return this.vec4;
	}

	getQuad(cX:f64, cY:f64, w:f64, h:f64, scaleX:f64=1, scaleY:f64=1, rotX:f64=0, rotY:f64=0, rotZ:f64=0) : Float32Array {
		const s:f64 = PI * 2 * this.radius, m = this.iMatrix, pm = this.pMatrix;
		const el = this.canvas.el;
		const center = this.canvas.webgl.getVec3(cX, cY, true);
		const r = el.width / el.ratio;
		const x0 = cX-w/2, x1 = cX+w/2, y0 = cY-h/2, y1 = cY+h/2;
		const v = this.quad;
		const a = el.aspect;

		m.identity();
		m.rotateY(this.baseYaw);
		m.translate(center.x, center.y, center.z);
		m.rotateY(atan2(center.x,center.z) + PI + rotY);
		m.rotateX(-Math.sin((cY-.5)*PI) - rotX);
		m.rotateZ(-rotZ);
		m.scaleXY(scaleX, scaleY);

		m.scale(unchecked(this.canvas.images[0].scale));

		const p = this.qPos;

		// left, top
		let x = (x0-cX)*s, y = -(y0-cY)*.5*s;
		p.x=0;p.y=0;p.z=0; m.translate(x, y, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		p.transformMat4(pm);
		v.a0 = ((p.x + 1) / 2) * r; v.a1 = ((-p.y + 1) / 2) * r / a; v.a2 = -p.w;

		// right, top
		p.x=0;p.y=0;p.z=0; m.translate(x=(x1-cX)*s, y=-(y0-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		p.transformMat4(pm);
		v.a3 = ((p.x + 1) / 2) * r; v.a4 = ((-p.y + 1) / 2) * r / a; v.a5 = -p.w;

		// right, bottom
		p.x=0;p.y=0;p.z=0; m.translate(x=(x1-cX)*s, y=-(y1-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		p.transformMat4(pm);
		v.a6 = ((p.x + 1) / 2) * r; v.a7 = ((-p.y + 1) / 2) * r / a; v.a8 = -p.w;

		// left, bottom
		p.x=0;p.y=0;p.z=0; m.translate(x=(x0-cX)*s, y=-(y1-cY)*.5*s, 0); p.transformMat4(m); m.translate(-x, -y, 0);
		p.transformMat4(pm);
		v.a9 = ((p.x + 1) / 2) * r; v.a10 = ((-p.y + 1) / 2) * r / a; v.a11 = -p.w;

		return v.toArray();
	}

	getMatrix(x: f64, y: f64, scale: f64, radius: f64, rX: f64, rY: f64, rZ: f64, transY: f64, sX: f64=1, sY: f64=1) : Mat4 {
		if(isNaN(radius)) radius = this.radius;

		this.iMatrix.identity();

		radius *= this.radius * (100 / PI2);

		x*=-PI*2;
		y-=.5;
		y*=PI * this.scaleY;

		const cY = Math.cos(y);
		this.vec4.x = cY * Math.sin(x);
		this.vec4.y = Math.sin(y);
		this.vec4.z = cY * Math.cos(x);

		this.iMatrix.translate(
			this.position.x * radius/this.radius,
			-this.position.y * radius/this.radius + transY * this.radius,
			this.position.z * radius/this.radius
		);

		this.iMatrix.rotateY(this.baseYaw);

		this.iMatrix.translate(
			this.vec4.x * radius,
			this.vec4.y * radius,
			this.vec4.z * radius
		);

		this.iMatrix.rotateY(atan2(this.vec4.x,this.vec4.z) + PI + rY);
		this.iMatrix.rotateX(this.vec4.y + rX);
		this.iMatrix.rotateZ(rZ);

		this.iMatrix.scaleXY(sX, sY);

		this.iMatrix.scale(scale/PI/this.radius);

		this.iMatrix.multiply(this.rMatrix);

		return this.iMatrix;
	}

	setTile360(x: f64, y: f64, w: f64, h: f64) : void {
		y *= this.scaleY; y/= 2; y -= .25; y += this.offY;
		h *= this.scaleY; h/= 2;

		const v = this.canvas.main.vertexBuffer360, a = this.radius,
			sW = w / segsX, sH = h / segsY, pi2 = PI * 2;

		for(let pY:u32=0;pY<segsY;pY++) for(let pX:u32=0;pX<segsX;pX++) {
			const i:u32 = (pY * segsX + pX) * 6 * 3;
			const l = -(x + sW * pX) * pi2, t = -(y + sH * pY) * pi2,
				r = -(x + sW * (pX+1)) * pi2, b = -(y + sH * (pY+1)) * pi2;
			const cL = Math.cos(l) * a, sL = Math.sin(l) * a, cR = Math.cos(r) * a,
				sR = Math.sin(r) * a, cT = Math.cos(t), cB = Math.cos(b);

			//left, top
			unchecked(v[i+0] = <f32>(cT * sL));
			unchecked(v[i+2] = <f32>(cT * cL));

			// left, bottom
			unchecked(v[i+3] = v[i+9] = <f32>(cB * sL));
			unchecked(v[i+4] = v[i+10] = v[i+13] = <f32>(Math.sin(b) * a));
			unchecked(v[i+5] = v[i+11] = <f32>(cB * cL));

			// right, top
			unchecked(v[i+6] = v[i+15] = <f32>(cT * sR));
			unchecked(v[i+7] = v[i+16] = v[i+1] = <f32>(Math.sin(t) * a));
			unchecked(v[i+8] = v[i+17] = <f32>(cT * cR));

			// right, bottom
			unchecked(v[i+12] = <f32>(cB * sR));
			unchecked(v[i+14] = <f32>(cB * cR));
		}
	}

}
