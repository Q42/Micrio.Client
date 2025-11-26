/**
 * 360° space navigation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';
import type { HTMLMicrioElement } from '../element';
import { mod } from './math';

/**
 * Calculates the 3D vector and navigation parameters between two images in a 360 space.
 * Used for smooth transitions between waypoints.
 * @internal
 * @param micrio The main HTMLMicrioElement instance.
 * @param targetId The ID of the target image.
 * @returns An object containing the vector, normalized vector, direction, and transition parameters, or undefined if calculation fails.
 */
export function getSpaceVector(micrio: HTMLMicrioElement, targetId: string): {
	vector: Models.Camera.Vector; // Vector used for `micrio.open` transition
	directionX: number; // Target direction X (0-1) relative to source image
	v: Models.Spaces.DirectionVector; // Raw difference vector [dx, dy, dz]
	vN: Models.Spaces.DirectionVector; // Normalized difference vector
} | undefined {
	const image = micrio.$current;
	if (!image) return; // Exit if no current image
	// Find source and target image data in spaceData
	const source = micrio.spaceData?.images.find(i => i.id == image.id);
	const target = micrio.spaceData?.images.find(i => i.id == targetId);
	if (!source || !target) return; // Exit if source or target not found

	// Calculate difference vector [dx, dy, dz]
	const v: Models.Spaces.DirectionVector = [
		(target.x ?? .5) - (source.x ?? .5),
		(source.y ?? .5) - (target.y ?? .5), // Y is inverted?
		(target.z ?? .5) - (source.z ?? .5)
	];

	// Normalize the vector
	let len = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
	if (len > 0) len = 1 / Math.sqrt(len);
	const vN: Models.Spaces.DirectionVector = [v[0] * len, v[1] * len, v[2] * len];

	// Calculate direction angle (yaw) and horizontal distance factor
	const directionX = mod((Math.atan2(-vN[0], vN[2])) / Math.PI / 2); // Calculate yaw (0-1)
	const distanceX = Math.max(0, Math.min(.4, Math.sqrt(vN[0] * vN[0] + vN[2] * vN[2]))); // Horizontal distance factor (clamped)

	return {
		v, vN, directionX,
		vector: { // Vector object for micrio.open
			direction: directionX % 1, // Apply true north correction
			distanceX,
			distanceY: -v[1] // Vertical distance (inverted?)
		}
	};
}

