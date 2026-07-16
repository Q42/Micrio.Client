import type { Assets } from './assets';
import type { ImageData } from './data';

/** 360 tour spaces */
export namespace Spaces {
	export interface SpaceImage {
		id: string;
		x: number;
		y: number;
		z: number;
		rotationY: number;
	}

	export interface Space {
		images:SpaceImage[];
		name: string;
		links: [string, string, {[key:string]: WayPointSettings}?][];
		icons?: Assets.Image[];
		markerTours?: ImageData.MarkerTour[];
	}

	export interface WaypointInterface {
		el?:HTMLElement;
		settings: WayPointSettings;
		coords: WaypointCoords;
		deleted?: boolean;
	}

	export interface WayPointSettings {
		i18n: {[key:string]: { title: string; }};
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
