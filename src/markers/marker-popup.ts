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
	/** The image the marker belongs to, so the popup does not need a global marker-id lookup. */
	image?: MicrioImage
}
import './marker-popup.css'

/** Custom element rendering a marker's popup overlay with close, minimize, and tour navigation controls. */
class MicrioMarkerPopup extends MicrioElement<MarkerPopupProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-marker-popup'

	#props: Partial<MarkerPopupProps> = {}
	#content!: HTMLElement
	#isMinimized = false
	#destroying = false
	/** True once a tour step has been requested from this popup. */
	#stepping = false
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
		const markerChanged = props.marker !== undefined && props.marker.id !== this.#props.marker?.id
		// `image` has to be merged too, not just `marker`: this override replaces the base
		// implementation, so anything it does not assign is dropped.
		Object.assign(this.#props, props)
		if (markerChanged && this.isConnected) {
			this.#render()
		}
	}

	/**
	 * Resolves one `_markers` setting for the running marker tour, preferring the image the
	 * tour is authored on over the image this popup belongs to.
	 */
	#tourMarkerSetting<K extends keyof Models.ImageInfo.MarkerSettings>(
		key: K,
	): Models.ImageInfo.MarkerSettings[K] | undefined {
		const micrio = this._getMicrio()
		const image = this.#getImage()
		if (!micrio || !image) {
			return undefined
		}
		const $tour = get(micrio.state.tour)
		const markerTour = $tour && 'steps' in $tour ? $tour : undefined
		const source = markerTour
			? micrio._canvases.find((c) => c.$data?.markerTours?.find((t) => t.id === markerTour.id))
			: undefined
		const tsSettings = source?.$settings._markers
		const settings = image.$settings._markers ?? {}
		return tsSettings?.[key] ?? settings[key]
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
		const isPartOfTour =
			(markerTour.steps?.findIndex((s: string) => s.startsWith(this.#props.marker?.id ?? '')) ?? -1) >= 0

		return (
			!micrio.canvas.$isMobile &&
			isPartOfTour &&
			!markerTour.isSerialTour &&
			this.#tourMarkerSetting('tourControlsInPopup') === true
		)
	}

	/** The image this popup's marker belongs to. */
	#getImage(): MicrioImage | undefined {
		const { image, marker } = this.#props
		// The prop the layout passes is authoritative; the global map stays the fallback for a
		// popup mounted without it (and for marker ids shared between images).
		if (image) {
			return image
		}
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
		// The counter is only for the popup's own aside; the tour's aside has one already
		const showCounter =
			!showTourControls &&
			Boolean(markerTour && isPartOfTour) &&
			this.#tourMarkerSetting('tourStepCounterInPopup') === true

		const close = (e?: Event) => {
			// The layout only swaps this popup out for the next step on the following
			// tick, so a second click on the same button must not advance again.
			if (this.#stepping) {
				return
			}
			if ($tour && isPartOfTour && 'steps' in $tour) {
				if (e instanceof Event && closeButtonStopsTour) {
					micrio.state.tour.set(undefined)
				} else {
					this.#stepping = true
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
			// This button is what collapses a running tour's UI, which is the condition
			// `tour-minimize` documents.
			if (get(micrio.state.tour)) {
				micrio.events._dispatch('tour-minimize', this.#isMinimized)
			}
			if (this.#content !== undefined) {
				for (const child of this.#content.children) {
					if (child instanceof HTMLElement) {
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

			// The tour's own aside (tourControlsInPopup mode) already carries a counter
			if (showCounter && markerTour) {
				createElement('span', {
					className: 'tour-counter',
					textContent: `${(markerTour.currentStep ?? 0) + 1}/${markerTour.steps.length}`,
					parent: aside,
				})
			}

			this.append(aside)
		}

		this.#content = createElement('micrio-marker-content', {
			setProps: { marker, image: this.#props.image, onclose: close },
			parent: this,
		})

		if (showTourControls) {
			// The aside lives in `<micrio-tour>`, which the layout may mount in a later
			// frame than this popup, so keep asking for it until it exists.
			if (!this.#placingAside) {
				this.#placingAside = true
				Frame.request(this.#placeTourAside)
			}
		}
	}

	/** Set while a `#placeTourAside` retry chain is pending, so only one can be queued. */
	#placingAside = false

	/**
	 * Moves the tour element's control aside into this popup, once it exists.
	 *
	 * The retry is bounded by this popup's own life: without the guard the chain re-queued
	 * itself every frame for the rest of the session whenever the aside never appeared (a tour
	 * that ends, a cross-image tour, or a `<micrio-tour>` the layout has removed).
	 * @internal
	 */
	#placeTourAside = (): void => {
		if (!this.isConnected) {
			this.#placingAside = false
			return
		}
		// Scoped to this viewer: a global lookup could hand another viewer's aside to this popup.
		const tourEl = this._getMicrio()?.querySelector('micrio-tour')
		const tourAside = tourEl instanceof MicrioElement && 'aside' in tourEl ? tourEl.aside : undefined
		if (!(tourAside instanceof HTMLElement)) {
			Frame.request(this.#placeTourAside)
			return
		}
		this.#placingAside = false
		if (!this.contains(tourAside)) {
			this.append(tourAside)
		}
	}

	/** @internal */
	_onDestroy() {
		if (this.#placingAside) {
			Frame.cancel(this.#placeTourAside)
			this.#placingAside = false
		}
	}
}

customElements.define(MicrioMarkerPopup.tag, MicrioMarkerPopup)
