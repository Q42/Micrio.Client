import type { Assets } from './assets';

export namespace Spaces {
	export interface SpaceImage {
		/** The Micrio ID */
		id: string;
		/** X position of 360 image in zone */
		x: number;
		/** Y position of 360 image in zone */
		y: number;
		/** Z position of 360 image in zone */
		z: number;
		/** Y-axis sphere rotation in radians (aligns linked 360 images). */
		rotationY: number;
	}

	export interface Space {
		/** The 360 image */
		images:SpaceImage[];
		/** The zone name */
		name: string;
		/** 360 linked Micrio IDs */
		links: [string, string, {[key:string]: WayPointSettings}?][];
		/** Custom icon lib */
		icons?: Assets.Image[];
	}

	export interface WaypointInterface {
		el?:HTMLElement;
		settings: WayPointSettings;
		coords: WaypointCoords;
		deleted?: boolean;
	}

	export interface WayPointSettings {
		i18n: {[key:string]: {
			title: string;
		}};

		/** A predefined custom icon idx */
		customIconIdx?: number;

		coords?: WaypointCoords;
	}

	export type DirectionVector = [number, number, number];

	export interface WaypointCoords {
		x: number;
		y: number;

		baseScale: number;
		scale: number;

		rotX: number;
		rotY: number;
		rotZ: number;

		custom?:boolean;
	}
}
