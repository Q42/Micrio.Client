import type { Camera } from './camera';
import type { Assets } from './assets';
import type { ImageInfo, GalleryConfig } from './info';
import type { Grid } from './grid';
import type { I18n, RevisionType } from './common';
import type { VideoTourInstance } from '$media/videotour';
import type { MicrioImage } from '$core/image';
import type { MicrioIcon } from '$ui/icons';
import type { Spaces } from './spaces';


/**
* # Image content data
* 
* The image content {@link ImageData} JSON object, which is accessible as {@link MicrioImage.data} as the Writable store, and {@link MicrioImage.$data} for its current value.
* 
* This JSON data includes, for all published languages for this image:
* 
* * Markers
* * Marker tours
* * Video tours
* * Audio, music
* * In-image embeds
* * Custom menu screens and content pages
* 
* To access the data of the current viewed image, use:
* 
* ```js
* // The current shown image value of the .data store Writable
* const data = micrio.$current.$data;
* 
* if(data) console.log(`The current image has ${data.markers.length} markers!`);
* else console.warn('The current image has no data set.');
* ```
* 
* To subscribe to any data changes:
* 
* ```js
* micrio.$current.data.subscribe(data => {
* 	console.log('Image has new or updated data!', data);
* })
* ```
* 
* To set your own custom data:
* 
* ```js
* micrio.$current.data.set({
* 	"markers": [
* 		{
* 			"i18n": {
* 				"en": {
* 					"title": "This is a test marker!"
*				}
*			},
* 			"x": .5,
* 			"y": .5
* 		}
* 	]
* })
* ```
* 
* Or to update an existing loaded data object:
* 
* ```js
* micrio.$current.data.update(data => {
* 	data.markers.push({
* 		"i18n": {
* 			"en": {
* 				"title": "This is a newly added marker"
*			}
*		},
* 		"x": .6,
* 		"y": .5
* 	});
* 	return data;
* })
* ```
*/
export namespace ImageData {
	/** The main data JSON structure */
	export type ImageData = {
		/** V5+: Save revision */
		revision?: RevisionType;
		/** Localized image details */
		i18n?: I18n<ImageDetailsCultureData>;
		/** Markers */
		markers?: ImageData.Marker[];
		/** Marker tours */
		markerTours?: ImageData.MarkerTour[];
		/** Video tours */
		tours?: ImageData.VideoTour[];
		/** In-image embeds */
		embeds?: ImageData.Embed[];
		/** Custom menu pages */
		pages?: ImageData.Menu[];
		/** Music playlist */
		music?: {
			/** The audio assets */
			items: Assets.Audio[];
			/** Loop the playlist */
			loop: boolean;
			/** The music audio volume [0-1] (default: `1`) */
			volume?: number;
		};
	}

	export interface ImageDetailsCultureData {
		/** Optional lang-specific image title */
		title?: string;
		/** Optional lang-specific image description */
		description?: string;
		/** Image copyright information */
		copyright?: string;
		/** Original source URI */
		sourceUrl?: string;
	}

	export interface MarkerCultureData {
		/** The main marker title */
		title?: string;
		/** The marker url slug */
		slug?: string;
		/** Alternative title to display as marker label */
		label?: string;
		/** Marker main body HTML */
		body?: string;
		/** Marker secondary body HTML */
		bodySecondary?: string;
		/** Audio asset */
		audio?: Assets.Audio;
		/** An optional iframe embed url */
		embedUrl?: string;
		/** Embed title */
		embedTitle?: string;
		/** Embed description */
		embedDescription?: string;
	}


	/** A Marker */
	export type Marker = {
		/** The marker ID */
		id: string;
		/** The relative marker X coordinate [0-1] */
		x: number;
		/** The relative marker Y coordinate [0-1] */
		y: number;

		i18n?: I18n<MarkerCultureData>;

		/** Omni-objects: radius from center */
		radius?: number;
		/** Rotation is concave: it's on the back of a front-rounded shape */
		backside?: boolean;
		/** Omni-objects: offset rotation in radians */
		rotation?: number;
		/** Omni-objects: custom visibility between these radians */
		visibleArc?: [number, number];

		/** The viewport to zoom to when the marker is opened */
		view?: Camera.View;

		/** If an image has multiple layers, switch to this layer */
		imageLayer?: number;

		/** Content type, for displaying */
		type?: ('default' | 'image' | 'audio' | 'video' | 'media' | 'link' | 'waypoint' | 'cluster');

		/** Popup type */
		popupType?: ('popup'|'popover'|'none'|'micrioLink');

		/** If type is area, this HTML embed will be used for the marker */
		clickableArea?: Embed;

		/** Custom marker tags which will be also used as classnames on the marker elements */
		tags?: string[];

		/** Autoplay the audio asset when the marker is opened */
		audioAutoPlay?: boolean;

		/** Autoplay video embed when the marker is opened */
		embedAutoPlay?: boolean;

		/** Don't draw a marker element */
		noMarker?: boolean;

		/** A custom HTML element instead of the default <button> */
		htmlElement?: HTMLElement;

		/** Having the embed iframe printed mutes audio */
		embedMutesAudio?: boolean;

		/** Images inside marker popup */
		images?: Assets.Image[];

		/** Video tour which plays when the marker is opened */
		videoTour?: VideoTour;

		/** Positional audio asset */
		positionalAudio?: Assets.AudioLocation;

		/** Optional function that overrides all behavior */
		onclick?: (m:ImageData.Marker) => void;

		/** Additional options */
		data?: MarkerData;
	}

	/** Optional individual marker settings */
	export type MarkerData = {
		/** A custom marker icon image */
		icon?: Assets.Image;
		/** A predefined custom icon idx in MarkerSettings */
		customIconIdx?: number;
		/** This marker links to this image */
		micrioLink?: Partial<ImageInfo.ImageInfo>;
		/** Don't animate the camera when opening this marker */
		noAnimate?: boolean;
		/** Show the title below the marker
		 * @deprecated Use the main marker setting for this
		*/
		showTitle?: boolean;
		/** Don't open a large image viewer/gallery on image click */
		preventImageOpen?: boolean;
		/** Force a marker popup no matter what */
		notEmpty?: boolean;
		/** Jump the camera when opening this marker */
		doJump?: boolean;
		/** This marker is not closeable */
		alwaysOpen?: boolean;
		/** The marker scales with the zooming image */
		scales?: boolean;
		/** Grid tour transition animation */
		gridTourTransition?: Grid.MarkerFocusTransition;
		/** Optional custom settings. This is the "Custom JSON" field in the marker editor */
		_meta?: {
			/** For in grid multi-image tour, this step is in grid view */
			gridView?: boolean;
			/** Custom grid actions, action and action data |-separated */
			gridAction?: string;
			/** When opening this marker inside a grid, resize the tile to this */
			gridSize?: number|string;
			/** Any other value is accepted */
			[key:string]: any;
		}
	};

	/**
	 * An embedded element inside the main image. This could be an image,
	 * iframe embed, or simple empty HTML element (Spaces).
	 * This is created in the [Micrio editor](https://dash.micr.io/) or Spaces.
	 */
	 export type Embed = Partial<ImageInfo.ImageInfo> & {
		/** The area inside the main image to place the embed */
		area: Camera.View;

		/** Original asset url */
		src?: string;
		/** An optional iframe src url */
		frameSrc?: string;
		/** Autoplay YT/Vimeo */
		autoplayFrame?: boolean;

		/** Optional title */
		title?: string;

		/** An optional Micrio ID */
		micrioId?: string;
		/** Optional image width */
		width?: number;
		/** Optional image height */
		height?: number;
		/** Optional isPng */
		isPng?: boolean;
		/** IsWebP */
		isWebP?: boolean;
		/** Opacity */
		opacity?: number;

		/** Click interaction */
		clickAction?: ('markerId'|'href')
		/** Click action target */
		clickTarget?: string;
		/** Opens link in new window */
		clickTargetBlank?: boolean;

		/** Unique instance ID */
		uuid?: string;

		/** Relative scale for IFRAME embed in 360 */
		scale?: number;
		/** X rotation in 360 */
		rotX?: number;
		/** Y rotation in 360 */
		rotY?: number;
		/** Z rotation in 360 */
		rotZ?: number;

		scaleX?: number;
		scaleY?: number;

		/** A video asset */
		video?: Assets.Video & {
			/** Don't play video when smaller than % of screen */
			pauseWhenSmallerThan?: number;
			/** Don't play video when larger than % of screen */
			pauseWhenLargerThan?: number;
		};

		/** Hide while not playing video/media */
		hideWhenPaused?: boolean;
	}

	export interface TourCultureData {
		/** The tour title */
		title?: string;
		/** The tour url slug */
		slug?: string;
		/** The tour description */
		description?: string;
	}

	/** The MicrioTour abstract shared class for both {@link MarkerTour} and {@link VideoTour}
	 * @abstract
	*/
	export type Tour = {
		/** The tour id */
		id: string;
		/** Localized tour culture data */
		i18n?: I18n<TourCultureData>;
		/** Auto-minimize controls while playing and idle */
		minimize?: boolean;
		/** Cannot close this tour */
		cannotClose?: boolean;
		/** Exit the tour on finish */
		closeOnFinish?: boolean;
	}

	/** A single videotour timeline viewport */
	export type VideoTourView = {
		/** Start time in seconds */
		start: number;
		/** End time in seconds */
		end: number;
		/** Viewport name */
		title?: string;
		/** View rectangle */
		rect: Camera.View;
	};

	export interface VideoTourCultureData extends TourCultureData {
		/** The tour duration in seconds */
		duration: number;
		/** An optional audio file */
		audio?: Assets.Audio;
		/** Optional subtitles */
		subtitle?: Assets.Subtitle;
		/** The timeline data */
		timeline: VideoTourView[];
		/** Custom events in tour timeline */
		events: Event[];
	}

	/**
	 * A Micrio video tour -- a timed sequence of viewport, with optional audio file.
	 * This is created in the [Micrio editor](https://dash.micr.io/).
	 */
	export type VideoTour = Tour & {
		/** Localized videotour culture data */
		i18n?: I18n<VideoTourCultureData>;
		/** Don't hide the markers when running */
		keepMarkers?: boolean;
		/** Don't disable user navigation when running */
		keepInteraction?: boolean;

		/** Current running tour instance */
		instance?: VideoTourInstance;
	}

	/** Timed events inside a {@link VideoTour} */
	export type Event = {
		/** Start time in seconds */
		start: number;
		/** End time in seconds */
		end: number;
		/** Custom event name */
		action?: string;
		/** Custom event data */
		data?: string;
		/** Optional ID to hook to */
		id?: string;
		/** The event is currently active */
		active?: boolean;
	}

	/**
	 * A Micrio marker tour -- a sequence of markers, which the user can navigate
	 * through. This is created in the [Micrio editor](https://dash.micr.io/).
	 */
	 export type MarkerTour = Tour & {
		/** Tour steps */
		steps: string[];
		/** No user controls */
		noControls?: boolean;
		/** Optional tour image asset */
		image?: Assets.Image;
		/** This is a scrolling tour */
		scrollable?: boolean;
		/** Don't reset view when tour ends */
		keepLastStep?: boolean;
		/** Chapter-based multi-video serial tour */
		isSerialTour?: boolean;
		/** Print the chapters in the interface */
		printChapters?: boolean;

		/** Internally generated propagated step data by Micrio */
		stepInfo?: MarkerTourStepInfo[];
		/** Internally calculated total duration, sum of all step durations */
		duration?: number;
		/** Current tour step getter */
		currentStep?: number;

		/** Start on this tour step */
		initialStep?: number;

		/** Go to next step -- for running tours */
		next?: () => void;
		/** Go to prev step -- for running tours */
		prev?: () => void;
		/** Go to step -- for running tours */
		goto?: (n:number) => void;
	}

	/** Auto generated metadata for marker tours */
	export type MarkerTourStepInfo = {
		markerId: string,
		micrioId: string,
		duration: number,
		imageHasOtherMarkers?: boolean,
		startView?: Camera.View,
		chapter?: number,
		/** For in grid multi-image tour, stay in the grid view */
		gridView?: boolean,

		/** Media current time */
		currentTime?: number,
		/** Media has ended */
		ended?: boolean
		/** @internal */
		micrioImage?: MicrioImage;
		hasSubtitle?: boolean;
	}

	export interface MenuPageButton {
		/** Localized button title */
		i18nTitle: {[key:string]: string};
		/** Button action type */
		type: ('close'|'marker'|'mtour'|'vtour'|'link');
		/** The action value */
		action?: string;
		/** Link opens in net tab */
		blankTarget?: boolean;
	}

	export interface MenuCultureData {
		/** The menu title */
		title?: string;
		/** For page: iframe embed */
		embed?: string;
		/** For page: content HTML */
		content?: string;
	}

	/**
	 * A custom pop-out menu containing content pages or direct external links to
	 * websites, or direct links to opening a marker.
	 * This is created in the [Micrio editor](https://dash.micr.io/).
	 */
	export type Menu = {
		/** The menu ID */
		id: string;
		/** Localized culture data */
		i18n?: I18n<MenuCultureData>;
		/** Child menu elements */
		children?: Menu[];
		/** Open this marker when clicking menu */
		markerId?: string;
		/** Direct link url for menu button */
		link?: string;
		/** Opens the link in a new window */
		linkTargetBlank?: boolean;
		/** Optional direct action function when clicked */
		action?: Function;
		/** For page: page image */
		image?: Assets.Image;
		/** Custom page action buttons */
		buttons?: MenuPageButton[];

		/** The rendered HTML <menu> element
		 * @internal
		*/
		_button?: HTMLButtonElement;

		/** Optional icon for main toolbar
		 * @internal
		*/
		icon?: MicrioIcon
	}
}

/**
 * A bundled image response from the `bundle.json` endpoint.
 * Contains both info and data for one or more related images in a single response.
 */

export namespace ImageBundle {
	export type BundleImage = {
		id: string;
		info: ImageInfo.ImageInfo;
		data?: ImageData.ImageData;
		settings?: Partial<ImageInfo.Settings>;
	};

	export type BundleResponse = {
		images: BundleImage[];
		organisation?: ImageInfo.Organisation;
		spaces?: {
			id: string;
			data: Spaces.Space;
		}[];
		album?: GalleryConfig;
	};
}
