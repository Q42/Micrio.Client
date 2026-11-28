import type { Camera } from './camera'
export namespace Grid {
	/** Grid .focus() transition from current view */
	export type MarkerFocusTransition =
		| 'crossfade'
		| 'slide'
		| 'slide-horiz'
		| 'slide-vert'
		| 'slide-up'
		| 'slide-down'
		| 'slide-right'
		| 'slide-left'
		| 'swipe'
		| 'swipe-horiz'
		| 'swipe-vert'
		| 'swipe-up'
		| 'swipe-down'
		| 'swipe-right'
		| 'swipe-left'
		| 'behind'
		| 'behind-left'
		| 'behind-right'

	export type GridSetTransition = 'crossfade' | 'behind' | 'behind-delayed' | 'appear-delayed' | 'in-from-id'

	/** Virtual ImageInfo extension to support grid logic */
	export interface GridImage {
		id: string
		size: [number, number?]
		area?: Camera.View
		view?: Camera.View
		/** Force this entry to render as an empty placeholder cell, even though it has an `id` */
		empty?: boolean
		/**
		 * Optional source image id to animate this entry in from.
		 * Only applied for `grid.set(..., { transition: 'in-from-id' })` and only when this image is newly added.
		 */
		from?: string
		/** Optional stacking order override (higher values render on top). */
		z?: number
		/** Optional per-tile cover-fill override (`true` = cover cell, `false` = full image with margins). */
		cover?: boolean
	}

	/** An empty placeholder cell in a grid layout, occupying grid space without an image */
	export interface GridEmptyCell {
		/** Explicit marker for an empty placeholder cell */
		empty?: boolean
		id?: undefined
		/** Cell span as [columns, rows?], defaults to a 1x1 cell */
		size?: [number, number?]
	}

	/** A single grid layout entry: an image, or an empty placeholder cell */
	export type GridEntry = GridImage | GridEmptyCell

	/* @internal */
	export interface GridHistory {
		layout: { id?: string; empty?: boolean; view?: Camera.View; size?: [number, number?] }[]
		horizontal: boolean
		/** Explicit column count the layout was set with, if any */
		columns?: number
		view?: Camera.View
	}

	export interface FocusOptions {
		/** Optional target image view */
		view?: Camera.View
		/** Transition duration in ms */
		duration?: number
		/** Transition animation, defaults to crossfade */
		transition?: Grid.MarkerFocusTransition
		/** Set the target viewport immediately */
		noViewAni?: boolean
		/** Animate the previously focussed image to this view during exit transition */
		exitView?: Camera.View
		/** Limit the focussed image to cover view, defaults to false */
		coverLimit?: boolean
		/** Open as cover view, but don't limit it */
		cover?: boolean
		/** Blur the image during transition, in pixels */
		blur?: number
	}

	/** How a `layout` step selects which images participate. */
	export type GridImageSource =
		| { mode: 'all' }
		| { mode: 'current' }
		| { mode: 'select'; ids: string[] }
		| { mode: 'tags'; tags: string[]; match?: 'any' | 'all'; zoomToMarker?: boolean }
		| { mode: 'tour' }

	/** Per-image modifier rule layered on top of a `layout` step's matched images. */
	export interface GridLayoutRule {
		/** Target image ID, `'$current'` (owning image of the trigger), or `'$first'` (first matched image). */
		target: string
		/** Override cell span `[columns, rows?]`. */
		size?: [number, number?]
		/** Source image ID (or `'$current'` / `'$first'`) to grow from when `transition === 'in-from-id'`. */
		from?: string
		/** Stacking order override. */
		z?: number
		/** Optional camera view inside this image. */
		view?: Camera.View
		/** Optional marker ID on this image to zoom into. */
		markerId?: string
		/** Pin to start (`'prepend'`), end (`'append'`), or keep natural position (`'keep'`). */
		position?: 'keep' | 'prepend' | 'append'
		/** Include this image even if it was not matched by `source`. */
		include?: boolean
		/** Exclude this image from the matched set. */
		exclude?: boolean
		/** Optional per-tile cover-fill override (`true` = cover cell, `false` = full image with margins). */
		cover?: boolean
	}

	/** Explicit cell entry for direct visual mosaic authoring (supports exact order and empty spacers). */
	export interface GridEffectCell {
		/** Image ID (or `'$current'`); omitted when `empty: true`. */
		id?: string
		empty?: boolean
		size?: [number, number?]
		from?: string
		z?: number
		view?: Camera.View
		markerId?: string
		/** Optional per-tile cover-fill override (`true` = cover cell, `false` = full image with margins). */
		cover?: boolean
	}

	/** One executable step inside a {@link GridEffect}. */
	export type GridEffectStep =
		| {
				type: 'layout'
				source?: GridImageSource
				rules?: GridLayoutRule[]
				/** Explicit ordered cells (including empty spacers); overrides `source` when provided. */
				cells?: GridEffectCell[]
				arrangement?: 'auto' | 'row' | 'columns'
				columns?: number
				scale?: number
				transition?: GridSetTransition
				duration?: number
				view?: Camera.View
				cover?: boolean
				noHistory?: boolean
		  }
		| {
				type: 'focus'
				/** Target image ID or `'$current'`. */
				imageId: string
				transition?: MarkerFocusTransition
				duration?: number
				view?: Camera.View
				markerId?: string
				blur?: number
				cover?: boolean
				coverLimit?: boolean
		  }
		| {
				type: 'flyTo'
				imageIds?: string[]
				tags?: string[]
				match?: 'any' | 'all'
				duration?: number
		  }
		| {
				type: 'resize'
				/** Target image ID or `'$current'`. */
				imageId: string
				size: [number, number]
				duration?: number
		  }
		| {
				type: 'reset'
				duration?: number
		  }
		| {
				type: 'back'
				duration?: number
		  }
		| {
				type: 'switchToGrid'
		  }
		| {
				type: 'delay'
				seconds: number
		  }
		| {
				type: 'fadeDuration'
				seconds: number
		  }

	/** A named, reusable Grid Action / Effect executed by `grid.runEffect()`. */
	export interface GridEffect {
		/** Stable unique identifier referenced by Video Tour events and Markers. */
		id: string
		/** Human-readable name displayed in pickers and timelines. */
		name: string
		/** Optional description of what this effect does. */
		description?: string
		/** Optional accent color token for editor badges. */
		color?: string
		/** Ordered sequence of steps executed by this effect. */
		steps: GridEffectStep[]
	}

	/** Context options passed to `grid.runEffect()`. */
	export interface RunEffectOptions {
		/** Default transition duration in seconds when a step omits `duration`. */
		duration?: number
		/** When true, applies the effect's final configuration immediately with zero animation/delays (used for opening/starting effects). */
		instant?: boolean
		/** Owning image ID used to resolve `'$current'` targets. */
		sourceImageId?: string
		/** Triggering marker ID, if triggered by a marker. */
		sourceMarkerId?: string
		/** Fallback focus transition (e.g. a marker's `gridTourTransition`). */
		focusTransition?: MarkerFocusTransition
	}
}
