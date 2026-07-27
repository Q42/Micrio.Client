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
		/** Toggle limited rendering mode in WebAssembly. */
		'data-limited'?: boolean;
	}
}
