export namespace Embeds {
	export interface EmbedOptions {
		/** The embed opacity */
		opacity?: number;
		/** Do not print this embed until this zoom level (% of original) */
		fromScale?: number;
		/** The embed will have a minimal memory footprint, without its own camera */
		asImage?: boolean;
		/** Fit the embed's original size into the specified area. Defaults to 'stretch' */
		fit?: ('contain'|'cover'|'stretch');
	}
}
