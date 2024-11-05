/**
 * Global variables
 * @author Marcel Duin <marcel@micr.io>
*/

import type { Models } from '../types/models';
import { VERSION } from './version';

/** The default base path
 * @internal
*/
export const BASEPATH:string = 'https://b.micr.io/';
export const BASEPATH_V5:string = 'https://r2.micr.io/';
export const BASEPATH_V5_EU:string = 'https://eu.micr.io/';

/** Template image IDs for static tile basepaths
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

/** External wasm binary */
export const WASM:{
	'b64': string;
	'ugz'?: (b:string,t:boolean) => Promise<ArrayBuffer|Uint8Array>
} = {'b64':'EXTERNAL_WASM'};

/** localStorage keys
 * @internal
*/
export const localStorageKeys = {
	globalMuted: 'micrio-muted',
};

/** The default image settings
 * @internal
*/
const DEFAULT_SETTINGS : Models.ImageInfo.Settings = {
	// General
	camspeed: 1,

	// Camera settings
	view: [0,0,1,1],
	restrict: [0,0,1,1],
	focus: [.5,.5],
	zoomLimit: 1,
	fullscreen: true,
	crossfadeDuration: 0.25,

	// Events
	hookEvents: true,
	hookScroll: true,
	hookPinch: true,
	hookDrag: true,

	// Minimap
	minimap: true,

	// Marker tours
	doTourJumps: true,

	// Audio
	audio: true,
	startVolume: 1,
	mutedVolume: 0,

	_markers: {
		showTitles: false,
		popupAnimation: {duration: 200, x: -50},
		zoomOutAfterClose: true
	},
	ui: {
		controls: {
			cultureSwitch: true
		}
	},
	_360: {},
	_meta: {}
};

/** The default info object
 * @internal
*/
export const DEFAULT_INFO : Models.ImageInfo.ImageInfo = {
	// Required
	id: '',

	// Image info
	version: Number(VERSION.replace(/(\d+)\.(\d+).*/,'$1.$2')),
	path: BASEPATH,

	// Image data
	width: 0,
	height: 0,
	tileSize: 1024,
	lang: 'en',

	settings: DEFAULT_SETTINGS
}


// <micr-io> attribute parsing
type ATTRIBUTE_DEFINITION = {
	r?: boolean;
	f?: string;
	n?: boolean;
	dN?: any;
}

type ATTRIBUTE_OPTIONS = { [key: string]: ATTRIBUTE_DEFINITION }

/** @internal */
export const ATTRIBUTE_OPTIONS: {
	STRINGS: ATTRIBUTE_OPTIONS;
	BOOLEANS: ATTRIBUTE_OPTIONS;
	NUMBERS: ATTRIBUTE_OPTIONS;
	ARRAYS: ATTRIBUTE_OPTIONS;
} = {
	STRINGS: {
		'id': {r:true},
		'lang': {r:true},
		'data-thumb': {f: 'thumbSrc'},
		'data-title': {r:true},
		'data-format': {r:true},
		'data-extension': {r:true, f: 'tileExtension'},
		'data-tiles': {r:true, f: 'tilesId'},
		'data-path': {r:true},
		'data-sources': {r:true},
		'data-inittype': {f: 'initType'},
		'data-type': {},
		'data-start': {f: 'gallery.startId'},
		'data-gallery': {f: 'gallery.archive'},
		'data-gallery-sort': {f: 'gallery.sort'},
		'data-iiif': {r: true, f: 'iiifManifest'},
		'data-grid': {r:true},
		'data-gallery-type': {f:'gallery.type'},
	},

	BOOLEANS: {
		'data-static': {},
		'muted': {f:'audio',n:true},
		'data-png': {r:true,f:'isPng'},
		'data-webp': {r:true,f:'isWebP'},
		'data-dz': {r:true,f:'isDeepZoom'},
		'data-is360': {r:true},
		'data-no-externals': {f:'noExternals'},
		'data-skipmeta': {f:'skipMeta'},
		'data-keeprendering': {f:'keepRendering'},
		'data-coverlimit': {f:'limitToCoverScale'},
		'data-events': {f:'hookEvents'},
		'data-keys': {f:'hookKeys'},
		'data-zooming': {f:'noZoom',n:true},
		'data-scroll-zoom': {f:'hookScroll'},
		'data-pinch-zoom': {f:'hookPinch'},
		'data-dragging': {f:'hookDrag'},
		'data-two-finger-pan': {f:'twoFingerPan'},
		'data-control-zoom': {f:'controlZoom'},
		'data-ui': {f:'noUI', n: true},
		'data-gtag': {f:'noGTag', n: true},
		'data-controls': {f:'noControls', n: true},
		'data-logo': {f:'noLogo', n: true},
		'data-logo-org': {f:'noOrgLogo', n: true},
		'data-toolbar': {f:'noToolbar', n: true},
		'data-show-info': {f:'showInfo'},
		'data-social': {},
		'data-fullscreen': {},
		'data-minimap': {},
		'data-minimap-hide': {f:'alwaysShowMinimap',n:true},
		'data-omni-y': {f:'OmniTwoAxes'},
		'data-normalize-dpr': {f: 'zoomLimitDPRFix'},
		'data-grid-clickable': {f: 'gridClickable' },
		'data-gallery-spreads': {f: 'gallery.isSpreads' },
		'data-freemove': {f: 'freeMove' },
		'data-force-path': {f: 'forceInfoPath', r:true}
	},

	NUMBERS: {
		'data-version': {r:true},
		'height': {r:true},
		'width': {r:true},
		'volume': {f:'startVolume'},
		'data-tilesize': {r:true,f:'tileSize'},
		'data-camspeed': {},
		'data-zoomlimit': {f:'zoomLimit'},
		'data-minimap-height': {f:'minimapHeight'},
		'data-minimap-width': {f:'minimapWidth'},
		'data-mutedvolume': {f:'mutedVolume'},
		'data-width-cm': {f: 'cmWidth'},
		'data-height-cm': {f: 'cmHeight'},
		'data-gallery-cover-pages': {f: 'gallery.coverPages' },
		'lazyload': {dN: 0},
		'data-elasticity': {f: 'dragElasticity'},
		'data-skip-base-levels': {f: 'skipBaseLevels'},
	},

	ARRAYS : {
		'data-focus': {},
		'data-view': {},
	}
};
