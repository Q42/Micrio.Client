/**
 * Mathematical utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';

/**
 * Calculates the hypotenuse of a right triangle given the lengths of the other two sides.
 * @internal
 * @param a Length of side a.
 * @param b Length of side b.
 * @returns The length of the hypotenuse.
 */
export const pyth = (a: number, b: number): number => Math.sqrt(a * a + b * b);

/**
 * Calculates the modulo of n divided by m, ensuring a positive result.
 * @internal
 * @param n The dividend.
 * @param m The divisor (defaults to 1).
 * @returns The positive modulo result.
 */
export const mod = (n: number, m: number = 1): number => (n % m + m) % m;

/**
 * Clamps a view rectangle to the image bounds [0, 0, 1, 1].
 * @internal
 */
export const limitView = (v: Models.Camera.View): Models.Camera.View => {
	// Clamp width and height to maximum of 1
	const width = Math.min(1, v[2]);
	const height = Math.min(1, v[3]);

	// Calculate half dimensions for boundary checking
	const halfW = width / 2;
	const halfH = height / 2;

	// Clamp center coordinates to keep rectangle within [0,0,1,1] bounds
	const centerX = Math.max(halfW, Math.min(1 - halfW, v[0] + v[2] / 2));
	const centerY = Math.max(halfH, Math.min(1 - halfH, v[1] + v[3] / 2));

	return [centerX - halfW, centerY - halfH, width, height];
};

