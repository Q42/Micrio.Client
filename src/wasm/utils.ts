import { PI2 } from './shared';

/** Calculates 2 to the power of num (2^num). */
// @ts-ignore: decorator
@inline
export function twoNth(num:u32): u32 {
	return 1 << num;
}

/** Calculates the modulo 1 of a number (keeps the fractional part, positive). */
export function mod1(n:f64): f64 {
	return (n%1+1)%1;
}

/** Calculates the modulo 2*PI of a number (wraps angles to the range [0, 2*PI)). */
export function modPI(n:f64): f64 {
	return (n%PI2+PI2)%PI2;
}

/** Calculates the shortest angular distance between two longitude coordinates.
 * Handles wrapping around the 360-degree sphere.
 * @param from Starting longitude coordinate (0-1).
 * @param to Target longitude coordinate (0-1).
 * @returns The shortest signed distance (-0.5 to 0.5).
 */
export function longitudeDistance(from: f64, to: f64): f64 {
	const normalizedFrom = mod1(from);
	const normalizedTo = mod1(to);
	
	const directDistance = normalizedTo - normalizedFrom;
	const wrapDistance = directDistance > 0 ? directDistance - 1 : directDistance + 1;
	
	// Choose the shorter path
	return Math.abs(directDistance) <= Math.abs(wrapDistance) ? directDistance : wrapDistance;
}

/**
 * Implements a cubic bezier curve calculation.
 * Used for animation easing functions.
 */
export class Bicubic {
	private readonly Cx : f64;
	private readonly Bx : f64;
	private readonly Ax : f64;

	private readonly Cy : f64;
	private readonly By : f64;
	private readonly Ay : f64;

	private readonly isLinear : boolean;

	constructor(p1: f64, p2: f64, p3: f64, p4: f64) {
		this.isLinear = p1 == p2 && p3 == p4 && p1 == 0 && p3 == 1;
		const Cx = 3 * p1;
		const Bx = 3 * (p3 - p1) - Cx;
		this.Cx = Cx;
		this.Bx = Bx;
		this.Ax = 1 - Cx - Bx;
		const Cy = 3 * p2;
		const By = 3 * (p4 - p2) - Cy;
		this.Cy = Cy;
		this.By = By;
		this.Ay = 1 - Cy - By;
	}

	/** Calculates the X coordinate on the bezier curve for a given parameter t. */
	private bezier_x (t:f64) : f64 {
		return t * (this.Cx + t * (this.Bx + t * this.Ax));
	}
	/** Calculates the Y coordinate on the bezier curve for a given parameter t. */
	private bezier_y (t:f64) : f64 {
		return t * (this.Cy + t * (this.By + t * this.Ay));
	}

	/** Calculates the derivative of the bezier curve's X component with respect to t. */
	private bezier_x_der (t:f64) : f64 {
		return this.Cx + t * (2*this.Bx + 3*this.Ax * t);
	}

	/**
	 * Approximates the parameter t that corresponds to a given X coordinate on the curve,
	 * using Newton's method.
	 * @param x The target X coordinate.
	 * @returns The approximated parameter t for the given x.
	 */
	private find_x_for(x:f64) : f64 { // Renamed parameter for clarity
		let t : f64 = x; // Initial guess for t
		let i : u8 = 0;
		let current_x : f64 = 0;
		let derivative_x : f64 = 0;
		while (i < 5) { // Iterate a fixed number of times (5) for approximation
			current_x = this.bezier_x(t) - x; // Calculate the difference in x
			derivative_x = this.bezier_x_der(t); // Calculate the derivative
			if(derivative_x == 0) break; // Avoid division by zero
			t = t - current_x / derivative_x; // Newton's method step
			i++;
		}
		return t;
	}

	/**
	 * Gets the eased Y value for a given progress value t (0-1).
	 * @param t The progress value (time).
	 * @returns The eased Y value.
	 */
	get(t:f64) : f64 {
		// If linear, return t directly. Otherwise, find t for x=t and return the corresponding y.
		return this.isLinear ? t : this.bezier_y(this.find_x_for(t));
	}
}

// Predefined common easing functions
export const easeInOut = new Bicubic(0.42,0,0.58,1);
export const easeIn = new Bicubic(0.42,0,1,1);
export const easeOut = new Bicubic(0,0,0.58,1);
export const linear = new Bicubic(0,0,1,1); // Corrected linear definition
