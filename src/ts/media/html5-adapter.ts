/**
 * HTML5 Media Element adapter.
 * Wraps native <audio> and <video> elements with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { MediaPlayerAdapter, PlayerEventCallbacks } from './types';

/**
 * Adapter for native HTML5 audio/video elements.
 */
export class HTML5PlayerAdapter implements MediaPlayerAdapter {
	readonly requiresTimeTick = false;

	constructor(
		private element: HTMLMediaElement,
		private callbacks: PlayerEventCallbacks = {}
	) {
		this.attachEventListeners();
	}

	private attachEventListeners(): void {
		const el = this.element;
		const cb = this.callbacks;

		if (cb.onPlay) el.addEventListener('play', cb.onPlay);
		if (cb.onPause) el.addEventListener('pause', cb.onPause);
		if (cb.onEnded) el.addEventListener('ended', cb.onEnded);
		if (cb.onSeeking) el.addEventListener('seeking', cb.onSeeking);
		if (cb.onSeeked) el.addEventListener('seeked', cb.onSeeked);
		if (cb.onTimeUpdate) {
			el.addEventListener('timeupdate', () => cb.onTimeUpdate?.(el.currentTime));
		}
		if (cb.onDurationChange) {
			el.addEventListener('durationchange', () => cb.onDurationChange?.(el.duration));
		}
		if (cb.onError) {
			el.addEventListener('error', () => cb.onError?.(new Error('Media playback error')));
		}
		if (cb.onReady) {
			el.addEventListener('canplay', cb.onReady);
		}
	}

	async play(): Promise<void> {
		try {
			await this.element.play();
		} catch (e) {
			// Check if it's an autoplay block (not a pause() interrupt)
			if (e instanceof Error && !/pause\(\)/.test(e.message)) {
				this.callbacks.onBlocked?.();
			}
			throw e;
		}
	}

	pause(): void {
		this.element.pause();
	}

	async getCurrentTime(): Promise<number> {
		return this.element.currentTime;
	}

	setCurrentTime(time: number): void {
		this.element.currentTime = time;
	}

	async getDuration(): Promise<number> {
		return this.element.duration;
	}

	async isPaused(): Promise<boolean> {
		return this.element.paused;
	}

	setMuted(muted: boolean): void {
		this.element.muted = muted;
	}

	setVolume(volume: number): void {
		this.element.volume = Math.max(0, Math.min(1, volume));
	}

	destroy(): void {
		const el = this.element;
		const cb = this.callbacks;

		// Remove all event listeners
		if (cb.onPlay) el.removeEventListener('play', cb.onPlay);
		if (cb.onPause) el.removeEventListener('pause', cb.onPause);
		if (cb.onEnded) el.removeEventListener('ended', cb.onEnded);
		if (cb.onSeeking) el.removeEventListener('seeking', cb.onSeeking);
		if (cb.onSeeked) el.removeEventListener('seeked', cb.onSeeked);
	}
}
