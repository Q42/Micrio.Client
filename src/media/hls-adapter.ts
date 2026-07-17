/**
 * HLS.js Player adapter.
 * Extends HTML5PlayerAdapter to add HLS.js streaming support.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { HlsPlayer } from '$types/externals';
import type { PlayerEventCallbacks } from './types';
import { loadExternalAPI } from '$utils/dom';
import { HTML5PlayerAdapter } from './html5-adapter';

/**
 * Adapter for HLS.js streaming video.
 * Attaches HLS.js to a video element and delegates standard operations to HTML5PlayerAdapter.
 */
export class HLSPlayerAdapter extends HTML5PlayerAdapter {
	#hls: HlsPlayer | undefined;
	#destroyed = false;

	#hlsSrc: string;

	constructor(
		element: HTMLVideoElement,
		hlsSrc: string,
		callbacks: PlayerEventCallbacks = {}
	) {
		super(element, callbacks);
		this.#hlsSrc = hlsSrc;
	}

	/**
	 * Loads HLS.js and attaches to the video element.
	 */
	async initialize(): Promise<void> {
		await loadExternalAPI('Hls', 'https://r2.micr.io/hls-1.6.15.min.js');

		if (this.#destroyed) {
			throw new Error('Adapter destroyed during initialization');
		}

		// @ts-ignore - Hls is loaded dynamically
		const hls: HlsPlayer = new window['Hls']({ abrEwmaDefaultEstimate: 10_000_000, abrEwmaDefaultEstimateMax: 50_000_000 });
		this.#hls = hls;
		hls.loadSource(this.#hlsSrc);
		hls.attachMedia(this.element);

		this.callbacks.onReady?.();
	}

	destroy(): void {
		this.#destroyed = true;
		super.destroy();
		this.#hls?.destroy();
		this.#hls = undefined;
	}
}
