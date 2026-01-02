/**
 * YouTube IFrame Player API adapter.
 * Wraps the YouTube player with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { YouTubePlayer } from '../../types/externals';
import type { MediaPlayerAdapter, PlayerEventCallbacks, PlayerConfig } from './types';
import { loadScript } from '../utils';
import { YOUTUBE_HOST } from '../utils/media';

/** YouTube player state constants */
const YT_STATE = {
	UNSTARTED: -1,
	ENDED: 0,
	PLAYING: 1,
	PAUSED: 2,
	BUFFERING: 3,
	CUED: 5,
} as const;

/**
 * Adapter for YouTube IFrame Player API.
 */
export class YouTubePlayerAdapter implements MediaPlayerAdapter {
	readonly requiresTimeTick = true;

	private player: YouTubePlayer | undefined;
	private destroyed = false;

	constructor(
		private frame: HTMLIFrameElement,
		private config: PlayerConfig,
		private callbacks: PlayerEventCallbacks = {}
	) {}

	/**
	 * Loads the YouTube API and initializes the player.
	 */
	async initialize(): Promise<void> {
		// Load YouTube API if not already present
		if (!('YT' in window)) {
			await loadScript(
				'https://i.micr.io/youtube.js',
				'onYouTubeIframeAPIReady'
			);
		}

		if (!('YT' in window)) {
			throw new Error('Failed to load YouTube API');
		}

		return new Promise((resolve, reject) => {
			// @ts-ignore - YT is loaded dynamically
			this.player = new window['YT']['Player'](this.frame, {
				host: YOUTUBE_HOST,
				width: this.config.width.toString(),
				height: this.config.height.toString(),
				playerVars: { controls: 0 },
				events: {
					onError: () => {
						this.callbacks.onError?.(new Error('YouTube player error'));
						reject(new Error('YouTube player error'));
					},
					onReady: () => {
						if (this.destroyed) {
							reject(new Error('Player destroyed during initialization'));
							return;
						}
						this.callbacks.onReady?.();
						this.callbacks.onDurationChange?.(this.player!.getDuration());
						resolve();
					},
					onStateChange: (e) => this.handleStateChange(e.data),
				},
			});
		});
	}

	private handleStateChange(state: number): void {
		switch (state) {
			case YT_STATE.UNSTARTED:
				this.callbacks.onBlocked?.();
				this.callbacks.onPause?.();
				break;
			case YT_STATE.ENDED:
				this.callbacks.onEnded?.();
				break;
			case YT_STATE.PLAYING:
				this.callbacks.onPlay?.();
				this.callbacks.onSeeked?.();
				break;
			case YT_STATE.PAUSED:
				this.callbacks.onPause?.();
				break;
			case YT_STATE.BUFFERING:
				this.callbacks.onBuffering?.();
				this.callbacks.onSeeking?.();
				break;
		}
	}

	async play(): Promise<void> {
		this.player?.playVideo();
	}

	pause(): void {
		if (!this.destroyed) {
			this.player?.pauseVideo?.();
		}
	}

	async getCurrentTime(): Promise<number> {
		return this.player?.getCurrentTime?.() ?? 0;
	}

	setCurrentTime(time: number): void {
		this.callbacks.onSeeking?.();
		this.player?.seekTo?.(time);
	}

	async getDuration(): Promise<number> {
		return this.player?.getDuration?.() ?? 0;
	}

	async isPaused(): Promise<boolean> {
		if (!this.player) return true;
		const state = this.player.getPlayerState?.();
		return state === undefined || [YT_STATE.UNSTARTED, YT_STATE.ENDED, YT_STATE.PAUSED].includes(state);
	}

	setMuted(muted: boolean): void {
		if (muted) {
			this.player?.mute?.();
		} else {
			this.player?.unMute?.();
		}
	}

	setVolume(_volume: number): void {
		// YouTube API doesn't have direct volume control, only mute/unmute
		// Volume is controlled via the embedded player settings
	}

	destroy(): void {
		this.destroyed = true;
		this.player?.destroy?.();
		this.player = undefined;
	}
}
