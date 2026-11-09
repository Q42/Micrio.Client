import { createElement } from '$utils/dom'
import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import type { HTMLMicrioElement } from '$core/element'
import { get } from '$core/store'
import { i18n } from '$core/i18n/strings'
import { DataLoader } from '$utils/dataLoader'
import '$ui/button'
import '$media/media'

/** Properties for the tour component. @internal */
export interface TourProps {
	tour: Models.ImageData.MarkerTour | Models.ImageData.VideoTour
	noHTML?: boolean
	onminimize?: (b: boolean) => void
}
import './tour.css'

/** Web component that displays marker-based or video tours with navigation controls. @internal */
export class MicrioTour extends MicrioElement<TourProps> {
	/** The custom element tag name. @internal */
	static tag = 'micrio-tour'

	#props: Partial<TourProps> = {}
	#currentStep = 0
	/** The viewer, captured at mount: `_getMicrio()` is unavailable once the layout removes this element. */
	#micrio: HTMLMicrioElement | undefined
	/** The aside element containing step navigation controls. */
	aside: HTMLElement | undefined

	/** Reports the active tour stopped, once, and revokes the callbacks it left on the tour data. */
	#stopTour(): void {
		if (this.#stopped) {
			return
		}
		this.#stopped = true
		const { tour } = this.#props
		if (!tour) {
			return
		}
		this.#micrio?.events._dispatch('tour-stop', tour)
		if ('steps' in tour) {
			tour.next = undefined
			tour.prev = undefined
		}
	}

	/** @internal */
	_onMount() {
		const { tour } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !tour) {
			return
		}

		this.#micrio = micrio
		const isVideoTour = !('steps' in tour)
		const isMarkerTour = 'steps' in tour

		// Locates an image by id across the opened canvases and any active
		// album gallery (whose child images live outside `_canvases`).
		const findImage = (id?: string): MicrioImage | undefined =>
			id
				? (micrio._canvases.find((c: MicrioImage) => c.id === id) ?? micrio.gallery?._images.find((i) => i.id === id))
				: undefined

		if (isVideoTour) {
			const vt = tour
			const image = micrio.$current
			if (image) {
				// `cannotClose` also applies to the media's own close control and the
				// auto-close when playback ends, since that media *is* the tour UI.
				const close = vt.cannotClose
					? undefined
					: () => {
							micrio.state.tour.set(undefined)
						}
				const audio = vt.i18n?.[get(micrio._lang)]?.audio
				createElement('micrio-media', {
					parent: this,
					setProps: {
						src: audio?.src,
						image,
						tour: vt,
						controls: true,
						hasAudio: Boolean(audio?.src),
						autoplay: true,
						fullscreenEl: micrio,
						onended: close,
						onclose: close,
					},
				})
			}
		}

		if (isMarkerTour) {
			micrio.dataset.markerTourActive = ''
			this._addCleanup(() => {
				delete micrio.dataset.markerTourActive
			})

			const mt = tour
			mt.currentStep ??= mt.initialStep ?? 0
			this.#currentStep = mt.currentStep
			const { stepInfo } = mt
			// Resolved from the image the tour is *authored* on, like `micrio-marker-popup` does:
			// a tour that crosses images would otherwise read it from whichever image is shown,
			// and the two components would disagree about whether the controls move into the popup.
			const authored = micrio._canvases.find((c) => c.$data?.markerTours?.find((t) => t.id === mt.id))
			const tourControlsInPopup = Boolean((authored ?? micrio.$current)?.$settings?._markers?.tourControlsInPopup)
			const keepPopupsDuringTour = Boolean(
				(authored ?? micrio.$current)?.$settings?._markers?.keepPopupsDuringTourTransitions,
			)

			const openStep = async (prevIdx: number, newIdx: number) => {
				const si = stepInfo?.[newIdx]
				if (!si) {
					return
				}

				// Clear previous step's marker before navigating
				const prevSi = stepInfo?.[prevIdx]
				if (prevSi?.micrioId) {
					const prevImg = findImage(prevSi.micrioId)
					const prevMarker = prevImg ? get(prevImg.state.marker) : undefined
					if (prevImg && prevMarker !== undefined && prevMarker !== '') {
						prevImg.state.marker.set(undefined)
					}
				}

				// A step's marker can follow a `micrioLink` and hand its popup to the linked
				// image (`marker.ts` keeps it there for the return trip). The tour owns the
				// content of its steps, so a step change has to dismiss it before the camera
				// moves — otherwise the previous marker stays on screen until the next one.
				// Images asking to keep popups across steps opt out, as they do for the
				// marker's own close on a step change.
				if (prevIdx >= 0 && !keepPopupsDuringTour) {
					micrio.state.popup.set(undefined)
					micrio.state.popover.set(undefined)
				}

				// If the new step has a video tour, use its first timeline viewport as the start view
				let startView: Models.Camera.View | undefined
				const marker = DataLoader._getStepMarker(si)
				if (marker?.videoTour) {
					const { lang } = micrio
					const vt = marker.videoTour
					const timeline = vt.i18n?.[lang]?.timeline
					if (timeline?.length && timeline[0].start <= 1) {
						startView = timeline[0].rect
					}
				}

				const img =
					si.micrioId && micrio.$current?.id !== si.micrioId
						? await micrio.open(si.micrioId, { startView })
						: micrio.$current
				// Don't re-set (and thereby close/re-open) a marker that is already the active one
				const active = img && get(img.state.marker)
				const activeId = typeof active === 'string' ? active : active?.id
				if (img && activeId !== si.markerId) {
					img.state.marker.set(si.markerId)
				}
			}

			mt.next = () => {
				if (this.#currentStep < mt.steps.length - 1) {
					const prev = this.#currentStep
					this.#currentStep++
					mt.currentStep = this.#currentStep
					void openStep(prev, this.#currentStep)
					renderControls()
				}
			}

			mt.prev = () => {
				if (this.#currentStep > 0) {
					const prev = this.#currentStep
					this.#currentStep--
					mt.currentStep = this.#currentStep
					void openStep(prev, this.#currentStep)
					renderControls()
				}
			}

			if (!this.aside) {
				this.aside = createElement('aside', {
					className: 'marker-tour',
					parent: tourControlsInPopup ? undefined : this,
				})
			}

			const renderControls = () => {
				if (!this.aside) {
					return
				}
				this.aside.replaceChildren()

				createElement('micrio-button', {
					parent: this.aside,
					setProps: {
						type: 'prev',
						title: get(i18n)._tourStepPrev,
						disabled: this.#currentStep === 0,
						onclick: () => mt.prev?.(),
					},
				})

				createElement('span', {
					textContent: `${this.#currentStep + 1} / ${mt.steps.length}`,
					parent: this.aside,
				})

				createElement('micrio-button', {
					parent: this.aside,
					setProps: {
						type: 'next',
						title: get(i18n)._tourStepNext,
						disabled: this.#currentStep >= mt.steps.length - 1,
						onclick: () => mt.next?.(),
					},
				})

				createElement('micrio-fullscreen', {
					parent: this.aside,
					setProps: { el: micrio },
				})

				if (!mt.cannotClose) {
					const close = createElement('micrio-button', {
						parent: this.aside,
						setProps: {
							type: 'close',
							title: get(i18n)._close,
							onclick: () => {
								micrio.state.tour.set(undefined)
							},
						},
					})
					// Buttons in marker-popup -- put close button first
					if (tourControlsInPopup) {
						this.aside.insertBefore(close, this.aside.firstChild)
					}
				}
			}

			this._addCleanup(
				micrio.state.marker.subscribe((m) => {
					if (!m) {
						return
					}
					const id = typeof m === 'string' ? m : m.id
					const idx = mt.steps.findIndex((s) => s.startsWith(id))
					if (idx >= 0 && idx !== this.#currentStep) {
						this.#currentStep = idx
						mt.currentStep = idx
						renderControls()
					}
				}),
			)

			void openStep(-1, this.#currentStep)
			renderControls()

			// Control titles are translated, so rebuild them on a UI language change
			this._watchLater(micrio._lang, () => {
				renderControls()
			})
		}

		this._addCleanup(
			micrio.state.tour.subscribe((t) => {
				if (t) {
					return
				}
				// The end is reported here rather than from `_onDestroy`: `_getMicrio()` walks the
				// parent chain, which the layout has already removed by then, so `#stopTour`
				// uses the viewer captured at mount.
				this.#stopTour()
				if (isMarkerTour) {
					const mt = tour
					const si = mt.stepInfo?.[this.#currentStep]
					if (si) {
						const img = findImage(si.micrioId)
						if (img) {
							img.state.marker.set(undefined)
						}
					}
					// A stopped tour forgets its step, so starting it again — from the toolbar,
					// for instance — begins at its first step instead of resuming the old one.
					mt.currentStep = undefined
				}
			}),
		)

		// Replacing tour A with tour B removes A's element without ever clearing the store;
		// the cleanup is the only stop signal A gets.
		this._addCleanup(() => {
			this.#stopTour()
		})

		// The tour is up and running: the element only exists while a tour is active.
		micrio.events._dispatch('tour-start', tour)
	}

	/** True once `tour-stop` has been reported for this element, so it fires exactly once. */
	#stopped = false

	/** @internal */
	_setProps(props: Partial<TourProps>) {
		Object.assign(this.#props, props)
	}
}

customElements.define(MicrioTour.tag, MicrioTour)
