import { MicrioElement } from '$core/component'
import type { HTMLMicrioElement } from '$core/element'
import type { Models } from '$types/models'
import { DataLoader } from '$utils/dataLoader'
import { parseTime } from '$utils/time'
import { afterFrame, createElement } from '$utils/dom'
import { createMachine, type Machine } from '$core/machine'
import {
	reduceSerial,
	serialInitial,
	type SerialContext,
	type SerialEvent,
	type SerialState,
} from './serial-tour-state'
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
	#built = false
	#mediaEl: HTMLElement | undefined = undefined
	/** Control bar built for a step whose marker carries no video tour, so there is no media element to hold one. */
	#ownControls: MicrioElement | undefined = undefined
	/** Detaches the current step's media listeners. */
	#mediaCleanup: (() => void) | undefined = undefined
	/** The tour may not be closed, by its own control or when its last step finishes. */
	#cannotClose = false
	/** The viewer, captured at mount: `_getMicrio()` walks the parent chain, which the layout
	 *  has already removed by the time the teardown cleanup runs. */
	#micrio: HTMLMicrioElement | undefined
	#machine: Machine<SerialState, SerialEvent> | undefined
	#duration = 0
	#noTimeScrub = false

	/** The committed step, owned by the machine. */
	get #currentStep(): number {
		return this.#machine?.$state.step ?? 0
	}

	/** Reports the tour's end once per story, whether it closes or a `cannotClose` tour stays open. @internal */
	#reportEnded() {
		const { tour } = this.#props
		if (tour) {
			this.#micrio?.events._dispatch('tour-ended', tour)
		}
	}

	/** Restarts a finished tour from its first step. @internal */
	#replay() {
		for (const si of this.#stepInfo) {
			si.ended = false
			si.currentTime = 0
		}
		this.#machine?.send({ type: 'replay' })
	}

	/** @internal */
	_onMount() {
		const { tour } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !tour) {
			return
		}

		this.#micrio = micrio
		this.#stepInfo = tour.stepInfo || []
		this.#cannotClose = Boolean(tour.cannotClose)
		this.#duration = this.#stepInfo.reduce((c, s) => c + (s.duration || 0), 0)
		this.#noTimeScrub = Boolean(micrio.$current?.$settings?.ui?.controls?.serialTourNoTimeScrub)

		micrio.dataset.markerTourActive = ''
		this._addCleanup(() => {
			delete micrio.dataset.markerTourActive
		})

		this.#machine = createMachine<SerialState, SerialEvent, SerialContext>({
			initial: serialInitial,
			context: {
				durations: this.#stepInfo.map((s) => s.duration || 0),
				cannotClose: this.#cannotClose,
			},
			reduce: reduceSerial,
			enter: {
				opening: ({ state, signal }) => {
					void this.#loadStep(state.step, state.runId, signal)
				},
				finished: () => {
					this.#markCompletedStep()
					this.#reportEnded()
					this.#updateBars()
				},
				closed: () => {
					this.#markCompletedStep()
					this.#reportEnded()
					this.#props.onended?.()
					// The layout owns removal; clearing the store lets this step's bars paint
					// (including the last bar at 100%) before the element goes away.
					micrio.state.tour.set(undefined)
				},
				broken: ({ state }) => {
					this.#reportBroken(state)
				},
			},
			effect: ({ state, previous }) => {
				this.#onSerialTransition(state, previous)
			},
		})
		this._watch(this.#machine, () => {
			this.#updateBars()
		})
		this._addCleanup(() => {
			const phase = this.#machine?.$state.phase
			// A finished/closed entry already reported; every other removal is a stop.
			if (phase !== 'finished' && phase !== 'closed') {
				this.#reportEnded()
			}
			this.#machine?.dispose()
			this.#machine = undefined
		})

		const mt = tour
		mt.next = () => {
			this.#nextStep()
		}
		mt.prev = () => {
			if (this.#currentStep > 0) {
				this.#resetSteps()
				this.#openStep(this.#currentStep - 1)
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
					this.#resetSteps()
					this.#openStep(idx)
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

		this.#openStep(0)
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

	#openStep(idx: number) {
		this.#machine?.send({ type: 'open', step: idx })
	}

	/** Clears the bar state when the tour jumps to a different run of steps. */
	#resetSteps() {
		for (const s of this.#stepInfo) {
			s.ended = false
			s.currentTime = 0
		}
	}

	/** Removes the previous step's media and control frame. */
	#teardownStep() {
		this.#mediaEl?.remove()
		this.#mediaEl = undefined
		this.#ownControls?.remove()
		this.#ownControls = undefined
		this.#mediaCleanup?.()
		this.#mediaCleanup = undefined
	}

	/**
	 * Loads one machine-owned step. The phase signal is the run token: every await checks
	 * it before committing DOM or media, so a superseded open cannot land on the new step.
	 */
	async #loadStep(idx: number, runId: number, signal: AbortSignal) {
		const micrio = this.#micrio
		const si = this.#stepInfo[idx]
		if (!micrio || si === undefined || signal.aborted) {
			return
		}

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
			if (signal.aborted || !this.isConnected || this.#machine?.$state.runId !== runId) {
				return
			}
		}

		// The image is up: the previous step's media can go.
		this.#teardownStep()
		si.ended = false
		si.currentTime = 0

		const stepTour = marker?.videoTour ?? this.#props.tour
		if (stepTour) {
			this._getMicrio()?.events._dispatch('tour-step', stepTour)
		}

		if (marker?.videoTour) {
			const { lang } = micrio
			const audio = marker.videoTour.i18n?.[lang]?.audio ?? marker.i18n?.[lang]?.audio
			const media = createElement('micrio-media', {
				parent: this,
				setProps: {
					tour: marker.videoTour,
					src: audio?.src,
					image: micrio.$current,
					controls: true,
					autoplay: true,
					onclose: this.#cannotClose
						? undefined
						: () => {
								this.#close()
							},
					onerror: (error: Error) => {
						this.#break(error)
					},
					onblocked: () => {
						this.#machine?.send({ type: 'blocked' })
					},
					hasAudio: this.#stepInfo.some((s) => s.duration > 0),
					fullscreenEl: micrio,
					getTimeDisplay: () => this.#timeDisplay(),
				},
			})
			this.#mediaEl = media
			await afterFrame()
			if (signal.aborted || !this.isConnected || this.#machine?.$state.runId !== runId) {
				media.remove()
				if (this.#mediaEl === media) {
					this.#mediaEl = undefined
				}
				return
			}
			this.#watchStepMedia(media, runId)
			this.#machine?.send({ type: 'media', runId, hasMedia: true })
		} else {
			this.#buildOwnControls(micrio)
			this.#machine?.send({ type: 'media', runId, hasMedia: false })
		}

		this.#injectBars()
		this.#machine?.send({ type: 'opened', runId, hasMedia: Boolean(marker?.videoTour) })
	}

	/** Sends the single close signal; `enter.closed` owns the teardown. */
	#close() {
		this.#machine?.send({ type: 'close' })
	}

	/**
	 * Listens to the current step's media element by event: its playback time moves the
	 * step clock, and its `ended` is what lets the step go once its duration has passed.
	 * Events rather than DOM lookups, because a YouTube/Vimeo/HLS tour has no media tag.
	 */
	#watchStepMedia(media: HTMLElement, runId: number) {
		const current = (): boolean => this.#machine?.$state.runId === runId
		const onTime = (e: Event) => {
			const t = e instanceof CustomEvent && typeof e.detail === 'number' ? e.detail : undefined
			if (t === undefined || !current()) {
				return
			}
			// Real playback is the step's position and also starts its transport.
			this.#machine?.send({ type: 'play' })
			this.#machine?.send({ type: 'time', elapsed: t })
		}
		const onEnded = () => {
			if (current()) {
				this.#machine?.send({ type: 'ended' })
			}
		}
		// After a `cannotClose` tour finishes, the next play starts it over from step 1
		const onPlay = () => {
			if (!current()) {
				return
			}
			if (this.#machine?.$state.phase === 'finished') {
				this.#replay()
			} else {
				this.#machine?.send({ type: 'play' })
			}
		}
		const onPause = () => {
			if (current()) {
				this.#machine?.send({ type: 'pause' })
			}
		}
		const onBlocked = () => {
			if (current()) {
				this.#machine?.send({ type: 'blocked' })
			}
		}
		const onError = (e: Event) => {
			const error = e instanceof CustomEvent && e.detail instanceof Error ? e.detail : new Error('media failure')
			this.#break(error)
		}
		media.addEventListener('timeupdate', onTime)
		media.addEventListener('ended', onEnded)
		media.addEventListener('play', onPlay)
		media.addEventListener('pause', onPause)
		media.addEventListener('blocked', onBlocked)
		media.addEventListener('error', onError)
		this.#mediaCleanup = () => {
			media.removeEventListener('timeupdate', onTime)
			media.removeEventListener('ended', onEnded)
			media.removeEventListener('play', onPlay)
			media.removeEventListener('pause', onPause)
			media.removeEventListener('blocked', onBlocked)
			media.removeEventListener('error', onError)
		}
	}

	/** Builds the standalone control bar of a step whose marker carries no video tour. */
	#buildOwnControls(micrio: MicrioElement) {
		// Keep the media frame the tour's CSS positions, even though this step has no video:
		// otherwise the ended tour's controls move out of the player frame.
		const media = createElement('micrio-media', {
			parent: this,
			setProps: {
				controlsOnly: true,
				hasAudio: true,
				fullscreenEl: micrio,
				getTimeDisplay: () => this.#timeDisplay(),
				onplaypause: () => {
					if (this.#machine?.$state.phase === 'finished') {
						this.#replay()
					} else {
						this.#machine?.send({ type: this.#machine.$state.transport === 'playing' ? 'pause' : 'play' })
					}
				},
			},
		})
		this.#mediaEl = media
		const controls = media.querySelector('micrio-media-controls')
		this.#ownControls = controls instanceof MicrioElement ? controls : undefined
	}

	/**
	 * One tick of the step clock.
	 *
	 * - a step with media is timed by that media's own `timeupdate`, never by this clock:
	 *   its bar and readout always show the real playback position, so a paused step
	 *   (which stops reporting time) cannot keep moving;
	 * - a step with no media is timed by its authored duration.
	 */
	#tick() {
		if (!this.isConnected) {
			return
		}
		this.#machine?.send({ type: 'tick' })
	}

	/** Marks the final step complete so its bar reads 100% before the run finishes. */
	#markCompletedStep() {
		const si = this.#stepInfo[this.#currentStep]
		if (si !== undefined) {
			si.ended = true
			si.currentTime = si.duration
		}
	}

	/** Applies a serial transition: bar state, step bookkeeping and the public transport pair. */
	#onSerialTransition(state: SerialState, previous: SerialState): void {
		const wasPlaying = previous.transport === 'playing'
		const isPlaying = state.transport === 'playing'
		if (wasPlaying !== isPlaying) {
			const { tour } = this.#props
			if (tour) {
				this.#micrio?.events._dispatch(isPlaying ? 'serialtour-play' : 'serialtour-pause', tour)
			}
		}
		if (previous.step !== state.step) {
			const previousStep = this.#stepInfo[previous.step]
			if (previousStep !== undefined) {
				previousStep.ended = true
			}
		}
		const si = this.#stepInfo[state.step]
		if (si !== undefined) {
			si.currentTime = state.elapsed
		}
		this.#updateBars()
	}

	/**
	 * Stops the tour and reports why. A step whose media cannot play has to fail visibly and
	 * loudly rather than be skipped over or waited on.
	 */
	#break(error: Error) {
		this.#machine?.send({ type: 'error', error: error.message })
	}

	/** One report for the broken phase, with the step that failed. */
	#reportBroken(state: SerialState): void {
		const si = this.#stepInfo[state.step]
		const micrio = this._getMicrio()
		const step = `${state.step + 1}/${this.#stepInfo.length}`
		const reason = `step ${step} (${si?.markerId ?? 'unknown marker'}) could not be played: ${state.error ?? 'unknown error'}`
		console.error(`[Micrio] Serial tour stopped: ${reason}`)
		micrio?.events._dispatch('media-error', { error: new Error(reason), reason })
		this.#props.onended?.()
		micrio?.state.tour.set(undefined)
	}

	#nextStep() {
		const si = this.#stepInfo[this.#currentStep]
		if (si !== undefined) {
			si.ended = true
		}
		this.#machine?.send({ type: 'next' })
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
		this.#resetSteps()
		this.#openStep(i)
	}

	/** The control bar readout: the tour's remaining time, printed as `-0:50`. */
	#timeDisplay(): string {
		return `-${parseTime(Math.max(0, this.#duration - this.#calcTime()))}`
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
		if (!this.#built || this.#machine?.$state.phase === 'opening') {
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

		// The tour's cumulative current time, for CSS (`--time: '1:45'`). Written to the
		// step media too: its own controls live under it, and they must inherit the tour's
		// timeline, not just this segment's.
		const time = `'${parseTime(this.#calcTime())}'`
		this.style.setProperty('--time', time)
		this.#mediaEl?.style.setProperty('--time', time)

		// The tour's own control bar has no media element behind it, so it is driven from
		// here; a media element's controls are updated by the media itself.
		const si = this.#stepInfo[this.#currentStep]
		this.#ownControls?._setProps?.({
			currentTime: si?.currentTime ?? 0,
			duration: si?.duration ?? 0,
			paused: this.#machine?.$state.transport !== 'playing',
			ended: this.#machine?.$state.phase === 'finished',
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
