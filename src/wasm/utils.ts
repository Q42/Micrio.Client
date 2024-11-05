import { PI, PI2 } from './shared';

export function pyth( a: f64, b: f64) : f64 {
	return sqrt(a*a+b*b);
}
export function twoNth(num:u32): u32 {
	let v:u32 = 1; while(num-- > 0) v*=2; return v;
}
export function atan2(x:f64, y:f64): f64 {
	return x==0 && y==0 ? 0 : Math.atan(x/y) + (y < 0 ? x > 0 ? PI : -PI : 0);
}
export function mod1(n:f64): f64 {
	return (n%1+1)%1;
}
export function modPI(n:f64): f64 {
	return (n%PI2+PI2)%PI2;
}

//For cubic bezier animations
export class Bicubic {
	private readonly Cx : f64;
	private readonly Bx : f64;
	private readonly Ax : f64;

	private readonly Cy : f64;
	private readonly By : f64;
	private readonly Ay : f64;

	private readonly isLinear : boolean;

	constructor(
		private readonly p1: f64,
		private readonly p2: f64,
		private readonly p3: f64,
		private readonly p4: f64
	) {
		this.isLinear = p1 == p2 && p2 == p3 && p3 == p4 && p4 == 0;
		this.Cx = 3 * this.p1;
		this.Bx = 3 * (this.p3 - this.p1) - this.Cx;
		this.Ax = 1 - this.Cx - this.Bx;
		this.Cy = 3 * this.p2;
		this.By = 3 * (this.p4 - this.p2) - this.Cy;
		this.Ay = 1 - this.Cy - this.By;
	}

	private bezier_x (t:f64) : f64 {
		return t * (this.Cx + t * (this.Bx + t * this.Ax))
	}
	private bezier_y (t:f64) : f64 {
		return t * (this.Cy + t * (this.By + t * this.Ay))
	}

	// using Newton's method to aproximate the parametric value of x for t
	private bezier_x_der (t:f64) : f64 {
		return this.Cx + t * (2*this.Bx + 3*this.Ax * t)
	}

	private find_x_for(t:f64) : f64 {
		let x : f64 = t;
		let i : u8 = 0;
		let z : f64 = 0;
		let d : f64 = 0;
		while (i < 5) { // making 5 iterations max
			z = this.bezier_x(x) - t;
			d = this.bezier_x_der(x);
			if(d==0) break;
			x = x - z/d;
			i++;
		}
		return x;
	}

	get(t:f64) : f64 {
		return this.isLinear ? t : this.bezier_y(this.find_x_for(t));
	}
}

export const easeInOut = new Bicubic(0.42,0,0.58,1);
export const easeIn = new Bicubic(0.42,0,1,1);
export const easeOut = new Bicubic(0,0,0.58,1);
export const linear = new Bicubic(0,0,0,0);
