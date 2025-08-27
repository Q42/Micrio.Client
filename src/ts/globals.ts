/**
 * Global variables, constants, default settings, and attribute parsing logic.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../types/models';
import { VERSION } from './version';

/** Base path for Micrio V4 assets (CDN).
 * @internal
 */
export const BASEPATH:string = 'https://b.micr.io/';
/** Base path for Micrio V5 assets (R2 Global).
 * @internal
 */
export const BASEPATH_V5:string = 'https://r2.micr.io/';
/** Base path for Micrio V5 EU assets (R2 EU).
 * @internal
 */
export const BASEPATH_V5_EU:string = 'https://eu.micr.io/';

/** List of demo image IDs that might use the default BASEPATH even if they appear to be V5.
 * @internal
 */
export const DEMO_IDS = [
	// PRE 4.3 demos
	'ttBWO', // Marker types demo
	'IicaE', // Garden of Earthly with CSS
	'KLTce', // Garden of Earthly without CSS
	'xjQrB', // ESO 360
	// POST 4.3 demos
	'pfhXT', // Carnival Lent marker / tour demo
	'rNIPa', // Garden of Earthly with CSS
	'rdFIY', // Garden of Earthly without CSS
	'mvRXc', // ESO 360
];

/** Placeholder for external WebAssembly binary data (likely replaced during build).
 * `b64` holds the base64 encoded string.
 * `ugz` might be a function for decompressing (e.g., using uzip-module).
 * @internal
 */
export const WASM:{
	'b64': string;
	'ugz'?: (b:string,t:boolean) => Promise<ArrayBuffer|Uint8Array>
} = {'b64':'EXTERNAL_WASM'};

/** Keys used for storing Micrio settings in localStorage.
 * @internal
 */
export const localStorageKeys = {
	globalMuted: 'micrio-muted', // Key for storing the global muted state
};

/** Default settings applied to all Micrio images unless overridden.
 * @internal
 */
const DEFAULT_SETTINGS : Models.ImageInfo.Settings = {
	// General
	camspeed: 1, // Camera animation speed multiplier

	// Camera settings
	view: [0,0,1,1], // Initial view full view
	restrict: [0,0,1,1], // View restriction boundaries full image
	focus: [.5,.5], // Default focus point [x, y] for zoom/cover view
	zoomLimit: 1, // Maximum zoom factor relative to cover scale (1 = no zoom beyond cover)
	fullscreen: true, // Enable fullscreen button
	crossfadeDuration: 0.25, // Duration (seconds) for crossfade transitions (unused?)

	// Events
	hookEvents: true, // Enable standard event listeners (click, drag, etc.)
	hookScroll: true, // Enable scroll wheel zoom
	hookPinch: true, // Enable pinch zoom
	hookDrag: true, // Enable drag panning

	// Minimap
	minimap: true, // Enable minimap display

	// Marker tours
	doTourJumps: true, // Enable zoom-out/zoom-in effect for marker tour transitions

	// Audio
	audio: true, // Enable audio features
	startVolume: 1, // Initial volume level (0-1)
	mutedVolume: 0, // Volume level when muted (usually 0)

	// Internal marker settings defaults
	_markers: {
		showTitles: false, // Show marker titles statically by default?
		popupAnimation: {duration: 200, x: -50}, // Animation settings for marker popups
		zoomOutAfterClose: true // Zoom out after closing a marker?
	},
	// Internal UI settings defaults
	ui: {
		controls: {
			cultureSwitch: true // Show language switch button if multiple languages available?
		}
	},
	// Internal 360 settings defaults
	_360: {},
	// Internal meta settings defaults
	_meta: {}
};

/** Default structure for the ImageInfo object, merged with fetched data.
 * @internal
 */
export const DEFAULT_INFO : Models.ImageInfo.ImageInfo = {
	// Required
	id: '', // Placeholder for image ID

	// Image info
	version: VERSION, // Use major.minor from library version
	path: BASEPATH, // Default asset path

	// Image data
	width: 0, // Placeholder
	height: 0, // Placeholder
	tileSize: 1024, // Default tile size
	lang: 'en', // Default language

	// Default settings object
	settings: DEFAULT_SETTINGS
}


// --- <micr-io> Attribute Parsing Logic ---

/** Defines how an HTML attribute maps to an option property.
 * @internal
 */
type ATTRIBUTE_DEFINITION = {
	/** `r`: If true, the property belongs to the root ImageInfo object, otherwise to `settings`. */
	r?: boolean;
	/** `f`: The target property name (or path using dots, e.g., 'gallery.type'). Defaults to attribute name without 'data-'. */
	f?: string;
	/** `n`: If true, negates the boolean value (e.g., `data-no-ui` becomes `noUI: true`). */
	n?: boolean;
	/** `dN`: Default value if the attribute is not present (used for numbers). */
	dN?: any;
}

/** Type for mapping attribute names to their definitions.
 * @internal
 */
type ATTRIBUTE_OPTIONS = { [key: string]: ATTRIBUTE_DEFINITION }

/**
 * Defines mappings for parsing `<micr-io>` HTML attributes into the
 * `ImageInfo` options object used internally.
 * `r`: root property, `f`: field name override, `n`: negate boolean, `dN`: default number value.
 * @internal
 */
export const ATTRIBUTE_OPTIONS: {
	STRINGS: ATTRIBUTE_OPTIONS;
	BOOLEANS: ATTRIBUTE_OPTIONS;
	NUMBERS: ATTRIBUTE_OPTIONS;
	ARRAYS: ATTRIBUTE_OPTIONS;
} = {
	STRINGS: {
		'id': {r:true}, // Root property
		'lang': {r:true}, // Root property
		'data-thumb': {f: 'thumbSrc'}, // Field override
		'data-title': {r:true},
		'data-format': {r:true},
		'data-extension': {r:true, f: 'tileExtension'},
		'data-tiles': {r:true, f: 'tilesId'},
		'data-path': {r:true},
		'data-sources': {r:true}, // Legacy?
		'data-inittype': {f: 'initType'}, // Initial view type (cover, contain, view)
		'data-type': {}, // Legacy?
		'data-start': {f: 'gallery.startId'}, // Starting image ID for gallery
		'data-gallery': {f: 'gallery.archive'}, // Gallery definition string or archive ID
		'data-gallery-sort': {f: 'gallery.sort'}, // Gallery sorting ('name', '-created', etc.)
		'data-iiif': {r: true, f: 'iiifManifest'}, // IIIF Manifest URL
		'data-grid': {r:true}, // Grid definition string or archive ID
		'data-gallery-type': {f:'gallery.type'}, // Gallery type ('swipe', 'switch', 'omni', etc.)
	},

	BOOLEANS: {
		'data-static': {}, // Disable all interactions?
		'muted': {f:'audio',n:true}, // Negated: `muted` attribute means `audio: false`? TODO: Verify this logic. Seems counter-intuitive. Should likely be `isMuted` state.
		'data-png': {r:true,f:'isPng'}, // Image format hint
		'data-webp': {r:true,f:'isWebP'}, // Image format hint
		'data-dz': {r:true,f:'isDeepZoom'}, // DeepZoom format hint
		'data-is360': {r:true}, // Is it a 360 image?
		'data-no-externals': {f:'noExternals'}, // Disable loading external JS/CSS?
		'data-skipmeta': {f:'skipMeta'}, // Skip loading metadata (info.json)?
		'data-force-data-refresh': {f:'forceDataRefresh'}, // Force refresh of cached data?
		'data-keeprendering': {f:'keepRendering'}, // Force continuous rendering loop?
		'data-coverlimit': {f:'limitToCoverScale'}, // Limit zoom out to cover scale?
		'data-events': {f:'hookEvents'}, // Enable/disable event hooks
		'data-keys': {f:'hookKeys'}, // Enable/disable keyboard hooks
		'data-zooming': {f:'noZoom',n:true}, // Disable zoom? (Negated)
		'data-scroll-zoom': {f:'hookScroll'}, // Enable scroll zoom?
		'data-pinch-zoom': {f:'hookPinch'}, // Enable pinch zoom?
		'data-dragging': {f:'hookDrag'}, // Enable drag panning?
		'data-two-finger-pan': {f:'twoFingerPan'}, // Enable two-finger panning?
		'data-control-zoom': {f:'controlZoom'}, // Enable zoom via ctrl/cmd + scroll?
		'data-ui': {f:'noUI', n: true}, // Disable UI? (Negated)
		'data-gtag': {f:'noGTag', n: true}, // Disable Google Analytics? (Negated)
		'data-controls': {f:'noControls', n: true}, // Disable main controls? (Negated)
		'data-logo': {f:'noLogo', n: true}, // Disable Micrio logo? (Negated)
		'data-logo-org': {f:'noOrgLogo', n: true}, // Disable organization logo? (Negated)
		'data-toolbar': {f:'noToolbar', n: true}, // Disable top toolbar? (Negated)
		'data-show-info': {f:'showInfo'}, // Show info panel on load?
		'data-social': {}, // Enable social sharing buttons?
		'data-fullscreen': {}, // Enable fullscreen button?
		'data-minimap': {}, // Enable minimap?
		'data-minimap-hide': {f:'alwaysShowMinimap',n:true}, // Always show minimap? (Negated)
		'data-omni-y': {f:'OmniTwoAxes'}, // Enable vertical rotation for Omni?
		'data-normalize-dpr': {f: 'zoomLimitDPRFix'}, // Apply DPR fix for zoom limit?
		'data-grid-clickable': {f: 'gridClickable' }, // Make grid items clickable?
		'data-gallery-spreads': {f: 'gallery.isSpreads' }, // Display gallery as spreads?
		'data-freemove': {f: 'freeMove' }, // Enable free camera movement (e.g., beyond limits)?
		'data-force-path': {f: 'forceInfoPath', r:true}, // Force using `data-path` for info.json?
	},

	NUMBERS: {
		'data-version': {r:true}, // Image version
		'height': {r:true}, // Image height override
		'width': {r:true}, // Image width override
		'volume': {f:'startVolume'}, // Initial audio volume
		'data-tilesize': {r:true,f:'tileSize'}, // Tile size override
		'data-camspeed': {}, // Camera speed multiplier
		'data-zoomlimit': {f:'zoomLimit'}, // Max zoom factor override
		'data-minimap-height': {f:'minimapHeight'}, // Minimap height override
		'data-minimap-width': {f:'minimapWidth'}, // Minimap width override
		'data-mutedvolume': {f:'mutedVolume'}, // Volume when muted override
		'data-width-cm': {f: 'cmWidth'}, // Physical width in cm
		'data-height-cm': {f: 'cmHeight'}, // Physical height in cm
		'data-gallery-cover-pages': {f: 'gallery.coverPages' }, // Number of cover pages in spreads gallery
		'lazyload': {dN: 0}, // Lazy load threshold (percentage, default 0 = disabled)
		'data-elasticity': {f: 'dragElasticity'}, // Drag elasticity factor
		'data-skip-base-levels': {f: 'skipBaseLevels'}, // Number of base zoom levels to skip loading
	},

	ARRAYS : { // Comma-separated numbers
		'data-focus': {}, // Default focus point [x, y]
		'data-view': {}, // Initial view [x0, y0, x1, y1]
	}
};
