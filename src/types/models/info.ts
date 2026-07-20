import type { Camera } from './camera';
import type { Assets } from './assets';
import type { RevisionType } from './common';
import type { Writable } from '$core/store';
import type { MicrioImage } from '$core/image';

/**
  * # Base image data
  * 
  * The MicrioData.ImageInfo.ImageInfo JSON data object, used to pass to {@link HTMLMicrioElement.open}.
  * 
  * The static image information, such as original resolution, image type, title, and all non-language specific **settings** ({@link ImageInfo.Settings}), such as initial viewport, camera behavior, and 360&deg; settings.
  * 
  * The only required field is `id`. If only the `id` field is specified, Micrio attempts to download the additional image data by itself (`info.json`), published by the Micrio servers. This data will also include image title, and any custom viewing settings set in the image editor.
  * 
  * This is a minimal accepted example:
  * 
  * ```json
  * {
  * 	"id": "dzzLm",
  * }
  * ```
  * 
  * If you have manually entered the image `width` and `height`, _it will not download_ the `info.json` file, assuming you have provided correct and complete data:
  * 
  * ```json
  * {
  * 	"id": "dzzLm",
  * 	"width": 41472,
  * 	"height": 30219
  * }
  * ```
  * 
  * Optionally, when using {@link HTMLMicrioElement} `<micr-io>` tag attributes, these will overwrite whatever is loaded from the server. So if in the Micrio editor you have enabled the fullscreen toggle button, you can disable it in your own HTML using `<micr-io data-fullscreen="false">`.
  * 
  * 
  */
export namespace ImageInfo {
	/** A Micrio image's main static image data object */
	export type ImageInfo = {
		/** The image id */
		id: string;
		/** The image base path URI, with a trailing `/`
		 * @default https://b.micr.io/
		*/
		path: string;

		/** The Micrio version this image was created in
		 * @default autoloaded
		*/
		version: string;

		/** Created date */
		created?: number;

		/** Has new viewport model, optimized for 360 images. Server-side only, not read client-side. */
		viewsWH?: boolean;

		/** For V5+: published revisions per language */
		revision?: RevisionType;

		/** The original image width
		 * @default autoloaded
		*/
		width: number;
		/** The original image height
		 * @default autoloaded
		*/
		height: number;
		/** The original tile size in px
		 * @default 1024
		*/
		tileSize?: number;

		/** Use an alternative image ID for the image tiles */
		tilesId?: string;

		/** Use an alternative basePath for image tiles */
		tileBasePath?: string;

		/** Optional custom file extension for tiles */
		tileExtension?: string;

		/** Optional watermark image URI */
		watermark?: string;

		/** Force the `path` attribute to be used to get the info.json data */
		forceInfoPath?: boolean;

		/** The image title (default: autoloaded) */
		title?: string;

		/** @deprecated Moved to `bundle.json` top-level `organisation` */
		organisation?: ImageInfo.Organisation;
		/** The initial data language */
		lang?: string;
		/** The image is 360 degrees */
		is360?: boolean;
		/** The image tiles are in WebP format */
		isWebP?: boolean;
		/** The image tiles are in PNG format */
		isPng?: boolean;
		/** The tiled image is in DeepZoom format */
		isDeepZoom?: boolean;
		/** The image has a IIIF source */
		isIIIF?: boolean;
		/** Use a custom, single source uri for the zoomable image / video */
		isSingle?: boolean;
		/** A custom format (`dz` for DeepZoom, `iiif` for IIIF) */
		format?: string;

		/** The album (V5+) ID */
		albumId?: string;

		/** Is a video (used for embeds), keep rendering when in view
		 * @internal
		*/
		isVideo?: boolean;

		/** The IIIF spec'd `tiles` object
		 * @internal
		*/
		tiles?: { [key: string]: number }[];

		/** The 360 tour space ID */
		spacesId?: string;
	}

	export interface Organisation {
		name: string;
		slug: string;
		baseUrl?: string;
		href?: string;
		logo?: Assets.Image;
		gtmId?: string;
		branding?: boolean;
		fontFamily?: string;
	};

	/** Micrio image settings, which is on load included as {@link ImageInfo}`.settings`. */
	export type Settings = {
		/** The starting viewport */
		view?: Camera.View;
		/** Restrict navigation to this viewport (`[x0, y0, width, height]`) */
		restrict?: Camera.View;
		/** Load a cover-initing image focussed on this coordinate (`[x, y]`) */
		focus?: [number, number];

		/** When opening the image without a predefined deeplink, open this */
		start?: {
			type: ('marker'|'markerTour'|'tour'|'page');
			id: string;
		}

		/** Use a custom uri for the info json file */
		infoUrl?: string;
		/** Render this image as a static image */
		static?: boolean;
		/** Use a custom thumbnail image uri */
		thumbSrc?: string;
		/** The starting viewport. Possible values `cover` and `contain`. Defaults to `contain` */
		initType?: string;
		/** The user cannot zoom out more than a fully covered view */
		limitToCoverScale?: boolean;
		/** Initialize the image when the container is scrolled into view (default: `false`) */
		lazyload?: number;
		/** Don't load any custom JS or CSS scripts */
		noExternals?: boolean;
		/** Don't load this image's {@link ImageData.ImageData} (markers, tours, etc) */
		skipMeta?: boolean;
		/** Don't auto-load first available non-preferred data language */
		onlyPreferredLang?: boolean;
		/** Do a crossfade when navigating between images (default: true) */
		fadeBetween?: boolean;
		/** Optional image crossfade duration, in seconds */
		crossfadeDuration?: number;
		/** Embedded images/videos fade in/out duration, in seconds */
		embedFadeDuration?: number;
		/** When being re-shown, always restart */
		embedRestartWhenShown?: boolean;
		/** Don't stop drawing frames when idle */
		keepRendering?: boolean;
		/** Don't load GTM module */
		noGTag?: boolean;
		/** Skip the deepest zoom levels */
		skipBaseLevels?: number;

		/** The camera animation speed (default: 1) */
		camspeed?: number;
		/** Kinetic dragging sensitivity (default: 1) */
		dragElasticity?: number;
		/** The maximum zoom level in % of the original (default: 1) */
		zoomLimit?: number;
		/** Turn off support for high DPI screens */
		noRetina?: boolean;
		/** Adjust the maximum zoom of high DPI screens to that of regular displays */
		zoomLimitDPRFix?: boolean;
		/** Allow the user to pan and zoom out of image bounds */
		freeMove?: boolean;
		/** When navigating back to this image from another image, reset the initial view */
		resetView?: boolean;
		/** Don't smooth out pixels when zooming in > 100% */
		noSmoothing?: boolean;

		/** Hook user events (default: true) */
		hookEvents?: boolean;
		/** Hook keyboard controls (default: false) */
		hookKeys?: boolean;
		/** Don't allow the user to zoom in or out */
		noZoom?: boolean;
		/** Use the mousewheel or trackpad scrolling for zooming (default: true) */
		hookScroll?: boolean;
		/** Allow pinch to zoom on touch devices (default: true) */
		hookPinch?: boolean;
		/** Allow panning through the image (default: true) */
		hookDrag?: boolean;
		/** Force two-finger panning on touch devices (default: false) */
		twoFingerPan?: boolean;
		/** Force using the CTRL/CMD-keys to zoom in using scrolling (default: false) */
		controlZoom?: boolean;
		/** Don't allow less than minimum scale zooming when pinching */
		pinchZoomOutLimit?: boolean;

		/** Don't load any UI elements */
		noUI?: boolean;
		/** Don't show any controls in the UI */
		noControls?: boolean;
		/** Show a fullscreen button if supported */
		fullscreen?: boolean;
		/** Don't show the Micrio logo on the top left */
		noLogo?: boolean;
		/** Don't show the organisation logo on the top right */
		noOrgLogo?: boolean;
		/** Don't show the menu bar with tours and custom pages */
		noToolbar?: boolean;
		/** Show an info modal with the image title and description */
		showInfo?: boolean;
		/** Show a social sharing button */
		social?: boolean;

		/** Show the minimap (default: true) */
		minimap?: boolean;
		/** Don't fade out the minimap (default: false) */
		alwaysShowMinimap?: boolean;
		/** The minimap maximum width, in px (default: 200) */
		minimapWidth?: number;
		/** The minimap maximum height, in px (default: 160) */
		minimapHeight?: number;

		/** More natural camera zooming animation during transitions (default: `true`) */
		doTourJumps?: boolean;

		/** Enable the audio controller (default: `true`) */
		audio?: boolean;
		/** The starting audio volume [0-1] (default: `1`) */
		startVolume?: number;
		/** The audio volume when other media is playing `[0-1]` (default: `0`) */
		mutedVolume?: number;
		/** Mute the audio when the current browser tab loses focus */
		muteOnBlur?: boolean;

		/** The physical width of the object in cm */
		cmWidth?: number;
		/** The physical height of the object in cm */
		cmHeight?: number;

		/** Overlapping markers are clustered */
		clusterMarkers?: boolean;
		/** The clustered marker radius */
		clusterMarkerRadius?: number;
		/** Dark/light theme */
		theme?: ("dark" | "light" | "os");

		/** Load a custom JS file with this image */
		js?: {
			/** The asset href */
			href: string;
		};
		/** Load a custom CSS file with this image */
		css?: {
			/** The asset href */
			href: string;
		};

		/** All markers are scaled with the image */
		markersScale?: boolean;

		/** Albums */
		gallery?: GalleryConfig;

		/** FOR OMNI OBJECTS */
		omni?: OmniSettings;

		/** Optional marker settings */
		_markers?: MarkerSettings;

		/** Optional settings for 360 images/video */
		_360?: {
			/** A 360 video object */
			video?: Assets.Video;
			/** @deprecated Use `Spaces.SpaceImage.rotationY` (radians). Normalized
			 *  [0,1] image-X offset, 0.5 = identity. Still honoured for back-compat. */
			trueNorth?: number;
			/** 2D embed X rotation in 360 */
			rotX?: number;
			/** 2D embed Y rotation in 360 */
			rotY?: number;
			/** 2D embed Z rotation in 360 */
			rotZ?: number;
			/** 2D embed IFRAME scale */
			scale?: number;
		};

		/** Freeform custom settings, this is the "Custom JSON" field in the image editor */
		_meta?: {
			[key:string]: any;
		};

		/** UI customizations */
		ui?: Partial<UserInterfaceSettings>;

		/** Grid display and interaction settings */
		grid?: {
			/** Click behavior for grid images: `'focus'` expands to full view, `'zoom'` zooms to the image's viewport */
			clickable?: 'focus' | 'zoom';
			/** Pan/zoom behavior: `'cells'` operates on the individual cell under the cursor, `'grid'` operates on the main grid container */
			panZoom?: 'cells' | 'grid';
			/** Transition duration for grid animations, in seconds */
			transitionDuration?: number;
			/** Transition duration when going back, in seconds */
			transitionDurationOut?: number;
		};

		/** ADVANCED: A fragment shader for WebGL postprocessing
		 * This shader MUST have and use:
		 * uniform sampler2D u_image; // the render buffer texture
		 * varying vec2 v_texCoord;   // the texture coordinate
		 * uniform float u_time;      // elapsed time in seconds
		*/
		postProcessingFragmentShader?: string;

		/** Watermark opacity, defaults to 0.075 */
		watermarkOpacity?: number;
	}

	export type OmniSettings = {
		/** Number of frames */
		frames: number;
		/** Starting frame index */
		startIndex: number;
		/** The camera field of view in radians */
		fieldOfView: number;
		/** The camera vertical angle in radians */
		verticalAngle: number;
		/** The distance of the object center to the camera */
		distance: number;
		/** Adjust the center for an object */
		offsetX: number;
		/** Put the labels on the side of the object */
		sideLabels?: boolean;
		/** Which frame is 0deg rotation */
		frontIndex?: number;
		/** Layers */
		layers?: {i18n: {[key:string]: string|undefined}}[];
		/** Optional starting layer idx */
		layerStartIndex?: number;
		/** Hide the rotation dial */
		noDial?: boolean;
		/** Show degrees on dial */
		showDegrees?: boolean;
		/** Gallery is omni object photography over 2 axes */
		twoAxes?: boolean;
		/** Don't add key bindings for rotating */
		noKeys?: boolean;
	}

	/** Image-wide marker settings */
	export type MarkerSettings = {
		/** An image-wise custom marker icon */
		markerIcon?: Assets.Image;
		/** The default marker color */
		markerColor?: string;
		/** The default marker size in px */
		markerSize?: string;
		/** Zoom out when closing a marker */
		zoomOutAfterClose?: boolean;
		/** Relative speed factor when zooming out after close */
		zoomOutAfterCloseSpeed?: number;
		/** Always show the titles for all markers */
		showTitles?: boolean;
		/** Don't print any marker titles at all */
		noTitles?: boolean;
		/** Don't scale titles if marker is scaling */
		titlesNoScale?: boolean;
		/** All markers are sized to their viewports */
		viewportIsMarker?: boolean;
		/** All marker embeds are printed in HTML, not WebGL */
		embedsInHtml?: boolean;
		/** Auto-start a marker tour when just opening marker */
		autoStartTour?: boolean;
		/** Always auto-start a marker tour from the beginning */
		autoStartTourAtBeginning?: boolean;
		/** Auto-progress a tour step when marker media has ended */
		tourAutoProgress?: boolean;
		/** Tour controls in popup */
		tourControlsInPopup?: boolean;
		/** Show tour step counter in marker popup */
		tourStepCounterInPopup?: boolean;
		/** Allow marker popups to be minimized */
		canMinimizePopup?: boolean;
		/** Transition-in animation for popup */
		popupAnimation?: any;
		/** Place primary body text above any media in popup */
		primaryBodyFirst?: boolean;
		/** Prevent all autoplay */
		preventAutoPlay?: boolean;
		/** Don't do anything when clicking markers */
		noMarkerActions?: boolean;
		/** Hide markers when tour is running */
		hideMarkersDuringTour?: boolean;
		/** Keep popup opened in between marker tour steps */
		keepPopupsDuringTourTransitions?: boolean;
		/** Optional custom uploaded icons */
		customIcons?: Assets.Image[];
	}

	/** Custom interface settings */
	export type UserInterfaceSettings = {
		controls?: {
			/** Show the culture switch button if there are multiple available languages */
			cultureSwitch?: boolean;
			/** Serial tour timebar clicking other segment always goes to start of chapter */
			serialTourNoTimeScrub?: boolean;
		},
		icons?: {
			/** The raw SVG string for zoom-in */
			zoomIn?: string;
			/** The raw SVG string for zoom-out */
			zoomOut?: string;
			/** The raw SVG string for fullscreen-start */
			fullscreenEnter?: string;
			/** The raw SVG string for fullscreen-stop */
			fullscreenLeave?: string;
			/** The raw SVG string for close */
			close?: string;
			/** Next step button */
			next?: string;
			/** Previous step button */
			prev?: string;
			/** Play button */
			play?: string;
			/** Pause button */
			pause?: string;
			/** Subtitles icon */
			subtitles?: string;
			/** Subtitles turned off icon */
			subtitlesOff?: string;
			/** Muted icon */
			muted?: string;
			/** Unmuted icon */
			unmuted?: string;
			/** Arrow up icon */
			up?: string;
			/** Arrow down icon */
			down?: string;
		}
	}
}


export interface Album {
	/** The number of pages in this album */
	numPages: number;
	/** The current page index */
	currentIndex: number;
	/** The album info */
	info?: GalleryConfig;
	/** Go to previous page */
	prev: () => void;
	/** Go to next page */
	next: () => void;
	/** Go to specific page index */
	goto: (n:number) => void;
	/** Album has been initialized and hooked */
	hooked?: boolean;
	/** Strip-swipe only: writable store tracking the currently active child
	 * MicrioImage. Consumers (e.g. ZoomButtons) can subscribe to bind their
	 * controls to the image under focus instead of the virtual parent. */
	currentImage?: Writable<MicrioImage>;
}

/** Gallery configuration */
export type GalleryConfig = {
	type: 'swipe' | 'switch' | 'grid';
	startId?: string;
	sort?: 'name' | '-name' | 'created' | '-created' | 'random';
	isSpreads?: boolean;
	coverPages?: number;
	archive?: string;
	archiveLayerOffset?: number;
	revisions?: Record<string, Record<string, any>>;
	settings?: Partial<ImageInfo.Settings>;
	id?: string;
	name?: string;
	grid?: {
		clickable?: 'focus' | 'zoom' | false;
		panZoom?: 'cells' | 'grid';
	};
};
