/**
 * HTML5 Media Element adapter.
 * Wraps native <audio> and <video> elements with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { MediaPlayerAdapter, PlayerEventCallbacks } from '$types/media'

/**
 * Adapter for native HTML5 audio/video elements.
 * @internal
 */
export class HTML5PlayerAdapter implements MediaPlayerAdapter {
	/** Every listener this adapter attached, with its event, so `destroy()` can detach all of them. */
	readonly #listeners: [string, EventListener][] = []

	constructor(
		protected element: HTMLMediaElement,
		protected callbacks: PlayerEventCallbacks = {},
	) {
		this.#attachEventListeners()
	}

	/** Attaches one listener and remembers it for teardown. */
	#on(type: string, listener: EventListener): void {
		this.element.addEventListener(type, listener)
		this.#listeners.push([type, listener])
	}

	#attachEventListeners(): void {
		const el = this.element
		const cb = this.callbacks

		if (cb.onPlay) {
			this.#on('play', cb.onPlay)
		}
		if (cb.onPause) {
			this.#on('pause', cb.onPause)
		}
		if (cb.onEnded) {
			this.#on('ended', cb.onEnded)
		}
		if (cb.onSeeking) {
			this.#on('seeking', cb.onSeeking)
		}
		if (cb.onSeeked) {
			this.#on('seeked', cb.onSeeked)
		}
		if (cb.onTimeUpdate) {
			this.#on('timeupdate', () => {
				cb.onTimeUpdate?.(el.currentTime)
			})
		}
		if (cb.onDurationChange) {
			this.#on('durationchange', () => {
				cb.onDurationChange?.(el.duration)
			})
		}
		if (cb.onError) {
			this.#on('error', () => {
				cb.onError?.(new Error('Media playback error'))
			})
		}
		if (cb.onReady) {
			this.#on('canplay', cb.onReady)
		}
	}

	async play(): Promise<void> {
		try {
			await this.element.play()
		} catch (e) {
			// Check if it's an autoplay block (not a pause() interrupt)
			if (e instanceof Error && !/pause\(\)/.test(e.message)) {
				this.callbacks.onBlocked?.()
			}
			throw e
		}
	}

	pause(): void {
		this.element.pause()
	}

	getCurrentTime(): Promise<number> {
		return Promise.resolve(this.element.currentTime)
	}

	setCurrentTime(time: number): void {
		this.element.currentTime = time
	}

	getDuration(): Promise<number> {
		return Promise.resolve(this.element.duration)
	}

	isPaused(): Promise<boolean> {
		return Promise.resolve(this.element.paused)
	}

	setMuted(muted: boolean): void {
		this.element.muted = muted
	}

	setVolume(volume: number): void {
		this.element.volume = Math.max(0, Math.min(1, volume))
	}

	destroy(): void {
		// Remove every listener, including the four value listeners that used to be
		// attached as closures and therefore kept firing after teardown
		for (const [type, listener] of this.#listeners) {
			this.element.removeEventListener(type, listener)
		}
		this.#listeners.length = 0
	}
}
