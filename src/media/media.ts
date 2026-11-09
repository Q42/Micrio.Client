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
import { createMachine, type Machine } from '$core/machine'
import { mediaInitial, reduceMedia, type MediaBackend, type MediaEvent, type MediaState } from './media-state'
import '$ui/button'
import { ErrorCodes } from '$core/error'
import { parseTime } from '$utils/time'
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
	/** Render only a media frame and its controls, for a serial step with no video tour. @internal */
	controlsOnly?: boolean
	/** Play/pause handler for a controls-only frame. @internal */
	onplaypause?: () => void
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
	#machine: Machine<MediaState, MediaEvent> | undefined
	#subEl: MicrioElement | undefined
	/** Whether one render has completed, so a re-render must tear the previous player down. */
	#rendered = false

	/** The playback clock, read from the machine rather than mirrored into a second field. */
	get #currentTime(): number {
		return this.#machine?.$state.currentTime ?? 0
	}

	/** The playback duration, read from the machine. */
	get #duration(): number {
		return this.#machine?.$state.duration ?? 0
	}

	/**
	 * Tears down every player binding from a previous render.
	 *
	 * A source change re-renders this element: without this, the old adapter, media element,
	 * tour and machine survive and the new render branches on state that belongs to the
	 * previous source. Called before a re-render and from teardown.
	 */
	#resetPlayer(): void {
		this.#machine?.dispose()
		this.#machine = undefined
		this.#tourInstance?.destroy()
		this.#tourInstance = undefined
		this.#adapter?.destroy()
		this.#adapter = undefined
		this.#stopAdapterTick()
		// An audio element is appended to <body>, not to this element, so `replaceChildren`
		// would leave it playing.
		if (this.#mediaEl instanceof HTMLAudioElement) {
			this.#mediaEl.remove()
		}
		this.#mediaEl = undefined
		this.#frame = undefined
		this.#hlsSrc = undefined
		this.#subEl?.remove()
		this.#subEl = undefined
	}

	/** Applies one machine state to the controls and the time CSS variable. */
	#applyMediaState(): void {
		this.#updateControls()
	}

	/** Emits the public play/pause pair on the phase edge, for every backend. */
	#onMediaTransition(state: MediaState, previous: MediaState): void {
		const wasPlaying = previous.phase === 'playing' || previous.phase === 'seeking'
		const isPlaying = state.phase === 'playing' || state.phase === 'seeking'
		if (wasPlaying === isPlaying || this._props.secondary) {
			return
		}
		this._getMicrio()?.events._dispatch(isPlaying ? 'media-play' : 'media-pause')
		this.dispatchEvent(new CustomEvent(isPlaying ? 'play' : 'pause'))
	}

	/** Reports the end of this playback run once per ended phase entry. */
	#reportMediaEnded(state: MediaState): void {
		if (state.backend !== 'tour' && !this._props.secondary) {
			this._getMicrio()?.events._dispatch('media-ended')
		}
		this.dispatchEvent(new CustomEvent('ended'))
		this._props.onended?.()
	}

	/** Pushes the clock to the tour host, subtitles and the viewer. */
	#emitTime(): void {
		const { currentTime } = this.#machine?.$state ?? { currentTime: 0 }
		this.#subEl?._setProps?.({ time: currentTime })
		this.dispatchEvent(new CustomEvent('timeupdate', { detail: currentTime }))
		if (!this._props.secondary) {
			this._getMicrio()?.events._dispatch('timeupdate', currentTime)
		}
	}

	/** Reads the native element into one sync event, rather than writing flags by hand. */
	#readElState(): void {
		const el = this.#mediaEl
		if (!el || !this.#machine) {
			return
		}
		this.#machine.send({
			type: 'sync',
			currentTime: el.currentTime,
			duration: el.duration || 0,
			paused: el.paused,
			seeking: el.seeking,
			ended: el.ended,
			muted: el.muted,
		})
	}

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
		// An unlisted video carries its token as `?h=<hash>`, and the slice above starts right after
		// the `?` — so the query form has to be read as a query. Reading it as a path token put
		// `h=h=<hash>` in the embed URL, which Vimeo rejects (and that is exactly the unlisted case
		// the token is for).
		const vimeoToken = src.match(/[?&]h=([^&#]+)/)?.[1] ?? (tokenPart.replace(/\?.*$/, '') || undefined)
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
		this.#machine?.send({ type: 'error' })
		console.error(`[Micrio] Media failed (${ErrorCodes.TOUR_LOAD_FAILED}):`, reason, error ?? '')
		this.dispatchEvent(new CustomEvent('error', { detail: err }))
		this._props.onerror?.(err)
		this._getMicrio()?.events._dispatch('media-error', { error: err, reason })
	}

	/** Reports that autoplay was blocked: playable, but only after a user gesture. */
	#blocked() {
		this.#machine?.send({ type: 'blocked' })
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
		if (this.#rendered) {
			this.#resetPlayer()
		}
		this.#rendered = true

		const p = this._props
		const { src } = p
		// A serial step without a video tour still needs the same media frame around its
		// control bar, or the bar loses the figure the tour's CSS positions.
		if (p.controlsOnly) {
			this.replaceChildren()
			const figure = createElement('figure', {
				attrs: { title: p.title ?? '' },
				className: p.className,
			})
			if (p.is360) {
				figure.style.setProperty('--micrio-background', 'transparent')
			}
			this.append(figure)
			createComponent('micrio-media-controls', {
				setProps: {
					paused: true,
					ended: false,
					hasAudio: p.hasAudio ?? true,
					fullscreenEl: p.fullscreenEl,
					getTimeDisplay: p.getTimeDisplay,
					onplaypause: p.onplaypause,
				},
				parent: figure,
			})
			return
		}
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
		let backend: MediaBackend = 'element'
		if (isYoutube) {
			backend = 'youtube'
		} else if (isVimeo) {
			backend = 'vimeo'
		} else if (isCloudflare) {
			backend = 'hls'
		} else if (isStandaloneVideoTour) {
			backend = 'tour'
		}

		this.#machine = createMachine<MediaState, MediaEvent, undefined>({
			initial: mediaInitial(backend, Boolean(p.muted)),
			context: undefined,
			reduce: reduceMedia,
			// Time events every 250 ms would fill the history with clock updates.
			historyLimit: 0,
			enter: {
				playing: ({ state, signal }) => {
					// A YouTube/Vimeo iframe has no media element to emit a clock.
					if (state.backend === 'youtube') {
						this.#startAdapterTick(signal)
					}
				},
				ended: ({ state }) => {
					this.#reportMediaEnded(state)
				},
			},
			effect: ({ state, previous, event }) => {
				this.#onMediaTransition(state, previous)
				if (event.type === 'time') {
					this.#emitTime()
				}
			},
		})
		this._watch(this.#machine, () => {
			this.#applyMediaState()
		})
		this._addCleanup(() => {
			this.#machine?.dispose()
			this.#machine = undefined
		})
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
							this.#tourInstance?.play()
							this.#machine?.send({ type: 'play' })
						},
						onPause: () => {
							this.#tourInstance?.pause()
							this.#machine?.send({ type: 'pause' })
						},
						onEnded: () => {
							this.#tourInstance?.pause()
							this.#machine?.send({ type: 'ended' })
						},
						onSeeking: () => {
							this.#machine?.send({ type: 'seeking' })
						},
						onSeeked: () => {
							this.#machine?.send({ type: 'seeked' })
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
							this.#tourInstance?.play()
							this.#machine?.send({ type: 'play' })
						},
						onPause: () => {
							this.#tourInstance?.pause()
							this.#machine?.send({ type: 'pause' })
						},
						onEnded: () => {
							this.#tourInstance?.pause()
							this.#machine?.send({ type: 'ended' })
						},
						onTimeUpdate: (t) => {
							this.#machine?.send({ type: 'time', currentTime: t })
						},
						onDurationChange: (d) => {
							this.#machine?.send({ type: 'time', duration: d })
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
					this.#machine?.send({ type: 'ended' })
				},
			})
			this.#adapter = adapter
			adapter.initialize().catch((error: unknown) => {
				this.#fail('the stream could not be initialised', error)
			})
		}

		// Tour instance
		if (p.tour && p.image && (this.#mediaEl || this.#frame || isStandaloneVideoTour)) {
			this.#tourInstance = new VideoTourInstance(p.image, p.tour)

			if (this.#mediaEl) {
				// Captured, not read back from `#mediaEl` at teardown time: `#createAudioElement`'s
				// own cleanup clears that field, which left this listener attached.
				const el = this.#mediaEl
				const onPlay = () => {
					this.#tourInstance?.play()
				}
				el.addEventListener('play', onPlay)
				this._addCleanup(() => {
					el.removeEventListener('play', onPlay)
				})
			}

			if (isStandaloneVideoTour) {
				this.#machine?.send({ type: 'time', duration: this.#tourInstance.duration })
				const ival = setInterval(() => {
					const tour = this.#tourInstance
					if (!tour) {
						return
					}
					const { currentTime, duration } = tour
					this.#machine?.send({ type: 'time', currentTime, duration })
					tour.updateEvents(currentTime)
					this.#machine?.send(tour.paused ? { type: 'pause' } : { type: 'play' })
					if (tour.ended) {
						this.#machine?.send({ type: 'ended' })
					}
				}, 250)
				this._addCleanup(() => {
					clearInterval(ival)
				})
				if (p.autoplay) {
					this.#tourInstance.play()
				}
			} else {
				// Captured for the same reason as the `play` listener above
				const el = this.#mediaEl
				const onEnded = () => this.#tourInstance?.pause()
				el?.addEventListener('ended', onEnded)
				this._addCleanup(() => {
					el?.removeEventListener('ended', onEnded)
				})
				if (el && !el.paused) {
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
				} else if (this.#adapter) {
					const adapter = this.#adapter
					void adapter.isPaused().then((paused) => {
						if (paused) {
							void adapter.play()
						} else {
							adapter.pause()
						}
					})
				} else if (this.#tourInstance) {
					if (this.#tourInstance.paused) {
						this.#tourInstance.play()
						// The camera-only tour has no media element to emit `play`
						this.#machine?.send({ type: 'play' })
					} else {
						this.#tourInstance.pause()
						this.#machine?.send({ type: 'pause' })
					}
				}
			}

			const onmute = () => {
				const muted = !(this.#machine?.$state.muted ?? false)
				const el = this.#mediaEl
				if (el) {
					el.muted = muted
				} else if (this.#adapter) {
					this.#adapter.setMuted(muted)
				}
				this.#machine?.send({ type: 'mute', muted })
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
					// A paused iframe player never emits the seeked state that would clear this,
					// which left the play and mute buttons disabled after a paused seek.
					this.#machine?.send({ type: 'seeking' })
					this.#adapter.setCurrentTime(n)
					this.#machine?.send({ type: 'seeked' })
				}
			}

			createComponent('micrio-media-controls', {
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
				const onUpdate = (): void => {
					this.#readElState()
				}
				const onTimeUpdate = () => {
					const el = this.#mediaEl
					if (!el) {
						return
					}
					this.#machine?.send({
						type: 'time',
						currentTime: el.currentTime,
						duration: el.duration || 0,
					})
					this.#tourInstance?.updateEvents(el.currentTime)
				}
				const onEnded = (): void => {
					this.#readElState()
					// The event is authoritative; a synthetic ended in tests (and some
					// platforms) does not flip `el.ended` before the event is observed.
					this.#machine?.send({ type: 'ended' })
				}

				// Captured, not read back from `#mediaEl` at teardown time: `#createAudioElement`'s
				// own cleanup clears that field, which would leave every listener attached.
				const el = this.#mediaEl
				el.addEventListener('timeupdate', onTimeUpdate)
				el.addEventListener('loadedmetadata', onUpdate)
				el.addEventListener('play', onUpdate)
				el.addEventListener('pause', onUpdate)
				el.addEventListener('ended', onEnded)
				el.addEventListener('seeking', onUpdate)
				el.addEventListener('seeked', onUpdate)

				this._addCleanup(() => {
					el.removeEventListener('timeupdate', onTimeUpdate)
					el.removeEventListener('loadedmetadata', onUpdate)
					el.removeEventListener('play', onUpdate)
					el.removeEventListener('pause', onUpdate)
					el.removeEventListener('ended', onEnded)
					el.removeEventListener('seeking', onUpdate)
					el.removeEventListener('seeked', onUpdate)
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

	#startAdapterTick(signal: AbortSignal) {
		if (this.#adapterTick != null) {
			return
		}
		const tick = setInterval(async () => {
			if (!this.#adapter) {
				return
			}
			// Vimeo/YouTube adapters answer over postMessage; the two reads are independent.
			const adapter = this.#adapter
			const [currentTime, duration] = await Promise.all([adapter.getCurrentTime(), adapter.getDuration()])
			// The player can be torn down or replaced while those postMessage reads are in flight.
			if (this.#adapter !== adapter || !this.isConnected) {
				return
			}
			this.#tourInstance?.updateEvents(currentTime)
			// The machine emits the viewer/subtitle timeupdate and updates the controls.
			this.#machine?.send({ type: 'time', currentTime, duration })
		}, 250)
		this.#adapterTick = tick
		signal.addEventListener('abort', () => {
			if (this.#adapterTick === tick) {
				this.#stopAdapterTick()
			}
		})
	}

	#stopAdapterTick() {
		if (this.#adapterTick != null) {
			clearInterval(this.#adapterTick)
			this.#adapterTick = undefined
		}
	}

	/** Exposes the playback position to CSS as a quoted string (`--time: '1:45'`). */
	#setTimeVar(): void {
		// A serial tour owns the timeline: its step media is given the cumulative tour
		// time, and this step-local value would shadow it on the shared control bar.
		if (this.closest('micrio-serial-tour')) {
			return
		}
		this.style.setProperty('--time', `'${parseTime(this.#currentTime)}'`)
	}

	/**
	 * The duration the controls are given: the media element's own, read live, else the tour's
	 * authored duration before the element reports one.
	 *
	 * Deliberately not `#duration`, which is only refreshed when a media event runs: the loader
	 * sets the element's `duration`/`readyState` in its own task, *before* the queued event that
	 * tells this component. A bar click landing in that window was mapped through the stale copy,
	 * became a seek to 0, and looked like a lost click.
	 * @internal
	 */
	#barDuration(): number {
		const live = this.#mediaEl?.duration
		if (live !== undefined && Number.isFinite(live) && live > 0) {
			return live
		}
		return this.#tourInstance?.duration ?? this.#duration
	}

	#updateControls() {
		this.#setTimeVar()
		const state = this.#machine?.$state
		const controlsEl = this.querySelector('micrio-media-controls')
		if (state && controlsEl instanceof MicrioElement) {
			const playing = state.phase === 'playing' || state.phase === 'seeking'
			controlsEl._setProps({
				currentTime: state.currentTime,
				duration: this.#barDuration(),
				paused: !playing,
				ended: state.phase === 'ended',
				seeking: state.phase === 'seeking',
				muted: state.muted,
			})
		}
	}

	/** @internal */
	_onDestroy() {
		// A media element keeps playing after it is detached from the DOM, and the figure holding it
		// goes away with this element: closing an audio or Cloudflare tour would leave the sound
		// running. Pausing here (while `#mediaEl` is still set) is the one place that covers every
		// element kind; the tour is torn down first so it cannot restart playback.
		this.#mediaEl?.pause()
		this.#resetPlayer()
	}
}

customElements.define(MicrioMedia.tag, MicrioMedia)
