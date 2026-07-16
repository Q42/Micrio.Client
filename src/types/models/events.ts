import type { HTMLMicrioElement } from '$core/element';
import type { Grid } from '$core/grid';
import type { MicrioImage } from '$core/image';
import type { ImageInfo } from './info';
import type { ImageData } from './data';
import type { Camera } from './camera';

export type MicrioEvent<T = any> = Event & { detail: T };

export interface MicrioEventDetails {
	'show': HTMLMicrioElement;
	'pre-info': ImageInfo.ImageInfo;
	'pre-data': { [micrioId: string]: ImageData.ImageData };
	'print': ImageInfo.ImageInfo;
	'load': MicrioImage;
	'lang-switch': string;
	'zoom': { image: MicrioImage, view: Camera.View };
	'move': { image: MicrioImage, view: Camera.View };
	'draw': void;
	'resize': DOMRect;
	'panstart': void;
	'panend': {duration: number, movedX: number, movedY: number};
	'pinchstart': void;
	'pinchend': {duration: number, movedX: number, movedY: number};
	'marker-open': ImageData.Marker;
	'marker-opened': ImageData.Marker;
	'marker-closed': ImageData.Marker;
	'tour-start': ImageData.Tour;
	'tour-stop': ImageData.Tour;
	'tour-minimize': boolean;
	'tour-step': ImageData.MarkerTour | ImageData.VideoTour;
	'serialtour-play': ImageData.MarkerTour;
	'serialtour-pause': ImageData.MarkerTour;
	'videotour-start': ImageData.VideoTour;
	'videotour-stop': ImageData.VideoTour;
	'videotour-play': void;
	'videotour-pause': void;
	'tour-ended': ImageData.MarkerTour | ImageData.VideoTour;
	'tour-event': ImageData.Event;
	'audio-init': void;
	'audio-mute': void;
	'audio-unmute': void;
	'autoplay-blocked': void;
	'media-blocked': void;
	'media-play': void;
	'media-pause': void;
	'media-ended': void;
	'timeupdate': number;
	'page-open': ImageData.Menu;
	'page-closed': ImageData.Menu;
	'gallery-show': number;
	'grid-init': Grid;
	'grid-load': void;
	'grid-layout-set': Grid;
	'grid-focus': MicrioImage;
	'grid-blur': void;
	'splitscreen-start': MicrioImage;
	'splitscreen-stop': MicrioImage;
	'update': Array<string>;
}

export type MicrioEventMap = {
	[K in keyof MicrioEventDetails]: MicrioEvent<MicrioEventDetails[K]>;
}
