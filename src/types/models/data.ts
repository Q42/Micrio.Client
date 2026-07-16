import type { I18n, RevisionType } from './common';
import type { Camera } from './camera';
import type { Assets } from './assets';
import type { ImageInfo } from './info';
import type { Grid } from './grid';
import type { VideoTourInstance } from '$media/videotour';
import type { MicrioImage } from '$core/image';
import type { MicrioIcon } from '$ui/icons';
import type { Spaces } from './spaces';
import type { GalleryConfig } from './info';

export namespace ImageData {
	export type ImageData = {
		revision?: RevisionType;
		i18n?: I18n<ImageDetailsCultureData>;
		markers?: ImageData.Marker[];
		markerTours?: ImageData.MarkerTour[];
		tours?: ImageData.VideoTour[];
		embeds?: ImageData.Embed[];
		pages?: ImageData.Menu[];
		music?: {
			items: Assets.Audio[];
			loop: boolean;
			volume?: number;
		};
	}

	export interface ImageDetailsCultureData {
		title?: string;
		description?: string;
		copyright?: string;
		sourceUrl?: string;
	}

	export interface MarkerCultureData {
		title?: string;
		slug?: string;
		label?: string;
		body?: string;
		bodySecondary?: string;
		audio?: Assets.Audio;
		embedUrl?: string;
		embedTitle?: string;
		embedDescription?: string;
	}

	export type Marker = {
		id: string;
		x: number;
		y: number;
		i18n?: I18n<MarkerCultureData>;
		radius?: number;
		backside?: boolean;
		rotation?: number;
		visibleArc?: [number, number];
		view?: Camera.View;
		imageLayer?: number;
		type?: ('default' | 'image' | 'audio' | 'video' | 'media' | 'link' | 'waypoint' | 'cluster');
		popupType?: ('popup'|'popover'|'none'|'micrioLink');
		clickableArea?: ImageData.Embed;
		tags?: string[];
		audioAutoPlay?: boolean;
		embedAutoPlay?: boolean;
		noMarker?: boolean;
		htmlElement?: HTMLElement;
		embedMutesAudio?: boolean;
		images?: Assets.Image[];
		videoTour?: VideoTour;
		positionalAudio?: Assets.AudioLocation;
		onclick?: (m:ImageData.Marker) => void;
		data?: MarkerData;
	}

	export type MarkerData = {
		icon?: Assets.Image;
		customIconIdx?: number;
		micrioLink?: Partial<ImageInfo.ImageInfo>;
		micrioSplitLink?: string;
		noAnimate?: boolean;
		showTitle?: boolean;
		preventImageOpen?: boolean;
		notEmpty?: boolean;
		doJump?: boolean;
		alwaysOpen?: boolean;
		scales?: boolean;
		gridTourTransition?: Grid.MarkerFocusTransition;
		_meta?: {
			secondary?: string;
			gridView?: boolean;
			gridAction?: string;
			gridSize?: number|string;
			[key:string]: any;
		}
	};

	export type Embed = Partial<ImageInfo.ImageInfo> & {
		area: Camera.View;
		src?: string;
		frameSrc?: string;
		autoplayFrame?: boolean;
		title?: string;
		micrioId?: string;
		width?: number;
		height?: number;
		isPng?: boolean;
		isWebP?: boolean;
		opacity?: number;
		clickAction?: ('markerId'|'href')
		clickTarget?: string;
		clickTargetBlank?: boolean;
		uuid?: string;
		scale?: number;
		rotX?: number;
		rotY?: number;
		rotZ?: number;
		scaleX?: number;
		scaleY?: number;
		video?: Assets.Video & {
			pauseWhenSmallerThan?: number;
			pauseWhenLargerThan?: number;
		};
		hideWhenPaused?: boolean;
	}

	export interface TourCultureData {
		title?: string;
		slug?: string;
		description?: string;
	}

	export type Tour = {
		id: string;
		i18n?: I18n<TourCultureData>;
		minimize?: boolean;
		cannotClose?: boolean;
		closeOnFinish?: boolean;
	}

	export type VideoTourView = {
		start: number;
		end: number;
		title?: string;
		rect: Camera.View;
	};

	export interface VideoTourCultureData extends TourCultureData {
		duration: number;
		audio?: Assets.Audio;
		subtitle?: Assets.Subtitle;
		timeline: VideoTourView[];
		events: ImageData.Event[];
	}

	export type VideoTour = Tour & {
		i18n?: I18n<VideoTourCultureData>;
		keepMarkers?: boolean;
		keepInteraction?: boolean;
		instance?: VideoTourInstance;
	}

	export type Event = {
		start: number;
		end: number;
		action?: string;
		data?: string;
		id?: string;
		active?: boolean;
	}

	export type MarkerTour = Tour & {
		steps: string[];
		noControls?: boolean;
		image?: Assets.Image;
		scrollable?: boolean;
		keepLastStep?: boolean;
		isSerialTour?: boolean;
		printChapters?: boolean;
		stepInfo?: MarkerTourStepInfo[];
		duration?: number;
		currentStep?: number;
		initialStep?: number;
		next?: () => void;
		prev?: () => void;
		goto?: (n:number) => void;
	}

	export type MarkerTourStepInfo = {
		markerId: string,
		micrioId: string,
		duration: number,
		imageHasOtherMarkers?: boolean,
		startView?: Camera.View,
		chapter?: number,
		gridView?: boolean,
		currentTime?: number,
		ended?: boolean
		micrioImage?: MicrioImage;
		hasSubtitle?: boolean;
	}

	export interface MenuPageButton {
		i18nTitle: {[key:string]: string};
		type: ('close'|'marker'|'mtour'|'vtour'|'link');
		action?: string;
		blankTarget?: boolean;
	}

	export interface MenuCultureData {
		title?: string;
		embed?: string;
		content?: string;
	}

	export type Menu = {
		id: string;
		i18n?: I18n<MenuCultureData>;
		children?: Menu[];
		markerId?: string;
		link?: string;
		linkTargetBlank?: boolean;
		action?: Function;
		image?: Assets.Image;
		buttons?: MenuPageButton[];
		_button?: HTMLButtonElement;
		icon?: MicrioIcon
	}
}

export namespace ImageBundle {
	export type BundleImage = {
		id: string;
		info: ImageInfo.ImageInfo;
		data: ImageData.ImageData;
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
