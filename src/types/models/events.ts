import type { HTMLMicrioElement } from '$core/element';
import type { Grid } from '$grid/grid';
import type { MicrioImage } from '$core/image';
import type { ImageInfo } from './info';
import type { ImageData } from './data';
import type { Camera } from './camera';
export type MicrioEvent<T = any> = Event & { detail: T };


export interface MicrioEventDetails {
	// General events

	/** The main Micrio image is loaded and fully shown */
	'show': HTMLMicrioElement;
	/** Before the ImageInfo settings are read, this event allows you to alter them */
	'pre-info': ImageInfo.ImageInfo;
	/** Before the ImageData contents are read, this event allows you to alter it */
	'pre-data': { [micrioId: string]: ImageData.ImageData };
	/** The main Micrio element has initialized and is being printed */
	'print': ImageInfo.ImageInfo;
	/** Individual image data is loaded and Micrio will start rendering */
	'load': MicrioImage;
	/** The current image's tiles have finished rendering and it is fully faded in (opacity >= 1) */
	'tiles-rendered': MicrioImage;
	/** The user has switched available languages */
	'lang-switch': string;

	// Camera events
	/** The camera has zoomed */
	'zoom': { image: MicrioImage, view: Camera.View };
	/** The camera has moved */
	'move': { image: MicrioImage, view: Camera.View };
	/** A frame has been drawn */
	'draw': void;
	/** The <micr-io> element was resized */
	'resize': DOMRect;

	// User input events
	/** The user has started panning */
	'panstart': void;
	/** The user has stopped panning */
	'panend': {duration: number, movedX: number, movedY: number};
	/** The user has stopped pinching */
	'pinchstart': void;
	/** The user has stopped pinching */
	'pinchend': {duration: number, movedX: number, movedY: number};

	// Marker events
	/** A marker has been opened and the camera animation is starting */
	'marker-open': ImageData.Marker;
	/** A marker has been fully opened and the camera is done, and popup shown */
	'marker-opened': ImageData.Marker;
	/** A marker has been successfully closed */
	'marker-closed': ImageData.Marker;

	// Marker and video tours
	/** A tour has been successfully started */
	'tour-start': ImageData.Tour;
	/** A tour has been successfully stopped */
	'tour-stop': ImageData.Tour;
	/** A tour's UI interface has automatically minimized */
	'tour-minimize': boolean;

	// Marker Tours
	/** Fires for each marker step in a marker tour */
	'tour-step': ImageData.MarkerTour | ImageData.VideoTour;
	/** A multi-image tour is played/resumed */
	'serialtour-play': ImageData.MarkerTour;
	/** A multi-image tour is paused */
	'serialtour-pause': ImageData.MarkerTour;

	// Video Tours
	/** A video tour has started from the beginning (can be part of a marker tour) */
	'videotour-start': ImageData.VideoTour;
	/** A video tour has ended or is aborted (can be part of a marker tour) */
	'videotour-stop': ImageData.VideoTour;
	/** A video tour is played or resumed */
	'videotour-play': void;
	/** A video tour is paused */
	'videotour-pause': void;
	/** A video tour has ended */
	'tour-ended': ImageData.MarkerTour|ImageData.VideoTour; 
	/** When a video tour has custom events, they will be fired like this */
	'tour-event': ImageData.Event;

	// Main media (video, audio, video tours)
	/** The audio controller has been successfully initialized and can play audio */
	'audio-init': void;
	/** The audio has been muted */
	'audio-mute': void;
	/** The audio has been unmuted */
	'audio-unmute': void;
	/** Fires when there is autoplay audio or video which was disallowed by the browser */
	'autoplay-blocked': void;
	/** Media was blocked from autoplaying */
	'media-blocked': void;
	/** Media has started playing */
	'media-play': void;
	/** Media has stopped playing */
	'media-pause': void;
	/** Media has ended */
	'media-ended': void;
	/** A media timeupdate tick */
	'timeupdate': number;

	// Custom page popovers
	/** A custom popover page was opened */
	'page-open': ImageData.Menu;
	/** A custom popover page was closed */
	'page-closed': ImageData.Menu;

	// Album viewing
	/** Triggers on album image change, containing the ids of the currently shown image(s) */
	'gallery-show': string[];

	// Grid views
	/** The grid controller has initialized */
	'grid-init': Grid;
	/** All images in the grid have loaded */
	'grid-load': void;
	/** The grid layout has changed */
	'grid-layout-set': Grid;
	/** The main grid view is activated */
	'grid-focus': MicrioImage;
	/** The main grid has lost focus, i.e., navigated away */
	'grid-blur': void;

	// Split-screen
	/** A split-screen secondary image has been opened */
	'splitscreen-start': MicrioImage;
	/** A split-screen secondary image has been closed */
	'splitscreen-stop': MicrioImage;

	// Special cases
	/** When there is any user action, this event fires. Deferred and fires at a maximum rate of every 500ms */
	'update': Array<string>;
}


export type MicrioEventMap = {
	[K in keyof MicrioEventDetails]: MicrioEvent<MicrioEventDetails[K]>;
}
