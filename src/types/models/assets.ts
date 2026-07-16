/** Assets (audio, video, images) */
export namespace Assets {
	export type BaseAsset = {
		title: string;
		fileName?: string;
		src: string;
		size: number;
		uploaded: number;
	}

	export type Audio = BaseAsset & {
		duration: number;
		volume: number;
	}

	export type AudioLocation = Audio & {
		alwaysPlay: boolean;
		loop: boolean;
		repeatAfter: number;
		noMobile: boolean;
		radius: number;
	};

	export type Image = BaseAsset & {
		id?: string;
		width: number;
		height: number;
		micrioId?: string;
		tilesId?: string;
		isPng?: boolean;
		isWebP?: boolean;
		isDeepZoom?: boolean;
		i18n?: { [lang: string]: { title?: string; description?: string; } }
	}

	export type Video = BaseAsset & {
		width: number;
		height: number;
		duration: number;
		muted: boolean;
		loop: boolean;
		loopAfter?: number;
		autoplay: boolean;
		streamId?: string;
		controls: boolean;
		transparent: boolean;
		hasH265?: boolean;
	}

	export type Subtitle = BaseAsset;
}
