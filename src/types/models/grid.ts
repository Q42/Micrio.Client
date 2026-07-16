import type { Camera } from './camera';
import type { ImageInfo } from './info';

/** Grid types */
export namespace Grid {
	export type MarkerFocusTransition = (
		'crossfade'|'slide'|'slide-horiz'|'slide-vert'|
		'slide-up'|'slide-down'|'slide-right'|'slide-left'|
		'swipe'|'swipe-horiz'|'swipe-vert'|
		'swipe-up'|'swipe-down'|'swipe-right'|'swipe-left'|
		'behind'|'behind-left'|'behind-right'
	);

	export type GridSetTransition = (
		'crossfade'|'behind'|'behind-delayed'|'appear-delayed'
	)

	export interface GridImage extends Partial<ImageInfo.ImageInfo> {
		size: [number, number?];
		area?: Camera.View;
		view?: Camera.View;
	}

	export interface GridHistory {
		layout: string;
		horizontal: boolean;
		view?: Camera.View;
	}

	export interface GridImageOptions {
		view?:Camera.View;
		area?:Camera.View;
		size?:number[];
	}

	export interface FocusOptions {
		view?: Camera.View;
		duration?: number;
		transition?: Grid.MarkerFocusTransition;
		noViewAni?: boolean;
		exitView?: Camera.View;
		coverLimit?: boolean;
		cover?: boolean;
		blur?: number;
	}
}
