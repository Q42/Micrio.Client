export namespace Enums {
	export namespace Grid {
		/** External grid action types */
		export enum GridActionType {
			/** Filter the grid display by these IDs, comma separated */
			focus,
			/** Fly the camera to the bounding box of these in-grid image IDs */
			flyTo,
			/** Filter the grid to the images containing markers that have this custom class name */
			focusWithTagged,
			/** Filter the grid to the images containing markers that have this custom class name, and fly to their views */
			focusTagged,
			/** Reset the grid to its inception state */
			reset,
			/** Go back one grid history step */
			back,
			/** When a grid image is in full-focus, immediately switch to the view as if it were in the initial grid */
			switchToGrid,
			/** If there is a current MarkerTour going on, filter the grid to all grid images that are part of the tour */
			filterTourImages,
			/** Single time fade duration for next image that will be navigated to */
			nextFadeDuration,
		}
	}

	export namespace Camera {
		/** Camera animation timing function */
		export enum TimingFunction {
			'ease',
			'ease-in',
			'ease-out',
			'linear'
		};
	}
}