/**
 * HTML5 Media Element adapter.
 * Wraps native <audio> and <video> elements with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { MediaPlayerAdapter, PlayerEventCallbacks } from '$types/media';

/**
 * Adapter for native HTML5 audio/video elements.
 */
export class HTML5PlayerAdapter implements MediaPlayerAdapter {
	constructor(
		protected element: HTMLMediaElement,
		protected callbacks: PlayerEventCallbacks = {}
	) {
		this.#attachEventListeners();
	}

	#attachEventListeners(): void {
		const el = this.element;
		const cb = this.callbacks;

		const listen = el.addEventListener;
		if (cb.onPlay) listen('play', cb.onPlay);
		if (cb.onPause) listen('pause', cb.onPause);
		if (cb.onEnded) listen('ended', cb.onEnded);
		if (cb.onSeeking) listen('seeking', cb.onSeeking);
		if (cb.onSeeked) listen('seeked', cb.onSeeked);
		if (cb.onTimeUpdate) {
			listen('timeupdate', () => cb.onTimeUpdate?.(el.currentTime));
		}
		if (cb.onDurationChange) {
			listen('durationchange', () => cb.onDurationChange?.(el.duration));
		}
		if (cb.onError) {
			listen('error', () => cb.onError?.(new Error('Media playback error')));
		}
		if (cb.onReady) {
			listen('canplay', cb.onReady);
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
		const unlisten = el.removeEventListener;
		if (cb.onPlay) unlisten('play', cb.onPlay);
		if (cb.onPause) unlisten('pause', cb.onPause);
		if (cb.onEnded) unlisten('ended', cb.onEnded);
		if (cb.onSeeking) unlisten('seeking', cb.onSeeking);
		if (cb.onSeeked) unlisten('seeked', cb.onSeeked);
	}
}
