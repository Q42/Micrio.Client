/**
 * YouTube IFrame Player API adapter.
 * Wraps the YouTube player with a common interface.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { YouTubePlayer } from '$types/externals'
import type { MediaPlayerAdapter, PlayerEventCallbacks, PlayerConfig } from '$types/media'
import { loadExternalAPI } from '$utils/dom'

const YOUTUBE_HOST = 'https://www.youtube-nocookie.com'

/** YouTube player state constants */
const YT_STATE = {
	UNSTARTED: -1,
	ENDED: 0,
	PLAYING: 1,
	PAUSED: 2,
	BUFFERING: 3,
	CUED: 5,
} as const

/**
 * Adapter for YouTube IFrame Player API.
 * @internal
 */
export class YouTubePlayerAdapter implements MediaPlayerAdapter {
	#player: YouTubePlayer | undefined
	#destroyed = false

	#frame: HTMLIFrameElement
	#config: PlayerConfig
	#callbacks: PlayerEventCallbacks

	constructor(frame: HTMLIFrameElement, config: PlayerConfig, callbacks: PlayerEventCallbacks = {}) {
		this.#frame = frame
		this.#config = config
		this.#callbacks = callbacks
	}

	/**
	 * Loads the YouTube API and initializes the player.
	 */
	async initialize(): Promise<void> {
		await loadExternalAPI('YT', 'https://r2.micr.io/youtube.js', 'onYouTubeIframeAPIReady')

		const { YT } = globalThis
		if (!YT) {
			throw new Error('YouTube IFrame Player API failed to load')
		}

		return new Promise((resolve, reject) => {
			this.#player = new YT['Player'](this.#frame, {
				host: YOUTUBE_HOST,
				width: this.#config.width.toString(),
				height: this.#config.height.toString(),
				playerVars: { controls: 0 },
				events: {
					onError: () => {
						this.#callbacks.onError?.(new Error('YouTube player error'))
						reject(new Error('YouTube player error'))
					},
					onReady: () => {
						if (this.#destroyed) {
							reject(new Error('Player destroyed during initialization'))
							return
						}
						this.#callbacks.onReady?.()
						const player = this.#player
						if (player) {
							this.#callbacks.onDurationChange?.(player.getDuration())
						}
						resolve()
					},
					onStateChange: (e: { data: number }) => {
						this.#handleStateChange(e.data)
					},
				},
			})
		})
	}

	#handleStateChange(state: number): void {
		switch (state) {
			case YT_STATE.UNSTARTED: {
				this.#callbacks.onBlocked?.()
				this.#callbacks.onPause?.()
				break
			}
			case YT_STATE.ENDED: {
				this.#callbacks.onEnded?.()
				break
			}
			case YT_STATE.PLAYING: {
				this.#callbacks.onPlay?.()
				this.#callbacks.onSeeked?.()
				break
			}
			case YT_STATE.PAUSED: {
				this.#callbacks.onPause?.()
				break
			}
			case YT_STATE.BUFFERING: {
				this.#callbacks.onBuffering?.()
				this.#callbacks.onSeeking?.()
				break
			}
		}
	}

	play(): Promise<void> {
		this.#player?.playVideo()
		return Promise.resolve()
	}

	pause(): void {
		if (!this.#destroyed) {
			this.#player?.pauseVideo?.()
		}
	}

	getCurrentTime(): Promise<number> {
		return Promise.resolve(this.#player?.getCurrentTime?.() ?? 0)
	}

	setCurrentTime(time: number): void {
		this.#callbacks.onSeeking?.()
		this.#player?.seekTo?.(time)
	}

	getDuration(): Promise<number> {
		return Promise.resolve(this.#player?.getDuration?.() ?? 0)
	}

	isPaused(): Promise<boolean> {
		if (!this.#player) {
			return Promise.resolve(true)
		}
		const state = this.#player.getPlayerState?.()
		return Promise.resolve(
			state === undefined ||
				([YT_STATE.UNSTARTED, YT_STATE.ENDED, YT_STATE.PAUSED, YT_STATE.CUED] as number[]).includes(state),
		)
	}

	setMuted(muted: boolean): void {
		if (muted) {
			this.#player?.mute?.()
		} else {
			this.#player?.unMute?.()
		}
	}

	setVolume(_volume: number): void {
		// YouTube API doesn't have direct volume control, only mute/unmute
		// Volume is controlled via the embedded player settings
	}

	destroy(): void {
		this.#destroyed = true
		this.#player?.destroy?.()
		this.#player = undefined
	}
}
