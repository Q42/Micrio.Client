import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import { get } from '$core/store'
import { Frame } from '$core/frame'
import { i18n } from '$core/i18n/strings'
import { afterFrame, createElement } from '$utils/dom'
import '$ui/button'
import '$ui/button-group'
import './marker-content'

/** Props for the marker popup overlay element. @internal */
export interface MarkerPopupProps {
	/** The marker data to display in the popup. */
	marker: Models.ImageData.Marker
}
import './marker-popup.css'

/** Custom element rendering a marker's popup overlay with close, minimize, and tour navigation controls. */
class MicrioMarkerPopup extends MicrioElement<MarkerPopupProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-marker-popup'

	#props: Partial<MarkerPopupProps> = {}
	#content!: HTMLElement
	#title!: HTMLElement
	#isMinimized = false
	#destroying = false
	#clickedPrevNext = false
	#placedTourControls = false
	#originalHeights = new WeakMap<HTMLElement, number>()

	/** @internal */
	_onMount() {
		const { marker } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !marker) {
			return
		}

		for (const c of marker.tags ?? []) {
			this.classList.add(c)
		}
		void afterFrame().then(() => {
			const btn = this.querySelector('micrio-button:last-child > button')
			if (btn instanceof HTMLElement) {
				btn.focus()
			}
		})

		this._addCleanup(
			micrio.state.popup.subscribe((m) => {
				this.#destroying = !m || m !== marker
				this.classList.toggle('destroying', this.#destroying)
			}),
		)

		this.addEventListener('transitionend', (e) => {
			if (e.target === this && this.#destroying) {
				this.remove()
			}
		})

		// The tour controls are rendered from the tour state, and the tour may be
		// started *after* this popup, so re-render whenever the state they depend on
		// changes — a one-shot placement would leave the popup without controls.
		this._watch(micrio.state.tour, () => {
			if (!this.#destroying && !this.#showTourControls !== !this.#placedTourControls) {
				this.#render()
			}
		})

		// Button titles and content are translated, so re-render on a UI language change
		this._watchLater(micrio._lang, () => {
			if (!this.#destroying) {
				this.#render()
			}
		})

		this.#render()
	}

	/** @internal */
	_setProps(props: Partial<MarkerPopupProps>) {
		if (props.marker !== undefined && props.marker.id !== this.#props.marker?.id) {
			this.#props.marker = props.marker
			if (this.isConnected) {
				this.#render()
			}
		}
	}

	/**
	 * Whether the marker popup shows the tour's prev/counter/next controls instead
	 * of its own close/minimize aside: a non-serial marker tour with the
	 * `_markers.tourControlsInPopup` setting on, on a non-mobile canvas.
	 */
	get #showTourControls(): boolean {
		const micrio = this._getMicrio()
		const image = this.#getImage()
		if (!micrio || !image) {
			return false
		}
		const $tour = get(micrio.state.tour)
		const markerTour = $tour && 'steps' in $tour ? $tour : undefined
		if (!markerTour) {
			return false
		}
		const tourSourceImage = micrio._canvases.find((c) => c.$data?.markerTours?.find((t) => t.id === markerTour.id))
		const settings = image.$settings._markers ?? {}
		const tsSettings = tourSourceImage?.$settings._markers
		const tourControlsInPopup = tsSettings?.tourControlsInPopup ?? settings.tourControlsInPopup
		const isPartOfTour =
			(markerTour.steps?.findIndex((s: string) => s.startsWith(this.#props.marker?.id ?? '')) ?? -1) >= 0

		return !micrio.canvas.$isMobile && isPartOfTour && !markerTour.isSerialTour && tourControlsInPopup === true
	}

	/** The `<micrio-marker>` element this popup was opened for. */
	#getImage(): MicrioImage | undefined {
		const { marker } = this.#props
		return marker?.id ? MicrioElement._markerImages.get(marker.id) : undefined
	}

	#render() {
		const { marker } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !marker) {
			return
		}

		const image = this.#getImage()
		if (!image) {
			return
		}

		const $tour = get(micrio.state.tour)
		const $current = get(micrio.current)
		const $i18n = get(i18n)
		const settings = image.$settings._markers ?? {}
		const data = marker.data || {}
		const canMinimize = settings.canMinimizePopup

		const markerTour = $tour && 'steps' in $tour ? $tour : undefined
		const isPartOfTour = markerTour && markerTour.steps?.findIndex((s: string) => s.startsWith(marker.id)) >= 0
		const showTourControls = this.#showTourControls
		this.#placedTourControls = showTourControls
		const closeButtonStopsTour =
			showTourControls || (markerTour ? markerTour.currentStep === markerTour.steps.length - 1 : undefined)

		const close = (e?: Event) => {
			if ($tour && isPartOfTour && 'steps' in $tour) {
				if (e instanceof Event && closeButtonStopsTour) {
					micrio.state.tour.set(undefined)
				} else {
					$tour.next?.()
				}
			} else if ($current && $current.id !== image.id && data.micrioLink?.id === $current.id) {
				void micrio.open(image.id)
				image.state.marker.set(undefined)
				micrio.state.popup.set(undefined)
			} else {
				image.state.marker.set(undefined)
			}
		}

		const toggleMinimize = () => {
			this.#isMinimized = !this.#isMinimized
			this.classList.toggle('minimized', this.#isMinimized)
			if (this.#content !== undefined) {
				for (const child of this.#content.children) {
					if (child instanceof HTMLElement && child !== this.#title) {
						const n = child
						if (!this.#originalHeights.has(n)) {
							this.#originalHeights.set(n, n.offsetHeight)
							n.style.height = `${n.offsetHeight}px`
						}
						const height = this.#originalHeights.get(n)
						if (height === undefined) {
							continue
						}
						setTimeout(() => {
							n.style.height = this.#isMinimized ? '0px' : `${height}px`
						}, 100)
					}
				}
			}
		}

		this.replaceChildren()

		if (!showTourControls) {
			const aside = createElement('aside')

			if (!data.alwaysOpen) {
				createElement('micrio-button', {
					setProps: {
						type: !isPartOfTour || closeButtonStopsTour ? 'close' : 'next',
						title: !isPartOfTour || closeButtonStopsTour ? $i18n._closeMarker : $i18n._tourStepNext,
						disabled: this.#clickedPrevNext,
						onclick: close,
					},
					parent: aside,
				})
			}

			if (canMinimize) {
				createElement('micrio-button', {
					setProps: {
						type: this.#isMinimized ? 'up' : 'down',
						title: $i18n._minimize,
						onclick: toggleMinimize,
					},
					parent: aside,
				})
			}

			this.append(aside)
		}

		this.#content = createElement('micrio-marker-content', {
			setProps: { marker, onclose: close },
			parent: this,
		})

		if (showTourControls) {
			// The aside lives in `<micrio-tour>`, which the layout may mount in a later
			// frame than this popup, so keep asking for it until it exists.
			Frame.request(() => {
				this.#placeTourAside()
			})
		}
	}

	/** Moves the tour element's control aside into this popup, once it exists. */
	#placeTourAside(): void {
		const tourEl = document.querySelector('micrio-tour')
		const tourAside = tourEl instanceof MicrioElement && 'aside' in tourEl ? tourEl.aside : undefined
		if (!(tourAside instanceof HTMLElement)) {
			Frame.request(() => {
				this.#placeTourAside()
			})
			return
		}
		if (!this.contains(tourAside)) {
			this.append(tourAside)
		}
	}
}

customElements.define(MicrioMarkerPopup.tag, MicrioMarkerPopup)
