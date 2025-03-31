import { PI, PI2 } from './shared';

/** Calculates the hypotenuse of a right triangle (Pythagorean theorem). */
export function pyth( a: f64, b: f64) : f64 {
	return sqrt(a*a+b*b);
}

/** Calculates 2 to the power of num (2^num). */
export function twoNth(num:u32): u32 {
	let v:u32 = 1; while(num-- > 0) v*=2; return v;
}

/**
 * Calculates the angle (in radians) from the X axis to a point (y,x).
 * Handles all quadrants correctly.
 */
export function atan2(x:f64, y:f64): f64 {
	// Handle origin case to avoid division by zero
	if (x == 0 && y == 0) return 0;
	// Calculate angle using Math.atan and adjust based on quadrant
	return Math.atan(x/y) + (y < 0 ? (x >= 0 ? PI : -PI) : 0); // Corrected condition x >= 0 for quadrant adjustment
}

/** Calculates the modulo 1 of a number (keeps the fractional part, positive). */
export function mod1(n:f64): f64 {
	return (n%1+1)%1;
}

/** Calculates the modulo 2*PI of a number (wraps angles to the range [0, 2*PI)). */
export function modPI(n:f64): f64 {
	return (n%PI2+PI2)%PI2;
}

/**
 * Implements a cubic bezier curve calculation.
 * Used for animation easing functions.
 */
export class Bicubic {
	// Pre-calculated coefficients for the cubic bezier formula
	private readonly Cx : f64;
	private readonly Bx : f64;
	private readonly Ax : f64;

	private readonly Cy : f64;
	private readonly By : f64;
	private readonly Ay : f64;

	/** Flag indicating if the control points define a linear curve (optimization). */
	private readonly isLinear : boolean;

	/**
	 * Creates a new Bicubic easing function.
	 * @param p1 Control point 1 X coordinate.
	 * @param p2 Control point 1 Y coordinate.
	 * @param p3 Control point 2 X coordinate.
	 * @param p4 Control point 2 Y coordinate.
	 */
	constructor(
		private readonly p1: f64,
		private readonly p2: f64,
		private readonly p3: f64,
		private readonly p4: f64
	) {
		// Check if it's a linear curve (all control points at 0 or 1 equivalent)
		this.isLinear = p1 == p2 && p3 == p4 && p1 == 0 && p3 == 1; // Simplified check for standard linear
		// Pre-calculate coefficients based on control points
		this.Cx = 3 * this.p1;
		this.Bx = 3 * (this.p3 - this.p1) - this.Cx;
		this.Ax = 1 - this.Cx - this.Bx;
		this.Cy = 3 * this.p2;
		this.By = 3 * (this.p4 - this.p2) - this.Cy;
		this.Ay = 1 - this.Cy - this.By;
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
