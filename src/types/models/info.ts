import type { Camera } from './camera';
import type { Assets } from './assets';
import type { RevisionType } from './common';
import type { Writable } from '$core/store';
import type { MicrioImage } from '$core/image';

export namespace ImageInfo {
	export type ImageInfo = {
		id: string;
		path: string;
		version: string;
		created?: number;
		viewsWH?: boolean;
		revision?: RevisionType;
		width: number;
		height: number;
		tileSize: number;
		tilesId?: string;
		tileBasePath?: string;
		tileExtension?: string;
		watermark?: string;
		forceInfoPath?: boolean;
		settings?: Partial<ImageInfo.Settings>;
		title?: string;
		organisation?: ImageInfo.Organisation;
		lang?: string;
		is360?: boolean;
		isWebP?: boolean;
		isPng?: boolean;
		isDeepZoom?: boolean;
		isIIIF?: boolean;
		isSingle?: boolean;
		format?: string;
		albumId?: string;
		grid?: string;
		isVideo?: boolean;
		tiles?: { [key: string]: number }[];
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

	export type Settings = {
		view?: Camera.View;
		restrict?: Camera.View;
		focus?: [number, number];
		start?: { type: ('marker'|'markerTour'|'tour'|'page'); id: string; }
		infoUrl?: string;
		static?: boolean;
		thumbSrc?: string;
		initType?: string;
		limitToCoverScale?: boolean;
		lazyload?: number;
		noExternals?: boolean;
		skipMeta?: boolean;
		onlyPreferredLang?: boolean;
		fadeBetween?: boolean;
		crossfadeDuration?: number;
		embedFadeDuration?: number;
		embedRestartWhenShown?: boolean;
		keepRendering?: boolean;
		noGTag?: boolean;
		skipBaseLevels?: number;
		camspeed?: number;
		dragElasticity?: number;
		zoomLimit?: number;
		noRetina?: boolean;
		zoomLimitDPRFix?: boolean;
		freeMove?: boolean;
		resetView?: boolean;
		noSmoothing?: boolean;
		hookEvents?: boolean;
		hookKeys?: boolean;
		noZoom?: boolean;
		hookScroll?: boolean;
		hookPinch?: boolean;
		hookDrag?: boolean;
		twoFingerPan?: boolean;
		controlZoom?: boolean;
		pinchZoomOutLimit?: boolean;
		noUI?: boolean;
		noControls?: boolean;
		fullscreen?: boolean;
		noLogo?: boolean;
		noOrgLogo?: boolean;
		noToolbar?: boolean;
		showInfo?: boolean;
		social?: boolean;
		minimap?: boolean;
		alwaysShowMinimap?: boolean;
		minimapWidth?: number;
		minimapHeight?: number;
		doTourJumps?: boolean;
		audio?: boolean;
		startVolume?: number;
		mutedVolume?: number;
		muteOnBlur?: boolean;
		cmWidth?: number;
		cmHeight?: number;
		clusterMarkers?: boolean;
		clusterMarkerRadius?: number;
		micrioSplitLink?: string;
		secondaryInteractive?: boolean;
		noFollow?: boolean;
		theme?: ("dark" | "light" | "os");
		js?: { href: string; };
		css?: { href: string; };
		markersScale?: boolean;
		gallery?: GalleryConfig;
		omni?: OmniSettings;
		_markers?: MarkerSettings;
		_360?: {
			video?: Assets.Video;
			trueNorth?: number;
			rotX?: number;
			rotY?: number;
			rotZ?: number;
			scale?: number;
		};
		_meta?: { [key:string]: any; };
		ui?: Partial<UserInterfaceSettings>;
		grid?: {
			clickable?: 'focus' | 'zoom';
			panZoom?: 'cells' | 'grid';
			transitionDuration?: number;
			transitionDurationOut?: number;
		};
		postProcessingFragmentShader?: string;
		watermarkOpacity?: number;
	}

	export type OmniSettings = {
		frames: number;
		startIndex: number;
		fieldOfView: number;
		verticalAngle: number;
		distance: number;
		offsetX: number;
		sideLabels?: boolean;
		frontIndex?: number;
		layers?: {i18n: {[key:string]: string|undefined}}[];
		layerStartIndex?: number;
		noDial?: boolean;
		showDegrees?: boolean;
		twoAxes?: boolean;
		noKeys?: boolean;
	}

	export type MarkerSettings = {
		markerIcon?: Assets.Image;
		markerColor?: string;
		markerSize?: string;
		zoomOutAfterClose?: boolean;
		zoomOutAfterCloseSpeed?: number;
		showTitles?: boolean;
		noTitles?: boolean;
		titlesNoScale?: boolean;
		viewportIsMarker?: boolean;
		embedsInHtml?: boolean;
		autoStartTour?: boolean;
		autoStartTourAtBeginning?: boolean;
		tourAutoProgress?: boolean;
		tourControlsInPopup?: boolean;
		tourStepCounterInPopup?: boolean;
		canMinimizePopup?: boolean;
		popupAnimation?: any;
		primaryBodyFirst?: boolean;
		preventAutoPlay?: boolean;
		noMarkerActions?: boolean;
		hideMarkersDuringTour?: boolean;
		keepPopupsDuringTourTransitions?: boolean;
		customIcons?: Assets.Image[];
	}

	export type UserInterfaceSettings = {
		controls?: {
			cultureSwitch?: boolean;
			serialTourNoTimeScrub?: boolean;
		},
		icons?: {
			zoomIn?: string;
			zoomOut?: string;
			fullscreenEnter?: string;
			fullscreenLeave?: string;
			close?: string;
			next?: string;
			prev?: string;
			play?: string;
			pause?: string;
			subtitles?: string;
			subtitlesOff?: string;
			muted?: string;
			unmuted?: string;
			up?: string;
			down?: string;
		}
	}
}

export interface Album {
	numPages: number;
	currentIndex: number;
	info?: GalleryConfig;
	prev: () => void;
	next: () => void;
	goto: (n:number) => void;
	hooked?: boolean;
	currentImage?: Writable<MicrioImage>;
}

export type GalleryItem = {
	id: string;
	width: number;
	height: number;
	path?: string;
	tileSize?: number;
	isDeepZoom?: boolean;
	isPng?: boolean;
	isWebP?: boolean;
};

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
