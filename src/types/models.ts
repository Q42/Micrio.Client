
/// <reference types="svelte" />

import type { HTMLMicrioElement } from '../ts/element';
import type { Grid } from '../ts/grid';
import type { MicrioImage } from '../ts/image';
import type { VideoTourInstance } from '../ts/videotour';
import type { Writable } from 'svelte/store';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';


/**
 * # Micrio JSON data model
 * 
 * This page details the data models used by Micrio.
 * 
 * This data is created in the [Micrio editor](https://dash.micr.io/), and published as static JSON file per image, and optionally any language-specific data such as image markers, tours, audio, etc.
 * 
 * Each Micrio image uses two data sources, which are retrieved from the Micrio servers:
 * 
 * 1. **{@link ImageInfo}**: `info.json`: the base image data such as resolution, image type, and basic image settings. This is accessible in JS as {@link MicrioImage.info} as the Readable store, and {@link MicrioImage.$info} for its current value.
 * 
 * 2. **{@link ImageData}**: `pub.json`: all published image content, which is accessible in JS as {@link MicrioImage.data} as the Writable store, and {@link MicrioImage.$data} for its current value.
 * 
 */
 export namespace Models {
	export type RevisionType = {[key:string]: number}

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
			version: number;

			/** Created date */
			created?: number;

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
			 * @default autoloaded
			*/
			tileSize: number;

			/** Use an alternative image ID for the image tiles */
			tilesId?: string;

			/** Use an alternative basePath for image tiles */
			tileBasePath?: string;

			/** Optional custom file extension for tiles */
			tileExtension?: string;

			/** Force the `path` attribute to be used to get the info.json data */
			forceInfoPath?: boolean;

			/** The image settings, such as viewport/UI settings, camera and user event behavior
			 * NOTE: to modify this at runtime, use the MicrioImage.settings Writable store.
			*/
			settings?: Partial<ImageInfo.Settings>;

			/** Optional organisation data */
			organisation?: ImageInfo.Organisation;

			/** The image title (default: autoloaded) */
			title?: string;
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
			/** Optional IIIF source for tiles */
			iiifManifest?: string;

			/** The album (V5+) ID */
			albumId?: string;

			/** Create a gallery with these images (parsed from html attr `gallery`)
			 * @internal
			*/
			gallery?: MicrioImage[];

			/** Image is a grid controller
			 * @internal
			*/
			grid?: string;

			/** Is a video (used for embeds), keep rendering when in view
			 * @internal
			*/
			isVideo?: boolean;

			// IIIF
			/** The IIIF spec'd `tiles` object
			 * @internal
			*/
			tiles?: { [key: string]: number }[];
			/** Multiple IIIF-spec'd sources
			 * @internal
			*/
			sources?: string;
			/** Single-canvas sequence
			 * @internal
			*/
			sequences?: {
				viewingDirection?: string;
				canvases: {
					images: {
						resource: {
							width: number,
							height: number,
							format: string,
							service: {
								'@id': string
							}
						}
					}[]
				}[]
			}[];

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
			/** The starting viewport (`[x0,y0,x1,y1]`) */
			view?: Camera.View;
			/** Restrict navigation to this viewport (`[x0,y0,x1,y1]`) */
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
			/** Force refresh for published data JSON file */
			forceDataRefresh?: boolean;
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
			/** With routing enabled, enable marker/tour deeplinks */
			routerMarkerTours?: boolean;
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
			/** A static split-screen Micrio Image ID */
			micrioSplitLink?: string;
			/** When this is a secondary image in split screen, allow independent navigating */
			secondaryInteractive?: boolean;
			/** When this is a secondary image, don't follow the main image's navigation */
			noFollow?: boolean;

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
			gallery?: GallerySettings;
			album?: AlbumInfo; /** V5 only */

			/** FOR OMNI OBJECTS */
			omni?: OmniSettings;

			/** Optional marker settings */
			_markers?: MarkerSettings

			/** Optional settings for 360 images/video */
			_360?: {
				/** A 360 video object */
				video?: Assets.Video;
				/** Y rotation true north correction */
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

			/** Grid: can click individual grid images */
			gridClickable?: boolean;
			/** Grid: transition duration, in seconds */
			gridTransitionDuration?: number;
			/** Grid: transition duration going back, in seconds */
			gridTransitionDurationOut?: number;

			/** ADVANCED: A fragment shader for WebGL postprocessing
			 * This shader MUST have and use:
			 * uniform sampler2D u_image; // the render buffer texture
			 * varying vec2 v_texCoord;   // the texture coordinate
			 * uniform float u_time;      // elapsed time in seconds
			*/
			postProcessingFragmentShader?: string;
		}

		export type GallerySettings = {
			/** Gallery has an associated .bin archive with thumbnails */
			archive?: string;
			/** Archive layer offset */
			archiveLayerOffset?: number;
			/** Gallery sorting */
			sort?: ('name'|'-name'|'created'|'-created');
			/** Gallery type */
			type?: ('swipe'|'swipe-full'|'switch'|'omni'|'grid');
			/** The gallery opening image ID */
			startId? :string;
			/** Pages are combined to 2x1 spreads */
			isSpreads?: boolean;
			/** For spreads, number of cover pages to show as single page */
			coverPages?: number;
			revisions?: {[key:string]: RevisionType};
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
			/** Svelte transition-in animation for popup */
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
				cultureSwitch?: boolean,
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
			i18n?: {[key:string]: ImageDetailsCultureData};
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

			i18n?: {[key:string]: MarkerCultureData};

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
			popupType: ('popup'|'popover'|'none'|'micrioLink');

			/** Custom marker tags which will be also used as classnames on the marker elements */
			tags: string[];

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
			/** This marker opens secondary split image with id */
			micrioSplitLink?: string;
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
				/** Deprecated split screen link
				 * @deprecated Removed in 4.3
				 * @internal
				*/
				secondary?: string;
				/** For in grid multi-image tour, this step is in grid view */
				gridView?: boolean;
				/** Custom grid actions, action and action data |-separated */
				gridAction?: string;
				/** When opening this marker inside a grid, resize the tile to this */
				gridSize?: number|string;
				/** Any other value is accepted */
				[key:string]: any;
			}

			/** Parsed micrioSplitLink
			 * @internal
			*/
			_micrioSplitLink?: {
				micrioId: string,
				markerId?: string,
				follows?: boolean,
				view?: Camera.View
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
			i18n?: {[key:string]: TourCultureData};
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
			i18n?: {[key:string]: VideoTourCultureData};
			/** Don't hide the markers when running */
			keepMarkers?: boolean;
			/** Don't disable user navigation when running */
			keepInteraction?: boolean;

			/** Current running tour instance */
			instance?: VideoTourInstance;
		}

		/** Timed events inside a {@link ImageData.VideoTour} */
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
			marker: Marker,
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
			i18n?: {[key:string]: MenuCultureData};
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
			icon?: IconDefinition
		}
	}

	export namespace Assets {
		export type BaseAsset = {
			/** The asset title (not filename) */
			title: string;
			/** The asset file name */
			fileName?: string;
			/** The file uri */
			src: string;
			/** File size in bytes */
			size: number;
			/** Created */
			uploaded: number;
		}

		export type Audio = BaseAsset & {
			/** The sample duration */
			duration: number;
			/** The sample volume */
			volume: number;
		}

		export type AudioLocation = Audio & {
			/** Autoplay the sample */
			alwaysPlay: boolean;
			/** Loop the audio */
			loop: boolean;
			/** Pause X seconds between plays */
			repeatAfter: number;
			/** Don't play on mobile */
			noMobile: boolean;
			/** The radius of the audible circle */
			radius: number;
		};

		/** An image asset uploaded in the Micrio editor */
		export type Image = BaseAsset & {
			id?: string;
			/** The image original width */
			width: number;
			/** The image original height */
			height: number;
			/** If the image is available as Micrio image, its ID */
			micrioId?: string;
			/** If the image has a Micrio version, optional alternative image tile ID */
			tilesId?: string;
			/** Is PNG */
			isPng?: boolean;
			/** IsWebP */
			isWebP?: boolean;
			/** Used DeepZoom format */
			isDeepZoom?: boolean;
			/** V5+: Translatable description */
			i18n?: {
				[key:string]: {
					title?: string;
					description?: string;
				}
			}
		}

		export type Video = BaseAsset & {
			/** The video width */
			width: number;
			/** The video height */
			height: number;
			/** The video duration */
			duration: number;
			/** Video is muted */
			muted: boolean;
			/** Video loops */
			loop: boolean;
			/** Video loops after X seconds waiting */
			loopAfter?: number;
			/** Video autoplays */
			autoplay: boolean;
			/** Cloudflare Stream ID */
			streamId?: string;
			/** Show controls */
			controls: boolean;
			/** Video has alpha transparency */
			transparent: boolean;
			/** Video has a separately uploaded Mac H265 transparent src */
			hasH265?: boolean;
		}

		export type Subtitle = BaseAsset;
	}

	/** 360 tours, formerly SPACES */
	export namespace Spaces {
		export interface SpaceImage {
			/** The Micrio ID */
			id: string;
			/** X position of 360 image in zone */
			x: number;
			/** Y position of 360 image in zone */
			y: number;
			/** Z position of 360 image in zone */
			z: number;
			/** RotationY => .trueNorth */
			rotationY: number;
		}

		export interface Space {
			/** The 360 image */
			images:SpaceImage[];
			/** The zone name */
			name: string;
			/** 360 linked Micrio IDs */
			links: [string, string, {[key:string]: WayPointSettings}?][];
			/** Custom icon lib */
			icons?: Assets.Image[];
			/** Multi-image marker tours */
			markerTours?: ImageData.MarkerTour[];
		}

		export interface WaypointInterface {
			el?:HTMLElement;
			settings: WayPointSettings;
			coords: WaypointCoords;
			deleted?: boolean;
		}

		export interface WayPointSettings {
			i18n: {[key:string]: {
				title: string;
			}};

			/** A predefined custom icon idx */
			customIconIdx?: number;

			coords?: WaypointCoords;
		}

		export type DirectionVector = [number, number, number];

		export interface WaypointCoords {
			x: number;
			y: number;

			baseScale: number;
			scale: number;

			rotX: number;
			rotY: number;
			rotZ: number;

			custom?:boolean;
		}
	}

	/** OmniImages */
	export namespace Omni {
		export interface Frame {
			id: string;
			image: MicrioImage;
			visible: Writable<boolean>;
			frame: number;
			thumbSrc?: string;
			baseTileIdx: number;
			ptr: number;
			opts: { area: Camera.View; };
		}
	}

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

	/** Albums */
	export interface AlbumInfo {
		/** The album ID */
		id: string;
		/** The album name */
		name: string;
		/** The album UX type */
		type: ('swipe'|'switch'|'grid');
		/** The album image sorting */
		sort?: ('name'|'-name'|'created'|'-created');
		/** Album pages are shown as book spreads */
		isSpreads?: boolean;
		/** The number of single cover pages in case of spreads */
		coverPages?: number;
		/** Published revision number */
		revision: number;
		/** Available page data (markers, etc) */
		published: {[key:string]: RevisionType};
		/** Album organisation */
		organisation?: ImageInfo.Organisation;
	}

	export interface Album {
		/** The number of pages in this album */
		numPages: number;
		/** The current page index */
		currentIndex: number;
		/** The album info */
		info?: AlbumInfo;
		/** Go to previous page */
		prev: () => void;
		/** Go to next page */
		next: () => void;
		/** Go to specific page index */
		goto: (n:number) => void;
		/** Album has been initialized and hooked */
		hooked?: boolean;
	}

	export namespace Camera {
		/** A viewport rectangle */
		export type View = number[]|Float64Array;

		/** Coordinate tuple, [x, y, scale] */
		export type Coords = [number, number, number?]|Float64Array;

		/** A 360 vector for use in Spaces */
		export type Vector = {
			direction: number;
			distanceX: number;
			distanceY: number;
		};

		export type TimingFunction = ('ease'|'ease-in'|'ease-out'|'linear');

		export interface AnimationOptions {
			/** Animation duration in ms */
			duration?: number;
			/** Limit the viewport to fill the screen */
			limit?: boolean;
			/** In case of automatic duration, speed factor (1 = 100%) */
			speed?: number;
			/** Transition timing function */
			timingFunction?: TimingFunction
		}		
	}

	export namespace Embeds {
		export interface EmbedOptions {
			/** The embed opacity */
			opacity?: number;
			/** Do not print this embed until this zoom level (% of original) */
			fromScale?: number;
			/** The embed will have a minimal memory footprint, without its own camera */
			asImage?: boolean;
			/** Fit the embed's original size into the specified area. Defaults to 'stretch' */
			fit?: ('contain'|'cover'|'stretch');
		}		
	}

	export namespace State {
		/** Popover interface state type */
		export interface PopoverType {
			contentPage?: ImageData.Menu;
			image?: MicrioImage;
			marker?: ImageData.Marker;
			markerTour?: ImageData.MarkerTour;
			gallery?: Assets.Image[];
			galleryStart?: string;
			showLangSelect?: boolean;
		}
	}

	export namespace Canvas {
		export interface ViewRect {
			width:number;
			height:number;
			left:number;
			top:number;
			ratio:number;
			scale:number;
			portrait:boolean;
		}
	}
	
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
		'tour-step': ImageData.MarkerTour|ImageData.VideoTour; 
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
		/** Triggers on album image change */
		'gallery-show': number; 

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

		// Splitscreen views
		/** Split screen mode has started */
		'splitscreen-start': MicrioImage; 
		/** Split screen mode has stopped */
		'splitscreen-stop': MicrioImage; 

		// Special cases
		/** When there is any user action, this event fires. Deferred and fires at a maximum rate of every 500ms */
		'update': Array<string>; 
	}
	
	export type MicrioEventMap = {
		[K in keyof MicrioEventDetails]: MicrioEvent<MicrioEventDetails[K]>;
	}

	export namespace Attributes {
		export interface MicrioCustomAttributes {
			// General settings
			/** The image ID */
			'id'?: string;
			/** The data language code to use. Default: 'en' */
			'lang'?: string;
			/** For custom hosted Micrio images, specify the root URL. Default: Based on image */
			'data-path'?: string;
			/** Set this to 'cover' to start the image using the full viewport. Default: undefined */
			'data-inittype'?: string;
			/** The user cannot zoom out further than the full viewport. Default: undefined */
			'data-coverlimit'?: boolean;
			/** Only start loading the image when it's been scrolled into the user's view. Default: false */
			'lazyload'?: boolean;
			/** Do not load any metadata (markers, tours, etc). Default: false */
			'data-skipmeta'?: boolean;
			/** Simulate an <img/> element. No logo, loader bar, and no event listeners. Default: false */
			'data-static'?: boolean;
			/** Read and write deeplinks to opened tours and markers. Default: null */
			'data-router'?: string;
			/** Sending user input as GA Events to any available GTag instance (does nothing if none). Default: true */
			'data-gtag'?: boolean;

			// Camera controls
			/** Set the speed factor for camera animations. Default: 1 */
			'data-camspeed'?: number;
			/** Can pan outside the image's limits. Default: false */
			'data-freemove'?: boolean;
			/** Set the percentage (1=100%) of how far a user can zoom in. Default: 1 */
			'data-zoomlimit'?: number;
			/** Set the initial viewport rectangle of the image. Default: [0,0,1,1] */
			'data-view'?: number[];
			/** Set focus point of the image, treated as the center in case of image overflows. Default: [0.5, 0.5] */
			'data-focus'?: number[];
			/** Keep drawing frames, even if there is no movement. Default: false */
			'data-keeprendering'?: boolean;
			/** When turned off, high DPI screens will have its zoom limited to visually 100% of pixel size. Default: true */
			'data-normalize-dpr'?: boolean;

			// User input
			/** No event handlers will be set up, and the image will be non-interactive. Default: true */
			'data-events'?: boolean;
			/** Use your keyboard to navigate through the image. Default: false */
			'data-keys'?: boolean;
			/** Use trackpad/touchscreen pinching for zooming. Default: true */
			'data-pinch-zoom'?: boolean;
			/** Use mousewheel/trackpad scrolling for zooming. Default: true */
			'data-scroll-zoom'?: boolean;
			/** The user must press CTRL/CMD when zooming with the mousewheel. Default: false */
			'data-control-zoom'?: boolean;
			/** Requires the user to use two fingers to pan the image on touch devices. Default: false */
			'data-two-finger-pan'?: boolean;
			/** The user cannot zoom at all. Default: true */
			'data-zooming'?: boolean;
			/** Use dragging and touch events for panning. Default: true */
			'data-dragging'?: boolean;

			// User interface
			/** No HTML UI elements will be printed. Default: true */
			'data-ui'?: boolean;
			/** No control buttons will be printed. Default: true */
			'data-controls'?: boolean;
			/** Show a fullscreen switching button on supported platforms. Default: true */
			'data-fullscreen'?: boolean;
			/** Show a social sharing link menu. Default: false */
			'data-social'?: boolean;
			/** The Micrio logo is displayed. Default: true */
			'data-logo'?: boolean;
			/** The optional Organisation logo (top right) will be hidden. Default: true */
			'data-logo-org'?: boolean;
			/** No top menu bar will be printed. Default: true */
			'data-toolbar'?: boolean;
			/** Show an image info panel with the title and description. Default: false */
			'data-show-info'?: boolean;
			/** An interactive minimap will be shown. Default: false */
			'data-minimap'?: boolean;
			/** The minimap will always be visible. Default: true */
			'data-minimap-hide'?: boolean;
			/** The minimap height in pixels. Default: 160 */
			'data-minimap-height'?: number;
			/** The minimap width in pixels. Default: 200 */
			'data-minimap-width'?: number;

			// Audio
			/** All audio will be disabled if this attribute is present. */
			'muted'?: boolean;
			/** The general sound volume for music/sfx (between 0 and 1). Default: 1 */
			'volume'?: number;
			/** Fade music to this volume while other audio plays (between 0 and 1). Default: 0 */
			'data-mutedvolume'?: number;

			// Specific technical settings
			/** Configuration for the grid which the viewer will use. */
			'data-grid'?: string;
			/** Toggle limited rendering mode in WebAssembly. */
			'data-limited'?: boolean;
		}
	}
}