import type { Camera } from './camera';
import type { ImageInfo } from './info';
export namespace Grid {
	/** Grid .focus() transition from current view */
	export type MarkerFocusTransition = (
		'crossfade'|
		'slide'|
		'slide-horiz'|
		'slide-vert'|
		'slide-up'|
		'slide-down'|
		'slide-right'|
		'slide-left'|
		'swipe'|
		'swipe-horiz'|
		'swipe-vert'|
		'swipe-up'|
		'swipe-down'|
		'swipe-right'|
		'swipe-left'|
		'behind'|
		'behind-left'|
		'behind-right'
	);

	export type GridSetTransition = (
		'crossfade'|
		'behind'|
		'behind-delayed'|
		'appear-delayed'
	)

	/** Virtual ImageInfo extension to support grid logic */
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
		/** Optional target image view */
		view?: Camera.View;
		/** Transition duration in ms */
		duration?: number;
		/** Transition animation, defaults to crossfade */
		transition?: Grid.MarkerFocusTransition;
		/** Set the target viewport immediately */
		noViewAni?: boolean;
		/** Animate the previously focussed image to this view during exit transition */
		exitView?: Camera.View;
		/** Limit the focussed image to cover view, defaults to false */
		coverLimit?: boolean;
		/** Open as cover view, but don't limit it */
		cover?: boolean;
		/** Blur the image during transition, in pixels */
		blur?: number;
	}
}

