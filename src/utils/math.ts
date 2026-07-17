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

/** Check if point (x,y) falls inside AABB [ax, ay, aw, ah]. */
export const pointInArea = (x: number, y: number, a: [number, number, number, number]): boolean =>
	x >= a[0] && x <= a[0] + a[2] && y >= a[1] && y <= a[1] + a[3];

/** Normalize a 3D vector in-place. Returns the squared length (0 if zero-length). */
export const normalize3 = (x: number, y: number, z: number): [number, number, number] => {
	let len = x * x + y * y + z * z;
	if (len > 0) { len = 1 / Math.sqrt(len); return [x * len, y * len, z * len]; }
	return [0, 0, 0];
};

