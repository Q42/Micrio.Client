/**
 * View conversion and transformation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';

/**
 * View utility object for converting between view formats.
 * @internal
 */
export const View = {
	/** Casts a legacy view array ([x0, y0, x1, y1]) to [x0, y0, width, height]. */
	fromLegacy: (v?: Models.Camera.ViewRect | Models.Camera.View): Models.Camera.View | undefined => {
		if (!v) return undefined;
		return [
			v[0],
			v[1],
			v[2] - v[0],
			v[3] - v[1]
		];
	},

	/** Converts a view to center-based JSON format. */
	toCenterJSON: (v: Models.Camera.View): { centerX: number; centerY: number; width: number; height: number } => ({
		centerX: v[0] + v[2] / 2,
		centerY: v[1] + v[3] / 2,
		width: v[2],
		height: v[3]
	}),

	/** Converts a rect to center-based JSON format. */
	rectToCenterJSON: (v: Models.Camera.View) =>
		View.toCenterJSON([v[0], v[1], v[2] - v[0], v[3] - v[1]]),
};

