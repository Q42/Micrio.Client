/**
 * Mathematical utility functions and easing curve implementation.
 * @author Marcel Duin <marcel@micr.io>
 */

import { PI2 } from '../globals';

/** Calculates 2 to the power of num (2^num). */
export function twoNth(num: number): number {
	return 1 << num;
}

/** Calculates the positive modulo (floored division remainder). */
export function mod(n: number, m: number = 1): number {
	return (n % m + m) % m;
}

/** Calculates the modulo 1 of a number (keeps the fractional part, positive). @deprecated Use mod(n, 1) */
export const mod1 = (n: number): number => mod(n, 1);

/** Calculates the modulo 2*PI of a number (wraps angles to the range [0, 2*PI)). */
export function modPI(n: number): number {
	return (n % PI2 + PI2) % PI2;
}

/**
 * Calculates the shortest angular distance between two longitude coordinates.
 * Handles wrapping around the 360-degree sphere.
 * @param from Starting longitude coordinate (0-1).
 * @param to Target longitude coordinate (0-1).
 * @returns The shortest signed distance (-0.5 to 0.5).
 */
export function longitudeDistance(from: number, to: number): number {
	const normalizedFrom = mod1(from);
	const normalizedTo = mod1(to);

	const directDistance = normalizedTo - normalizedFrom;
	const wrapDistance = directDistance > 0 ? directDistance - 1 : directDistance + 1;

	return Math.abs(directDistance) <= Math.abs(wrapDistance) ? directDistance : wrapDistance;
}

/**
 * Implements a cubic bezier curve calculation.
 * Used for animation easing functions.
 */
export class Bicubic {
	private readonly Cx: number;
	private readonly Bx: number;
	private readonly Ax: number;

	private readonly Cy: number;
	private readonly By: number;
	private readonly Ay: number;

	private readonly isLinear: boolean;

	constructor(p1: number, p2: number, p3: number, p4: number) {
		this.isLinear = p1 === p2 && p3 === p4 && p1 === 0 && p3 === 1;
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
	private bezier_x(t: number): number {
		return t * (this.Cx + t * (this.Bx + t * this.Ax));
	}

	/** Calculates the Y coordinate on the bezier curve for a given parameter t. */
	private bezier_y(t: number): number {
		return t * (this.Cy + t * (this.By + t * this.Ay));
	}

	/** Calculates the derivative of the bezier curve's X component with respect to t. */
	private bezier_x_der(t: number): number {
		return this.Cx + t * (2 * this.Bx + 3 * this.Ax * t);
	}

	/**
	 * Approximates the parameter t that corresponds to a given X coordinate on the curve,
	 * using Newton's method.
	 * @param x The target X coordinate.
	 * @returns The approximated parameter t for the given x.
	 */
	private find_x_for(x: number): number {
		let t: number = x;
		let i: number = 0;
		let current_x: number = 0;
		let derivative_x: number = 0;
		while (i < 5) {
			current_x = this.bezier_x(t) - x;
			derivative_x = this.bezier_x_der(t);
			if (derivative_x === 0) break;
			t = t - current_x / derivative_x;
			i++;
		}
		return t;
	}

	/**
	 * Gets the eased Y value for a given progress value t (0-1).
	 * @param t The progress value (time).
	 * @returns The eased Y value.
	 */
	get(t: number): number {
		return this.isLinear ? t : this.bezier_y(this.find_x_for(t));
	}
}

/** Predefined cubic bezier easing: ease-in-out (standard). */
export const easeInOut = new Bicubic(0.42, 0, 0.58, 1);
/** Predefined cubic bezier easing: ease-in. */
export const easeIn = new Bicubic(0.42, 0, 1, 1);
/** Predefined cubic bezier easing: ease-out. */
export const easeOut = new Bicubic(0, 0, 0.58, 1);
/** Predefined cubic bezier easing: linear. */
export const linear = new Bicubic(0, 0, 1, 1);
