/**
 * Defines various enums used throughout the Micrio application,
 * primarily for standardizing action types and option values.
 */
export namespace Enums {
	/** Enums related to the Grid functionality. */
	export namespace Grid {
		/**
		 * Defines the types of actions that can be performed on a Grid instance,
		 * often triggered by marker data (`gridAction`) or tour events.
		 */
		export enum GridActionType {
			/** Focus on specific images within the grid, hiding others. Data: comma-separated image IDs. */
			focus,
			/** Animate the main grid view to fit the bounding box of specified images. Data: comma-separated image IDs. */
			flyTo,
			/** Focus on images containing markers with a specific tag. Data: tag name. */
			focusWithTagged,
			/** Focus on images containing markers with a specific tag and fly to the marker views. Data: tag name. */
			focusTagged,
			/** Reset the grid to its initial layout and view. */
			reset,
			/** Navigate back one step in the grid layout history. */
			back,
			/** Instantly switch a focused image back to its position within the grid layout (used internally?). */
			switchToGrid,
			/** Filter the grid to show only images that are part of the currently active marker tour. */
			filterTourImages,
			/** Set a one-time crossfade duration for the *next* grid transition. Data: duration in seconds. */
			nextFadeDuration,
			// TODO: Consider adding 'layout' action type if setting layouts via events is intended.
		}
	}

	/** Enums related to the Camera functionality. */
	export namespace Camera {
		/**
		 * Defines the available timing functions for camera animations (flyToView, flyToCoo).
		 * These correspond to standard CSS easing functions.
		 */
		export enum TimingFunction {
			'ease', // Default ease-in-out
			'ease-in',
			'ease-out',
			'linear'
		};
	}
}