import type { I18n } from './common';

/** Assets (audio, video, images) */
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
		i18n?: I18n<{ title?: string; description?: string; }>
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
