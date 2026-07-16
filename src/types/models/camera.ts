export namespace Camera {
	/** A numeric array or Float64Array used for camera geometry. */
	export type CameraArray = number[] | Float64Array;

	/** A viewport/area definition `[x, y, width, height]` (origin + size). */
	export type View = CameraArray;

	/** Coordinate tuple, [x, y, scale] */
	export type Coords = [number, number, number?]|Float64Array;

	/** A 360 vector for use in Spaces */
	export type Vector = {
		direction: number;
		distanceX: number;
		distanceY: number;
	};

	export type TimingFunction = ('ease'|'ease-in'|'ease-out'|'linear');

	export interface AnimationOptions {
		/** Animation duration in ms */
		duration?: number;
		/** Limit the viewport to fill the screen */
		limit?: boolean;
		/** In case of automatic duration, speed factor (1 = 100%) */
		speed?: number;
		/** Transition timing function */
		timingFunction?: TimingFunction
	}
}
