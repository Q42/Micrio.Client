import type { Camera } from './camera';
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
		'appear-delayed'|
		'in-from-id'
	)

	/** Virtual ImageInfo extension to support grid logic */
	export interface GridImage {
		id: string;
		size: [number, number?];
		area?: Camera.View;
		view?: Camera.View;
		/** Force this entry to render as an empty placeholder cell, even though it has an `id` */
		empty?: true | false;
		/**
		 * Optional source image id to animate this entry in from.
		 * Only applied for `grid.set(..., { transition: 'in-from-id' })` and only when this image is newly added.
		 */
		from?: string;
		/** Optional stacking order override (higher values render on top). */
		z?: number;
	}

	/** An empty placeholder cell in a grid layout, occupying grid space without an image */
	export interface GridEmptyCell {
		/** Explicit marker for an empty placeholder cell */
		empty?: true | false;
		id?: undefined;
		/** Cell span as [columns, rows?], defaults to a 1x1 cell */
		size?: [number, number?];
	}

	/** A single grid layout entry: an image, or an empty placeholder cell */
	export type GridEntry = GridImage | GridEmptyCell;

	/* @internal */
	export interface GridHistory {
		layout: { id: string; view?: Camera.View; size?: [number, number?] }[];
		horizontal: boolean;
		view?: Camera.View;
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
