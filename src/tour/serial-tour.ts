import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import { DataLoader } from '$utils/dataLoader'
import { parseTime } from '$utils/time'
import { afterFrame, createElement } from '$utils/dom'
import '$media/media'

/** Properties for the serial tour component. @internal */
export interface SerialTourProps {
	tour: Models.ImageData.MarkerTour
	onended?: () => void
}
import './serial-tour.css'

/** Web component that plays a sequential tour with progress bars and chapter navigation. */
class MicrioSerialTour extends MicrioElement<SerialTourProps> {
	/** The custom element tag name. @internal */
	static tag = 'micrio-serial-tour'

	#props: Partial<SerialTourProps> = {}
	#stepInfo: Models.ImageData.MarkerTourStepInfo[] = []
	#currentStep = 0
	#built = false
	#mediaEl: HTMLElement | undefined = undefined
	/** Step clock, in seconds since the current step opened (see `#tick`). */
	#elapsed = 0
	/** Control bar built for a step whose marker carries no video tour, so there is no media element to hold one. */
	#ownControls: MicrioElement | undefined = undefined
	/** The current step has media, so its own `ended` is what releases the step. */
	#hasMedia = false
	/** That media has been observed playing at least once (first `timeupdate`). */
	#mediaPlaying = false
	/** Autoplay was blocked: the step waits, paused, for the user to play it (never skipped). */
	#mediaPaused = false
	/** Detaches the current step's media listeners. */
	#mediaCleanup: (() => void) | undefined = undefined
	/** Set by `#break`: a failed step can report its error more than once, and the tour must stop once. */
	#broken = false
	#duration = 0
	#noTimeScrub = false
	/** Incremented by every `#openStep`, so a superseded call stops after its await. */
	#stepToken = 0

	/** @internal */
	_onMount() {
		const { tour } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !tour) {
			return
		}

		this.#stepInfo = tour.stepInfo || []
		this.#duration = this.#stepInfo.reduce((c, s) => c + (s.duration || 0), 0)
		this.#noTimeScrub = Boolean(micrio.$current?.$settings?.ui?.controls?.serialTourNoTimeScrub)

		micrio.dataset.markerTourActive = ''
		this._addCleanup(() => {
			delete micrio.dataset.markerTourActive
		})

		const mt = tour
		mt.next = () => {
			this.#nextStep()
		}
		mt.prev = () => {
			if (this.#currentStep > 0) {
				void this.#openStep(this.#currentStep - 1)
			}
		}

		this._addCleanup(
			micrio.state.marker.subscribe((m) => {
				if (!m || this.#stepInfo.length === 0) {
					return
				}
				const id = typeof m === 'string' ? m : m.id
				const idx = this.#stepInfo.findIndex((s) => s.markerId === id)
				if (idx >= 0 && idx !== this.#currentStep) {
					for (const s of this.#stepInfo) {
						s.ended = false
					}
					void this.#openStep(idx)
				}
			}),
		)

		this.#build()

		// The step clock belongs to the tour, not to the media element of a step: a serial
		// tour has to run whether or not a step carries a video that actually plays, so its
		// progress, time readout and advancing come from here. The media element of a
		// playing step still drives the elapsed time (see `#tick`).
		const interval = setInterval(() => {
			this.#tick()
		}, 250)
		this._addCleanup(() => {
			clearInterval(interval)
		})

		void this.#openStep(0)
	}

	#build() {
		if (this.#built) {
			return
		}
		this.#built = true

		// Chapters are opt-in: the editor has to set `printChapters` for the list to print,
		// even though the steps carry titles.
		if (this.#props.tour?.printChapters === true) {
			const ol = createElement('ol', { className: 'chapters' })
			for (const [i, si] of this.#stepInfo.entries()) {
				const marker = DataLoader._getStepMarker(si)
				const title = this.#getTitle(marker)
				if (title) {
					createElement('li', {
						dataset: { idx: String(i) },
						parent: ol,
						children: [
							createElement('button', {
								textContent: title,
								events: {
									click: () => {
										this.#goto(i)
									},
								},
							}),
						],
					})
				}
			}
			if (ol.children.length > 0) {
				this.append(ol)
			}
		}
	}

	async #openStep(idx: number) {
		const micrio = this._getMicrio()
		if (!micrio) {
			return
		}
		// Opening a cross-image step can take a whole step's worth of time, during which the
		// interval keeps calling `#openStep` for the same target (the step is not committed yet).
		// This token makes every call after the newest a no-op, so the step's media is not torn
		// down and rebuilt over and over while the image loads.
		const token = ++this.#stepToken

		const close = () => {
			micrio.state.tour.set(undefined)
			this.#props.onended?.()
			this.remove()
		}

		const si = this.#stepInfo[idx]
		if (si === undefined) {
			return
		}

		si.ended = false
		si.currentTime = 0

		const marker = DataLoader._getStepMarker(si)

		let startView: Models.Camera.View | undefined
		if (marker?.videoTour) {
			const timeline = marker.videoTour.i18n?.[micrio.lang]?.timeline
			if (timeline?.length && timeline[0].start <= 1) {
				startView = timeline[0].rect
			}
		}

		if (si.micrioId && micrio.$current?.id !== si.micrioId) {
			await micrio.open(si.micrioId, { startView })
			if (token !== this.#stepToken || !this.isConnected) {
				return
			}
		}

		// Opening the step image can take as long as a whole step, so the clock only starts
		// once the step is really up: this is also the point the step becomes current.
		if (this.#mediaEl) {
			this.#mediaEl.remove()
			this.#mediaEl = undefined
		}
		if (this.#ownControls) {
			this.#ownControls.remove()
			this.#ownControls = undefined
		}
		this.#mediaCleanup?.()
		this.#mediaCleanup = undefined
		this.#elapsed = 0
		this.#hasMedia = false
		this.#mediaPlaying = false
		this.#mediaPaused = false
		this.#currentStep = idx

		if (marker?.videoTour) {
			const { lang } = micrio
			const audio = marker.videoTour.i18n?.[lang]?.audio ?? marker.i18n?.[lang]?.audio

			const prevPaused = false
			const media = createElement('micrio-media', {
				parent: this,
				setProps: {
					tour: marker.videoTour,
					src: audio?.src,
					image: micrio.$current,
					controls: true,
					autoplay: !prevPaused,
					// Advancement is the tour's (`#tick`), which holds a step until this media
					// has actually finished — so `onended` is only reported for the tour to see.
					onclose: close,
					onerror: (error: Error) => {
						this.#break(error)
					},
					onblocked: () => {
						this.#mediaPaused = true
					},
					hasAudio: this.#stepInfo.some((s) => s.duration > 0),
					fullscreenEl: micrio,
					getTimeDisplay: () => `${parseTime(this.#calcTime())} / ${parseTime(this.#duration)}`,
				},
			})
			this.#mediaEl = media
			await afterFrame()
			this.#watchStepMedia(media)
		} else {
			// A step without a video tour has no media element to carry the control bar, so
			// the tour builds one; without it such a step has no time bar at all.
			this.#buildOwnControls(micrio)
		}

		this.#injectBars()

		this.#updateBars()

		// A last step that carries no video has nothing to play out, so it ends at once —
		// with a video, the step clock waits out its duration.
		if (!marker?.videoTour && idx === this.#stepInfo.length - 1) {
			this.#nextStep()
		}
	}

	/**
	 * Listens to the current step's media element by event: its playback time moves the
	 * step clock, and its `ended` is what lets the step go once its duration has passed.
	 * Events rather than DOM lookups, because a YouTube/Vimeo/HLS tour has no media tag.
	 */
	#watchStepMedia(media: HTMLElement) {
		// There is media for this step, so the clock holds it for at least its own duration
		this.#hasMedia = true
		const onTime = (e: Event) => {
			const t = e instanceof CustomEvent && typeof e.detail === 'number' ? e.detail : undefined
			if (t === undefined) {
				return
			}
			// Real playback is the step's position, so the readout cannot drift from the audio
			this.#elapsed = t
			this.#mediaPlaying = true
			this.#mediaPaused = false
			const si = this.#stepInfo[this.#currentStep]
			if (si !== undefined) {
				si.currentTime = t
			}
			this.#updateBars()
		}
		const onEnded = () => {
			this.#nextStep()
		}
		// Blocked by the browser: the step is playable by hand, so it waits paused
		const onBlocked = () => {
			this.#mediaPaused = true
			this.#updateBars()
		}
		// A source that cannot play is a real failure: the tour stops and says why
		const onError = (e: Event) => {
			const error = e instanceof CustomEvent && e.detail instanceof Error ? e.detail : new Error('media failure')
			this.#break(error)
		}
		media.addEventListener('timeupdate', onTime)
		media.addEventListener('ended', onEnded)
		media.addEventListener('blocked', onBlocked)
		media.addEventListener('error', onError)
		this.#mediaCleanup = () => {
			media.removeEventListener('timeupdate', onTime)
			media.removeEventListener('ended', onEnded)
			media.removeEventListener('blocked', onBlocked)
			media.removeEventListener('error', onError)
		}
	}

	/** Builds the standalone control bar of a step whose marker carries no video tour. */
	#buildOwnControls(micrio: MicrioElement) {
		const controls = createElement('micrio-media-controls', {
			parent: this,
			setProps: {
				paused: true,
				ended: false,
				duration: this.#stepInfo[this.#currentStep]?.duration ?? 0,
				currentTime: 0,
				hasAudio: true,
				fullscreenEl: micrio,
				getTimeDisplay: () => `${parseTime(this.#calcTime())} / ${parseTime(this.#duration)}`,
			},
		})
		this.#ownControls = controls instanceof MicrioElement ? controls : undefined
	}

	/**
	 * One tick of the step clock.
	 *
	 * - a step with media runs the clock only while that media is actually playing, and is
	 *   released by the media's own `ended` — never by a timeout;
	 * - a step with media that never started (still loading, or autoplay blocked) holds the
	 *   clock at 0, so nothing is skipped over and nothing is cut short;
	 * - a step with no media is timed by its authored duration.
	 */
	#tick() {
		if (!this.isConnected || this.#stepInfo.length === 0) {
			return
		}
		const si = this.#stepInfo[this.#currentStep]
		if (si === undefined) {
			return
		}
		if (this.#hasMedia) {
			if (!this.#mediaPlaying || this.#mediaPaused) {
				// Loading, or blocked: the step waits for the user (or the network), rather
				// than advancing over media that has not been heard
				return
			}
			this.#elapsed = Math.min(this.#elapsed + 0.25, si.duration > 0 ? si.duration : this.#elapsed + 0.25)
			si.currentTime = this.#elapsed
			this.#updateBars()
			return
		}
		this.#elapsed += 0.25
		si.currentTime = this.#elapsed
		this.#updateBars()
		if (si.duration > 0 && this.#elapsed >= si.duration) {
			this.#nextStep()
		}
	}

	/**
	 * Stops the tour and reports why. A step whose media cannot play has to fail visibly and
	 * loudly rather than be skipped over or waited on: the tour is stopped, and the reason is
	 * logged and dispatched as `media-error` on the viewer for the host page.
	 */
	#break(error: Error) {
		if (this.#broken) {
			return
		}
		this.#broken = true
		const si = this.#stepInfo[this.#currentStep]
		const micrio = this._getMicrio()
		const step = `${this.#currentStep + 1}/${this.#stepInfo.length}`
		const reason = `step ${step} (${si?.markerId ?? 'unknown marker'}) could not be played: ${error.message}`
		console.error(`[Micrio] Serial tour stopped: ${reason}`)
		// Reported with the step it happened on, so a host page can react to it
		micrio?.events._dispatch('media-error', { error, reason })
		this.#props.onended?.()
		micrio?.state.tour.set(undefined)
		this.remove()
	}

	#nextStep() {
		const si = this.#stepInfo[this.#currentStep]
		if (si !== undefined) {
			si.ended = true
		}

		if (this.#currentStep < this.#stepInfo.length - 1) {
			void this.#openStep(this.#currentStep + 1)
		} else {
			this.#props.onended?.()
			this._getMicrio()?.state.tour.set(undefined)
			this.remove()
		}
	}

	#getTitle(m: Models.ImageData.Marker | undefined): string | undefined {
		return m?.i18n?.[this._getMicrio()?.lang || 'en']?.title
	}

	/** The control bar of the current step: the media element's, or the tour's own. */
	#controlsAside(): HTMLElement | undefined {
		const mediaAside = this.#mediaEl?.querySelector<HTMLElement>('micrio-media-controls > aside')
		return mediaAside ?? this.#ownControls?.querySelector<HTMLElement>('aside') ?? undefined
	}

	#injectBars() {
		const holder = this.#controlsAside()?.querySelector('div')
		if (!holder) {
			return
		}

		holder.querySelector('[data-part="bars"]')?.remove()

		const barsDiv = createElement('div', { attrs: { 'data-part': 'bars' } })
		for (const [i, si] of this.#stepInfo.entries()) {
			const marker = DataLoader._getStepMarker(si)
			const title = this.#getTitle(marker) ?? ''
			// A real button rather than a focusable `role="progressbar"`: the bar *does* navigate
			// on click, so it has to be activatable by keyboard and carry a name.
			createElement('button', {
				attrs: { 'data-part': 'bar', type: 'button', 'aria-label': title },
				dataset: { idx: String(i) },
				props: { title },
				style: { width: `${(si.duration / (this.#duration || 1)) * 100}%` },
				events: {
					click: () => {
						this.#goto(i)
					},
				},
				parent: barsDiv,
			})
		}
		holder.prepend(barsDiv)
	}

	#goto(i: number) {
		// The setting means "the time bar is a readout, not a scrubber": it has to block a jump to
		// another step too, not just a re-click of the current one (which the guard below already
		// covered, making the setting a no-op).
		if (this.#noTimeScrub) {
			return
		}
		if (i === this.#currentStep) {
			return
		}
		for (const s of this.#stepInfo) {
			s.ended = false
		}
		void this.#openStep(i)
	}

	#calcTime() {
		let total = 0
		for (let i = 0; i < this.#stepInfo.length; i++) {
			const s = this.#stepInfo[i]
			if (i < this.#currentStep || s.ended) {
				total += s.duration
			} else if (i === this.#currentStep) {
				total += s.currentTime ?? 0
				break
			} else {
				break
			}
		}
		return total
	}

	#updateBars() {
		if (!this.#built) {
			return
		}
		const bars = this.#controlsAside()?.querySelectorAll<HTMLElement>('[data-part="bars"] > [data-part="bar"]') ?? []
		for (const [i, bar] of bars.entries()) {
			const si = this.#stepInfo[i]
			const ct = i === this.#currentStep ? (si.currentTime ?? 0) : 0
			let pct = 0
			if (i < this.#currentStep || si.ended) {
				pct = 100
			} else if (i === this.#currentStep) {
				pct = Math.round((ct / (si.duration || 1)) * 10000) / 100
			}
			bar.style.setProperty('--progress', `${pct}%`)
			bar.classList.toggle('active', i === this.#currentStep)
		}

		const chapters = this.querySelectorAll<HTMLElement>('ol.chapters li')
		for (const li of chapters) {
			li.classList.toggle('active', Number(li.dataset.idx) === this.#currentStep)
		}

		// The tour's own control bar has no media element behind it, so it is driven from
		// here; a media element's controls are updated by the media itself.
		const si = this.#stepInfo[this.#currentStep]
		this.#ownControls?._setProps?.({
			currentTime: si?.currentTime ?? 0,
			duration: si?.duration ?? 0,
			paused: true,
			ended: false,
		})
	}

	/** @internal */
	_setProps(props: Partial<SerialTourProps>) {
		if (props.tour !== undefined) {
			this.#props.tour = props.tour
		}
		// `onended` is a props callback, not a DOM event handler
		if (props.onended !== undefined) {
			Object.assign(this.#props, { onended: props.onended })
		}
	}
}

customElements.define(MicrioSerialTour.tag, MicrioSerialTour)
