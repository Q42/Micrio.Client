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
	/** Instantly switch a focused image back to its position within the grid layout. */
	switchToGrid,
	/** Filter the grid to show only images that are part of the currently active marker tour. */
	filterTourImages,
	/** Set a one-time crossfade duration for the *next* grid transition. Data: duration in seconds. */
	nextFadeDuration,
}
