/** HTML attribute types */
export namespace Attributes {
	export interface MicrioCustomAttributes {
		'id'?: string;
		'lang'?: string;
		'data-path'?: string;
		'data-inittype'?: string;
		'data-coverlimit'?: boolean;
		'lazyload'?: boolean;
		'data-skipmeta'?: boolean;
		'data-static'?: boolean;
		'data-gtag'?: boolean;
		'data-camspeed'?: number;
		'data-freemove'?: boolean;
		'data-zoomlimit'?: number;
		'data-view'?: number[];
		'data-focus'?: number[];
		'data-keeprendering'?: boolean;
		'data-normalize-dpr'?: boolean;
		'data-events'?: boolean;
		'data-keys'?: boolean;
		'data-pinch-zoom'?: boolean;
		'data-scroll-zoom'?: boolean;
		'data-control-zoom'?: boolean;
		'data-two-finger-pan'?: boolean;
		'data-zooming'?: boolean;
		'data-dragging'?: boolean;
		'data-ui'?: boolean;
		'data-controls'?: boolean;
		'data-fullscreen'?: boolean;
		'data-social'?: boolean;
		'data-logo'?: boolean;
		'data-logo-org'?: boolean;
		'data-toolbar'?: boolean;
		'data-show-info'?: boolean;
		'data-minimap'?: boolean;
		'data-minimap-hide'?: boolean;
		'data-minimap-height'?: number;
		'data-minimap-width'?: number;
		'muted'?: boolean;
		'volume'?: number;
		'data-mutedvolume'?: number;
		'data-limited'?: boolean;
	}
}
