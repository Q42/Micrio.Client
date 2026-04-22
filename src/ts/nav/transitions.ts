/**
 * Direction-keyed area rectangles for grid/gallery slide and swipe transitions.
 * Areas use [x0, y0, x1, y1] in normalized parent-canvas coordinates and
 * extend outside [0,1] to represent off-screen positions.
 *
 * Direction conventions (degrees of motion of the entering image):
 *   0   = enters from top
 *   90  = enters from right
 *   180 = enters from bottom
 *   270 = enters from left
 *
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';

/** Slide transition entry areas (entering image starts half-off-screen). */
export const slideAreas: Record<number, Models.Camera.ViewRect> = {
	0:   [0, -.5, 1, 0],
	90:  [1, 0, 1.5, 1],
	180: [0, 1, 1, 1.5],
	270: [-.5, 0, 0, 1],
};

/** Swipe transition entry areas (entering image starts fully off-screen). */
export const swipeAreas: Record<number, Models.Camera.ViewRect> = {
	0:   [0, -1, 1, 0],
	90:  [1, 0, 2, 1],
	180: [0, 1, 1, 2],
	270: [-1, 0, 0, 1],
};

/** Swipe transition exit areas (leaving image moves fully off-screen). */
export const swipeExitAreas: Record<number, Models.Camera.ViewRect> = {
	0:   [0, 1, 1, 2],
	90:  [-1, 0, 0, 1],
	180: [0, -1, 1, 0],
	270: [1, 0, 2, 1],
};

/** Centered visible slot. */
export const centerArea: Models.Camera.ViewRect = [0, 0, 1, 1];

/** Off-screen slot to the left, same height. */
export const leftSlot: Models.Camera.ViewRect = [-1, 0, 0, 1];

/** Off-screen slot to the right, same height. */
export const rightSlot: Models.Camera.ViewRect = [1, 0, 2, 1];

/**
 * Returns the horizontal slot area for an integer offset from the active slot.
 * offset=0 → centered visible; positive → off to the right; negative → off to the left.
 */
export const horizontalSlot = (offset: number): Models.Camera.ViewRect => [offset, 0, offset + 1, 1];
