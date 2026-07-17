/**
 * HLS.js Player adapter.
 * Extends HTML5PlayerAdapter to add HLS.js streaming support.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { HlsPlayer } from '$types/externals';
import type { PlayerEventCallbacks } from './types';
import { loadExternalAPI } from '$utils/dom';
import { HTML5PlayerAdapter } from './html5-adapter';

export const HLS_SCRIPT_URL = 'https://r2.micr.io/hls-1.6.15.min.js';
export const HLS_PLAYER_CONFIG = { abrEwmaDefaultEstimate: 10_000_000, abrEwmaDefaultEstimateMax: 50_000_000 };

export const mediaSourceSupported = () => 'MediaSource' in globalThis || 'ManagedMediaSource' in globalThis;

export const cloudflareStreamUrl = (streamId: string) => `https://videodelivery.net/${streamId}/manifest/video.m3u8`;

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
		await loadExternalAPI('Hls', HLS_SCRIPT_URL);

		if (this.#destroyed) {
			throw new Error('Adapter destroyed during initialization');
		}

		const hls: HlsPlayer = new (window as Record<string, any>)['Hls'](HLS_PLAYER_CONFIG);
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
