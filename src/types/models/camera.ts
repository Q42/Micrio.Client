/** Camera types */
export namespace Camera {
	export type CameraArray = number[] | Float64Array;
	export type View = CameraArray;
	export type Coords = [number, number, number?]|Float64Array;
	export type Vector = {
		direction: number;
		distanceX: number;
		distanceY: number;
	};
	export type TimingFunction = ('ease'|'ease-in'|'ease-out'|'linear');
	export interface AnimationOptions {
		duration?: number;
		limit?: boolean;
		speed?: number;
		timingFunction?: TimingFunction
	}
}
