import type { ElementOptions } from '$utils/dom'
import { createElement, IFRAME_ALLOW } from '$utils/dom'
import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import type { Readable } from '$core/store'
import { VideoTourInstance } from './videotour'
import { YouTubePlayerAdapter } from './youtube-adapter'
import { VimeoPlayerAdapter } from './vimeo-adapter'
import { HLSPlayerAdapter, cloudflareStreamUrl, mediaSourceSupported } from './hls-adapter'
import type { MediaPlayerAdapter } from '$types/media'
import '$ui/button'
import { ErrorCodes } from '$core/error'
import './media-controls'

const YOUTUBE_RE =
	/((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be|youtube-nocookie\.com))(\/(?:[\w-]+\?v=|embed\/|v\/)?)([\w-]+)(\S+)?/
const VIMEO_RE = /vimeo\.com/

/** True for a registered Micrio custom element; keeps the narrowed type non-generic. */
function isMicrioElement(el: unknown): el is MicrioElement {
	return el instanceof MicrioElement
}

/** Creates a `<micrio-*>` custom element and narrows it to its registered class. */
function createComponent(tag: string, options: ElementOptions): MicrioElement {
	const el = createElement(tag, options)
	if (!isMicrioElement(el)) {
		throw new Error(`<${tag}> is not a registered Micrio element`)
	}
	return el
}

/** True when `value` is a store (the `volume` injection provides a number store). */
function isNumberStore(value: unknown): value is Readable<number> {
	return typeof value === 'object' && value !== null && 'subscribe' in value && typeof value.subscribe === 'function'
}

/**
 * Creates the element a component uses for audio playback.
 *
 * Deliberately one per component: a single shared element means a second audio media
 * overwrites its `src` and aborts the first one's playback, while the first component's
 * controls, clock and subtitles keep reading that element.
 */
function createAudioElement(): HTMLAudioElement {
	const audio = document.createElement('audio')
	audio.style.display = 'none'
	audio.controls = false
	audio.preload = 'metadata'
	document.body.append(audio)
	return audio
}

/** Reads a media element's failure into a sentence a log or error UI can show. */
function describeMediaError(error: MediaError | null): string {
	switch (error?.code) {
		case MediaError.MEDIA_ERR_ABORTED: {
			return 'loading the media was aborted'
		}
		case MediaError.MEDIA_ERR_NETWORK: {
			return 'the media could not be downloaded (network failure or timeout)'
		}
		case MediaError.MEDIA_ERR_DECODE: {
			return 'the media could not be decoded'
		}
		case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: {
			return 'the media source is not available or not supported'
		}
		default: {
			return 'the media could not be played'
		}
	}
}

/** Props for the MicrioMedia component. @internal */
export interface MediaProps {
	src?: string
	image?: MicrioImage
	tour?: Models.ImageData.VideoTour | null
	autoplay?: boolean
	controls?: boolean
	is360?: boolean
	width?: number
	height?: number
	muted?: boolean
	secondary?: boolean
	figcaption?: string
	/** The authored embed title. Used as the accessible name of the frame/video it creates. */
	title?: string
	className?: string
	onended?: () => void
	onclose?: () => void
	/** The media could not play (bad source, network failure, decoder error). */
	onerror?: (error: Error) => void
	/** The browser blocked autoplay: the media stays paused until the user plays it. */
	onblocked?: () => void
	getTimeDisplay?: (currentTime: number, duration: number) => string
	hasAudio?: boolean
	fullscreenEl?: HTMLElement
}
import './media.css'

/** Custom element that renders and manages audio/video media, supporting YouTube, Vimeo, Cloudflare HLS, native HTML5, and video tours with integrated controls and subtitles. */
class MicrioMedia extends MicrioElement<MediaProps> {
	/* @internal */
	static tag = 'micrio-media'

	#mediaEl: HTMLVideoElement | HTMLAudioElement | undefined
	#tourInstance: VideoTourInstance | undefined
	#frame: HTMLIFrameElement | undefined
	#hlsSrc: string | undefined
	#adapter: MediaPlayerAdapter | undefined
	#adapterTick: ReturnType<typeof setInterval> | undefined
	#paused = true
	#ended = false
	#duration = 0
	#currentTime = 0
	#seeking = false
	/** Whether the end of playback has already been reported to the host. */
	#endedReported = false
	/** Last reported paused state (`1` paused, `0` playing, `-1` nothing reported yet), so the
	 *  public `media-play`/`media-pause` pair fires on transitions only. */
	#reportedPaused = -1
	#muted = false
	#subEl: MicrioElement | undefined

	#createYoutubeIframe(src: string, p: MediaProps, figure: HTMLElement) {
		const match = src.match(YOUTUBE_RE)
		const videoId = match?.[5]
		if (!videoId) {
			return
		}
		const iframe = createElement('iframe', {
			props: {
				src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${p.autoplay ? 1 : 0}&playsinline=1&enablejsapi=1`,
				width: String(p.width ?? 400),
				height: String(p.height ?? 240),
			},
			attrs: {
				allow: IFRAME_ALLOW,
				allowfullscreen: '',
			},
			parent: figure,
		})
		this.#frame = iframe
	}

	#createVimeoIframe(src: string, p: MediaProps, figure: HTMLElement) {
		const idMatch = src.match(/\/(\d+)/)
		if (!idMatch?.[1]) {
			return
		}
		const vimeoId = idMatch[1]
		const tokenPart = src.slice(src.indexOf(vimeoId) + vimeoId.length + 1)
		const vimeoToken = tokenPart.replace(/\?.*$/, '') || undefined
		const embedSrc = `https://player.vimeo.com/video/${vimeoId}?${vimeoToken ? `h=${vimeoToken}&` : ''}title=0&portrait=0&sidedock=0&byline=0&controls=0`
		const iframe = createElement('iframe', {
			props: {
				src: embedSrc,
				width: String(p.width ?? 400),
				height: String(p.height ?? 240),
			},
			attrs: {
				allow: IFRAME_ALLOW,
				allowfullscreen: '',
			},
			parent: figure,
		})
		this.#frame = iframe
	}

	#createCloudflareVideo(src: string, p: MediaProps, figure: HTMLElement) {
		const cfId = src.slice(8)
		const hlsSrc = cloudflareStreamUrl(cfId)
		const video = createElement('video', {
			attrs: { title: p.title ?? '' },
			props: {
				src: hlsSrc,
				width: p.width ?? 400,
				height: p.height ?? 240,
				controls: false,
				preload: 'metadata',
				playsInline: true,
				crossOrigin: 'anonymous',
				...(p.autoplay ? { autoplay: true } : {}),
				...(p.muted ? { muted: true } : {}),
			},
			parent: figure,
		})
		this.#mediaEl = video
		this.#wireEvents(video)
		this.#hlsSrc = hlsSrc
	}

	/**
	 * Reports a playback failure: to the prop callback when one was given, and always as an
	 * event on this element, so a host (the serial tour) can react without inspecting the DOM.
	 */
	#fail(reason: string, error?: unknown) {
		// A `play()` promise rejects with `AbortError` whenever the call is interrupted by a
		// `pause()` — a second play-button click, a seeking step, a teardown. That is not a
		// failure, and reporting it stops a running serial tour.
		if (error instanceof DOMException && error.name === 'AbortError') {
			return
		}
		// A real autoplay policy block is playable-after-a-gesture, not broken media.
		if (error instanceof DOMException && error.name === 'NotAllowedError') {
			this.#blocked()
			return
		}
		// Tearing a player down mid-load is cancellation, not failure — the error would
		// otherwise reach the host as a `media-error` and stop its tour.
		if (!this.isConnected) {
			return
		}
		const err = error instanceof Error ? error : new Error(reason)
		console.error(`[Micrio] Media failed (${ErrorCodes.TOUR_LOAD_FAILED}):`, reason, error ?? '')
		this.dispatchEvent(new CustomEvent('error', { detail: err }))
		this._props.onerror?.(err)
		this._getMicrio()?.events._dispatch('media-error', { error: err, reason })
	}

	/** Reports that autoplay was blocked: playable, but only after a user gesture. */
	#blocked() {
		this.#paused = true
		this.#updateControls()
		this.dispatchEvent(new CustomEvent('blocked'))
		this._props.onblocked?.()
		// The documented signal for "playable, but the browser refused to start it"
		this._getMicrio()?.events._dispatch('media-blocked')
	}

	#createAudioElement(src: string, p: MediaProps, _figure: HTMLElement) {
		if (!(this.#mediaEl instanceof HTMLAudioElement)) {
			const audio = createAudioElement()
			this.#mediaEl = audio
			this.#wireEvents(audio)
			this._addCleanup(() => {
				audio.remove()
				this.#mediaEl = undefined
			})
		}
		const audio = this.#mediaEl
		audio.src = src
		if (p.autoplay) {
			audio.setAttribute('autoplay', '')
		} else {
			audio.removeAttribute('autoplay')
		}
		audio.muted = Boolean(p.muted)
	}

	#createIframe(src: string, p: MediaProps, figure: HTMLElement) {
		const iframe = createElement('iframe', {
			props: {
				src,
				width: String(p.width ?? 400),
				height: String(p.height ?? 240),
			},
			attrs: {
				allow: IFRAME_ALLOW,
				allowfullscreen: '',
			},
			parent: figure,
		})
		this.#frame = iframe
	}

	/** @internal */
	protected _render() {
		const p = this._props
		const { src } = p
		if (!src && !p.tour) {
			this.replaceChildren()
			return
		}

		const isYoutube = src ? YOUTUBE_RE.test(src) : false
		const isVimeo = src ? VIMEO_RE.test(src) : false
		const isCloudflare = src ? src.startsWith('cfvid://') : false
		const isAudio = src
			? src.includes('.mp3') || src.includes('.ogg') || src.includes('.wav') || src.includes('audio/')
			: false
		const isEmbed = Boolean(src) && !isYoutube && !isVimeo && !isCloudflare && !isAudio
		const isStandaloneVideoTour = Boolean(p.tour) && Boolean(p.image) && !src
		this.replaceChildren()

		const figure = createElement('figure', {
			attrs: { title: p.title ?? '' },
			className: p.className,
		})

		if (p.is360) {
			figure.style.setProperty('--micrio-background', 'transparent')
		}

		if (src && isYoutube) {
			this.#createYoutubeIframe(src, p, figure)
		} else if (src && isVimeo) {
			this.#createVimeoIframe(src, p, figure)
		} else if (src && isCloudflare) {
			this.#createCloudflareVideo(src, p, figure)
		} else if (src && isAudio) {
			this.#createAudioElement(src, p, figure)
		} else if (src) {
			this.#createIframe(src, p, figure)
		}

		if (p.figcaption) {
			createElement('figcaption', {
				textContent: p.figcaption,
				parent: figure,
			})
		}

		this.append(figure)

		// Initialize player adapters
		if (this.#frame) {
			const pWidth = p.width ?? 400
			const pHeight = p.height ?? 240
			if (isYoutube) {
				const adapter = new YouTubePlayerAdapter(
					this.#frame,
					{ width: pWidth, height: pHeight },
					{
						onPlay: () => {
							this.#paused = false
							this.#endedReported = false
							this.#startAdapterTick()
							this.#updateControls()
						},
						onPause: () => {
							this.#paused = true
							this.#stopAdapterTick()
							this.#updateControls()
						},
						onEnded: () => {
							this.#ended = true
							this.#paused = true
							this.#stopAdapterTick()
							this.#updateControls()
							p.onended?.()
						},
						onSeeking: () => {
							this.#seeking = true
						},
						onSeeked: () => {
							this.#seeking = false
							this.#updateControls()
						},
						// See the Vimeo branch: the adapter's `play()` always resolves, so its
						// autoplay block never reaches the `.catch(() => #blocked())` around it.
						onBlocked: () => {
							this.#blocked()
						},
						onError: (error) => {
							this.#fail('the player reported an error', error)
						},
					},
				)
				this.#adapter = adapter
				adapter
					.initialize()
					.then(() => {
						if (p.autoplay) {
							void adapter.play().catch(() => {
								this.#blocked()
							})
						}
					})
					.catch((error: unknown) => {
						this.#fail('the player could not be initialised', error)
					})
			} else if (isVimeo) {
				const adapter = new VimeoPlayerAdapter(
					this.#frame,
					{ width: pWidth, height: pHeight },
					{
						onPlay: () => {
							this.#paused = false
							this.#endedReported = false
							this.#updateControls()
						},
						onPause: () => {
							this.#paused = true
							this.#updateControls()
						},
						onEnded: () => {
							this.#ended = true
							this.#paused = true
							this.#updateControls()
							p.onended?.()
						},
						onTimeUpdate: (t) => {
							this.#currentTime = t
							this.#updateControls()
						},
						onDurationChange: (d) => {
							this.#duration = d
						},
						// Without these the adapter's own autoplay block and post-init errors are
						// swallowed: its `play()` always resolves, so the `.catch(() => #blocked())`
						// around it can never fire.
						onBlocked: () => {
							this.#blocked()
						},
						onError: (error) => {
							this.#fail('the player reported an error', error)
						},
					},
				)
				this.#adapter = adapter
				adapter
					.initialize()
					.then(() => {
						if (p.autoplay) {
							void adapter.play().catch(() => {
								this.#blocked()
							})
						}
					})
					.catch((error: unknown) => {
						this.#fail('the player could not be initialised', error)
					})
			}
		}

		// Initialize HLS adapter for Cloudflare video
		if (isCloudflare && this.#hlsSrc && this.#mediaEl instanceof HTMLVideoElement && mediaSourceSupported()) {
			const adapter = new HLSPlayerAdapter(this.#mediaEl, this.#hlsSrc, {
				onReady: () => {
					this.#updateControls()
				},
				onError: (error) => {
					this.#fail('the stream could not be loaded', error)
				},
				onEnded: () => {
					this.#ended = true
					this.#paused = true
					this.#updateControls()
					p.onended?.()
				},
			})
			this.#adapter = adapter
			adapter.initialize().catch((error: unknown) => {
				this.#fail('the stream could not be initialised', error)
			})
		}

		// Tour instance
		if (p.tour && p.image && (this.#mediaEl || isStandaloneVideoTour)) {
			this.#tourInstance = new VideoTourInstance(p.image, p.tour)

			if (this.#mediaEl) {
				const onPlay = () => this.#tourInstance?.play()
				this.#mediaEl.addEventListener('play', onPlay)
				this._addCleanup(() => this.#mediaEl?.removeEventListener('play', onPlay))
			}

			if (isStandaloneVideoTour) {
				this.#duration = this.#tourInstance.duration
				const ival = setInterval(() => {
					const tour = this.#tourInstance
					if (!tour) {
						return
					}
					this.#currentTime = tour.currentTime
					this.#duration = tour.duration
					this.#paused = tour.paused
					this.#ended = tour.ended
					tour.updateEvents(this.#currentTime)
					this.#updateControls()
					if (!p.secondary) {
						this._getMicrio()?.dispatchEvent(new CustomEvent('timeupdate', { detail: this.#currentTime }))
					}
					// A camera-only tour has no media element for the subtitles to observe, so its
					// clock is pushed from the same tick.
					this.#subEl?._setProps?.({ time: this.#currentTime })
					// Without a media element the `ended` flag stays true after the tour finishes,
					// so this tick would call the host back every 250 ms.
					if (this.#ended && !this.#endedReported && (!this.#mediaEl || this.#mediaEl.ended)) {
						this.#endedReported = true
						p.onended?.()
					}
				}, 250)
				this._addCleanup(() => {
					clearInterval(ival)
				})
				if (p.autoplay) {
					this.#tourInstance.play()
				}
			} else {
				const onEnded = () => this.#tourInstance?.pause()
				this.#mediaEl?.addEventListener('ended', onEnded)
				this._addCleanup(() => this.#mediaEl?.removeEventListener('ended', onEnded))
				if (!this.#mediaEl?.paused) {
					this.#tourInstance?.play()
				}
			}
		}

		// Create subtitles element as a child (auto-destroyed when media is removed)
		if (!p.secondary && p.tour && !('steps' in p.tour)) {
			const micrio = this._getMicrio()
			const lang = micrio?.lang || 'en'
			const sub = p.tour.i18n?.[lang]?.subtitle
			if (sub?.src) {
				const host = this.closest('micrio-main') ?? this.parentNode
				this.#subEl = createComponent('micrio-subtitles', {
					setProps: { src: sub.src, mediaEl: this.#mediaEl ?? this },
					parent: host instanceof HTMLElement ? host : undefined,
				})
			}
		}

		// The playback wiring below sits outside the controls guard, but its `update` helper
		// lives inside it (it writes the control bar). This handle is how the wiring reaches it.
		let updateControls: (() => void) | undefined

		// Controls
		if (p.controls !== false && !isEmbed) {
			const { tour } = p
			const hasSub =
				!p.secondary &&
				tour != null &&
				!('steps' in tour) &&
				Boolean(tour.i18n?.[this._getMicrio()?.lang || 'en']?.subtitle)

			const onplaypause = () => {
				const el = this.#mediaEl
				if (el) {
					if (el.paused) {
						el.play().catch((error: unknown) => {
							this.#fail('the media could not be played', error)
						})
						this.#tourInstance?.play()
					} else {
						el.pause()
						this.#tourInstance?.pause()
					}
				} else if (this.#tourInstance) {
					if (this.#tourInstance.paused) {
						this.#tourInstance.play()
					} else {
						this.#tourInstance.pause()
					}
				} else if (this.#adapter) {
					const adapter = this.#adapter
					void adapter.isPaused().then((paused) => {
						if (paused) {
							void adapter.play()
						} else {
							adapter.pause()
						}
					})
				}
			}

			const onmute = () => {
				const el = this.#mediaEl
				if (el) {
					this.#muted = !this.#muted
					el.muted = this.#muted
					this.#updateControls()
				} else if (this.#adapter) {
					this.#muted = !this.#muted
					this.#adapter.setMuted(this.#muted)
					this.#updateControls()
				}
			}

			const onseek = (n: number) => {
				// A video tour is not either/or with its media element: seeking has to move the
				// tour to that time as well, or its camera events and timeline stay behind the
				// audio that was just skipped
				if (this.#tourInstance) {
					this.#tourInstance.currentTime = n
				}
				const el = this.#mediaEl
				if (el) {
					el.currentTime = n
				} else if (this.#adapter) {
					this.#adapter.setCurrentTime(n)
				}
			}

			const update = (): void => {
				const el = this.#mediaEl
				if (el) {
					this.#currentTime = el.currentTime
					this.#duration = el.duration || 0
					this.#paused = el.paused
					this.#ended = el.ended || false
					this.#seeking = el.seeking
					this.#muted = el.muted
				} else if (this.#tourInstance) {
					return // tour-only uses its own interval
				} else if (this.#adapter) {
					// YouTube tick updates #currentTime already; Vimeo uses callbacks
					return
				} else {
					return
				}
				ctrlEl._setProps({
					currentTime: this.#currentTime,
					duration: this.#duration,
					paused: this.#paused,
					ended: this.#ended,
					seeking: this.#seeking,
					muted: this.#muted,
					hasAudio: p.hasAudio ?? (Boolean(p.src) && !isAudio),
					subtitles: hasSub,
					getTimeDisplay: p.getTimeDisplay,
					fullscreenEl: p.fullscreenEl ?? (isAudio ? undefined : figure),
					onplaypause,
					onmute,
					onseek,
					onclose: p.onclose,
				})
			}

			updateControls = update

			const ctrlEl = createComponent('micrio-media-controls', {
				setProps: {
					paused: true,
					ended: false,
					hasAudio: p.hasAudio ?? (Boolean(p.src) && !isAudio),
					subtitles: hasSub,
					getTimeDisplay: p.getTimeDisplay,
					fullscreenEl: p.fullscreenEl ?? (isAudio ? undefined : figure),
					onplaypause,
					onmute,
					onseek,
					onclose: p.onclose,
				},
				parent: figure,
			})

			// Prime the controls with the state known now, so the readout is filled from the
			// first frame. Waiting for the first `loadedmetadata`/`timeupdate` leaves it empty
			// until then -- and an empty readout collapses, handing its space to the bar.
			this.#updateControls()
		}

		// The playback wiring is deliberately outside the controls guard: a media-backed tour
		// with `controls: false` still has to advance its tour events and report `onended`.
		if (
			this.#mediaEl &&
			(this.#mediaEl instanceof HTMLVideoElement || this.#mediaEl instanceof HTMLAudioElement) &&
			!isStandaloneVideoTour
		) {
			{
				// A new element starts unreported, so the first `update` still resolves a state.
				this.#reportedPaused = -1
				// `media-play`/`media-pause` are reported on the transition, so a repeated `play`
				// event from the element cannot double-fire them. `-1` means "nothing reported yet".
				const reportPlayback = (): void => {
					const el = this.#mediaEl
					if (!el || p.secondary) {
						return
					}
					const paused = el.paused ? 1 : 0
					if (paused === this.#reportedPaused) {
						return
					}
					this.#reportedPaused = paused
					this._getMicrio()?.events._dispatch(paused ? 'media-pause' : 'media-play')
				}
				const onUpdate = (): void => {
					updateControls?.()
					reportPlayback()
				}
				const onTimeUpdate = () => {
					updateControls?.()
					this.#subEl?._setProps?.({ time: this.#currentTime })
					this.#tourInstance?.updateEvents(this.#currentTime)
					// Its own playback progress, so a host component (the serial tour) can key
					// its timeline off real playback instead of reaching into the DOM for the
					// media element — which an iframe-based tour does not have at all.
					this.dispatchEvent(new CustomEvent('timeupdate', { detail: this.#currentTime }))
					if (!p.secondary) {
						this._getMicrio()?.events._dispatch('timeupdate', this.#currentTime)
					}
				}
				const onEnded = () => {
					updateControls?.()
					if (!p.secondary) {
						this._getMicrio()?.events._dispatch('media-ended')
					}
					// The step's media finished: a serial tour waits for this before moving on,
					// so a step is never cut off while its audio is still playing.
					this.dispatchEvent(new CustomEvent('ended'))
					if (!isStandaloneVideoTour) {
						p.onended?.()
					}
				}
				const onSeeking = () => {
					this.#seeking = true
					updateControls?.()
				}
				const onSeeked = () => {
					this.#seeking = false
					updateControls?.()
				}

				// Captured, not read back from `#mediaEl` at teardown time: `#createAudioElement`'s
				// own cleanup clears that field, which would leave every listener attached.
				const el = this.#mediaEl
				el.addEventListener('timeupdate', onTimeUpdate)
				el.addEventListener('loadedmetadata', onUpdate)
				el.addEventListener('play', onUpdate)
				el.addEventListener('pause', onUpdate)
				el.addEventListener('ended', onEnded)
				el.addEventListener('seeking', onSeeking)
				el.addEventListener('seeked', onSeeked)

				this._addCleanup(() => {
					el.removeEventListener('timeupdate', onTimeUpdate)
					el.removeEventListener('loadedmetadata', onUpdate)
					el.removeEventListener('play', onUpdate)
					el.removeEventListener('pause', onUpdate)
					el.removeEventListener('ended', onEnded)
					el.removeEventListener('seeking', onSeeking)
					el.removeEventListener('seeked', onSeeked)
				})

				onUpdate()
			}
		}
	}

	#wireEvents(el: HTMLVideoElement | HTMLAudioElement) {
		const volumeStore = this._inject('volume')
		if (isNumberStore(volumeStore)) {
			this._addCleanup(
				volumeStore.subscribe((v: number) => {
					el.volume = v
				}),
			)
		}

		// A failing source (404, timeout, dropped connection, undecodable data) reports
		// itself only here: the element's own `error` event and its `MediaError` code.
		const onError = () => {
			this.#fail(describeMediaError(el.error), el.error)
		}
		el.addEventListener('error', onError)
		this._addCleanup(() => {
			el.removeEventListener('error', onError)
		})
	}

	#startAdapterTick() {
		if (this.#adapterTick != null) {
			return
		}
		this.#adapterTick = setInterval(async () => {
			if (!this.#adapter) {
				return
			}
			this.#currentTime = await this.#adapter.getCurrentTime()
			this.#duration = await this.#adapter.getDuration()
			this.#tourInstance?.updateEvents(this.#currentTime)
			this.#updateControls()
		}, 250)
	}

	#stopAdapterTick() {
		if (this.#adapterTick != null) {
			clearInterval(this.#adapterTick)
			this.#adapterTick = undefined
		}
	}

	#updateControls() {
		const controlsEl = this.querySelector('micrio-media-controls')
		if (controlsEl instanceof MicrioElement) {
			controlsEl._setProps({
				currentTime: this.#currentTime,
				duration: this.#duration,
				paused: this.#paused,
				ended: this.#ended,
				seeking: this.#seeking,
				muted: this.#muted,
			})
		}
	}

	/** @internal */
	_onDestroy() {
		this.#tourInstance?.destroy()
		this.#adapter?.destroy()
		this.#stopAdapterTick()
		this.#subEl?.remove()
	}
}

customElements.define(MicrioMedia.tag, MicrioMedia)
