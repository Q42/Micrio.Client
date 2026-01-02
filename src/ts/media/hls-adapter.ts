/**
 * HLS.js Player adapter.
 * Wraps HLS.js for streaming video playback with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { HlsPlayer } from '../../types/externals';
import type { MediaPlayerAdapter, PlayerEventCallbacks } from './types';
import { loadScript } from '../utils';
import { HTML5PlayerAdapter } from './html5-adapter';

/**
 * Adapter for HLS.js streaming video.
 * Extends HTML5PlayerAdapter since HLS.js attaches to a video element.
 */
export class HLSPlayerAdapter implements MediaPlayerAdapter {
	readonly requiresTimeTick = false;

	private hls: HlsPlayer | undefined;
	private html5Adapter: HTML5PlayerAdapter | undefined;
	private destroyed = false;

	constructor(
		private element: HTMLVideoElement,
		private hlsSrc: string,
		private callbacks: PlayerEventCallbacks = {}
	) {}

	/**
	 * Loads HLS.js and attaches to the video element.
	 */
	async initialize(): Promise<void> {
		// Load HLS.js if not already present
		if (!('Hls' in window)) {
			await loadScript('https://i.micr.io/hls-1.5.17.min.js', undefined, 'Hls' in window ? {} : undefined);
		}

		if (!('Hls' in window)) {
			throw new Error('Failed to load HLS.js');
		}

		if (this.destroyed) {
			throw new Error('Adapter destroyed during initialization');
		}

		// @ts-ignore - Hls is loaded dynamically
		this.hls = new window['Hls']();
		this.hls.loadSource(this.hlsSrc);
		this.hls.attachMedia(this.element);

		// Create HTML5 adapter for the underlying video element
		this.html5Adapter = new HTML5PlayerAdapter(this.element, this.callbacks);

		this.callbacks.onReady?.();
	}

	async play(): Promise<void> {
		return this.html5Adapter?.play();
	}

	pause(): void {
		this.html5Adapter?.pause();
	}

	async getCurrentTime(): Promise<number> {
		return this.html5Adapter?.getCurrentTime() ?? Promise.resolve(0);
	}

	setCurrentTime(time: number): void {
		this.html5Adapter?.setCurrentTime(time);
	}

	async getDuration(): Promise<number> {
		return this.html5Adapter?.getDuration() ?? Promise.resolve(0);
	}

	async isPaused(): Promise<boolean> {
		return this.html5Adapter?.isPaused() ?? Promise.resolve(true);
	}

	setMuted(muted: boolean): void {
		this.html5Adapter?.setMuted(muted);
	}

	setVolume(volume: number): void {
		this.html5Adapter?.setVolume(volume);
	}

	destroy(): void {
		this.destroyed = true;
		this.html5Adapter?.destroy();
		this.hls?.destroy();
		this.hls = undefined;
		this.html5Adapter = undefined;
	}
}
