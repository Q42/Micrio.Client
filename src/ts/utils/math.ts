/**
 * Mathematical utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';

/**
 * Calculates the positive modulo (floored division remainder).
 */
export const mod = (n: number, m: number = 1): number => (n % m + m) % m;

/**
 * Converts a Camera.View tuple `[x, y, w, h]` to a center-based JSON object.
 */
export const toCenterJSON = (v: Models.Camera.View): { centerX: number; centerY: number; width: number; height: number } => ({
	centerX: v[0] + v[2] / 2,
	centerY: v[1] + v[3] / 2,
	width: v[2],
	height: v[3]
});

