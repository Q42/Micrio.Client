import type { ImageData } from './data';
import type { Assets } from './assets';
import type { MicrioImage } from '$core/image';

/** State types */
export namespace State {
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

/** Canvas types */
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
