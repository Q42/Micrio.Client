/**
 * Vimeo Player API adapter.
 * Wraps the Vimeo player with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { VimeoPlayer } from '../../types/externals';
import type { MediaPlayerAdapter, PlayerEventCallbacks, PlayerConfig } from './types';
import { loadScript } from '../utils';

/**
 * Adapter for Vimeo Player API.
 */
export class VimeoPlayerAdapter implements MediaPlayerAdapter {
	readonly requiresTimeTick = false;

	private player: VimeoPlayer | undefined;
	private destroyed = false;

	constructor(
		private frame: HTMLIFrameElement,
		private config: PlayerConfig,
		private callbacks: PlayerEventCallbacks = {}
	) {}

	/**
	 * Loads the Vimeo API and initializes the player.
	 */
	async initialize(): Promise<void> {
		// Load Vimeo API if not already present
		if (!('Vimeo' in window)) {
			await loadScript('https://i.micr.io/vimeo.min.js');
		}

		if (!('Vimeo' in window)) {
			throw new Error('Failed to load Vimeo API');
		}

		return new Promise((resolve, reject) => {
			// @ts-ignore - Vimeo is loaded dynamically
			this.player = new window['Vimeo']['Player'](this.frame, {
				width: this.config.width.toString(),
				height: this.config.height.toString(),
				title: false,
				autoplay: false,
			});

			const p = this.player;

			p.on('error', () => {
				this.callbacks.onError?.(new Error('Vimeo player error'));
				reject(new Error('Vimeo player error'));
			});

			p.on('loaded', () => {
				if (this.destroyed) {
					reject(new Error('Player destroyed during initialization'));
					return;
				}
				p.getVolume().then(() => {
					this.callbacks.onReady?.();
					resolve();
				});
			});

			// Set up event listeners
			p.on('play', () => {
				this.callbacks.onPlay?.();
				this.callbacks.onSeeked?.();
			});

			p.on('bufferstart', () => {
				this.callbacks.onBuffering?.();
				this.callbacks.onSeeking?.();
			});

			p.on('seeked', () => {
				this.callbacks.onSeeked?.();
			});

			p.on('pause', () => {
				this.callbacks.onPause?.();
			});

			p.on('timeupdate', (data) => {
				if (data) {
					this.callbacks.onDurationChange?.(data.duration);
					this.callbacks.onTimeUpdate?.(data.seconds);
				}
			});

			p.on('ended', () => {
				this.callbacks.onEnded?.();
			});
		});
	}

	async play(): Promise<void> {
		this.player?.play();
	}

	pause(): void {
		this.player?.pause();
	}

	async getCurrentTime(): Promise<number> {
		return (await this.player?.getCurrentTime?.()) ?? 0;
	}

	setCurrentTime(time: number): void {
		this.player?.setCurrentTime?.(time);
	}

	async getDuration(): Promise<number> {
		return (await this.player?.getDuration?.()) ?? 0;
	}

	async isPaused(): Promise<boolean> {
		return (await this.player?.getPaused?.()) ?? true;
	}

	setMuted(muted: boolean): void {
		this.player?.setVolume?.(muted ? 0 : 1);
	}

	setVolume(volume: number): void {
		this.player?.setVolume?.(Math.max(0, Math.min(1, volume)));
	}

	destroy(): void {
		this.destroyed = true;
		if (this.player) {
			// Remove all event listeners
			const events = ['error', 'loaded', 'play', 'bufferstart', 'seeked', 'pause', 'volumechange', 'timeupdate', 'ended'];
			for (const event of events) {
				this.player.off(event);
			}
			this.player.destroy();
			this.player = undefined;
		}
	}
}
