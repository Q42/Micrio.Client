import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import type { Writable } from '$core/store'
import type { MicrioImage } from '$core/image'
import { get, tick, writable } from '$core/store'
import { Frame } from '$core/frame'
import { DataLoader } from '$utils/dataLoader'
import { createElement } from '$utils/dom'
import { volumeFor } from '$utils/media-settings'
import '$ui/icon'
import '$core/element-ui'
import '$ui/button'
import '$ui/button-group'
import '$ui/progress-circle'
import '$layout/logo'
import '$layout/article'
import '$media/subtitles'
import '$layout/details'
import './error'
import '$layout/nav/controls'
import '$media/fullscreen'
import '$layout/nav/zoom-buttons'
import '$layout/logo-org'
import '$markers/waypoint'
import '$markers/marker-content'
import '$layout/menu'
import '$layout/toolbar'
import { MicrioAudioController } from '$audio/audio-controller'
import '$media/media'
import '$media/media-controls'
import '$markers/marker-popup'
import '$markers/marker'
import '$markers/markers'
import '$ui/dial'
import '$layout/nav/minimap'
import '$embed/embed'
import '$embed/image-embeds'
import '$tour/tour'
import '$layout/popover'
import '$gallery/gallery'
import '$tour/serial-tour'

/** Find a menu page by its ID within a nested menu structure */
function findPage(id: string, p: Models.ImageData.Menu[] | undefined): Models.ImageData.Menu | undefined {
	if (p) {
		for (let i = 0, t; i < p.length; i++) {
			if (p[i].id === id || (t = findPage(id, p[i].children))) {
				return t ?? p[i]
			}
		}
	}
	return undefined
}

/** Props for the main layout element @internal */
export interface MainProps {
	/** Whether to disable HTML content rendering */
	noHTML?: boolean
	/** Whether to hide the Micrio logo */
	noLogo?: boolean
	/** Current loading progress (0–1), hides when >= 1 */
	loadingProgress?: number
	/** An error message to display, or undefined to hide */
	error?: string | undefined
}
import './main.css'

/** Main layout custom element that orchestrates all UI layers (logo, controls, markers, popups, etc.) @internal */
export class MicrioMain extends MicrioElement<MainProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-main'

	#props: MainProps = {}
	#info: Models.ImageInfo.ImageInfo | undefined
	#settings: Writable<Models.ImageInfo.Settings> | undefined
	#settingsUnsub: (() => void) | undefined
	#firstInited = false
	#logoOrg: Models.ImageInfo.Organisation | undefined
	#activePopupMarkerId: string | undefined
	#markerElements = new Map<string, HTMLElement>()
	#embedElements = new Map<string, HTMLElement>()
	#audioController: MicrioAudioController | undefined
	#destroyAudio(): void {
		this.#audioController?.destroy()
		this.#audioController = undefined
	}

	#layers = [
		'audio',
		'media',
		'logo',
		'orgLogo',
		'details',
		'toolbar',
		'grid',
		'gallery',
		'controls',
		'embeds',
		'markers',
		'popup',
		'tour',
		'popover',
		'minimap',
		'error',
		'progress',
	]

	#elements = new Map<string, HTMLElement | null>()

	#getBefore(key: string): Node | null {
		const idx = this.#layers.indexOf(key)
		for (let i = idx + 1; i < this.#layers.length; i++) {
			const el = this.#elements.get(this.#layers[i])
			if (el?.isConnected) {
				return el
			}
		}
		return null
	}

	#place(key: string, el: HTMLElement) {
		if (el.isConnected) {
			return
		}
		const before = this.#getBefore(key)
		if (before) {
			this.insertBefore(el, before)
		} else {
			this.append(el)
		}
	}

	/** Whether a custom element tag is registered in this build; unregistered (excluded) elements must not render. */
	#isRegistered(el: HTMLElement | string): boolean {
		const tag = typeof el === 'string' ? el : el.localName
		return !tag.includes('-') || Boolean(customElements.get(tag))
	}

	#show(key: string, condition: boolean, build: () => HTMLElement, update?: (el: HTMLElement) => void) {
		const existing = this.#elements.get(key)
		if (condition) {
			if (existing?.isConnected) {
				update?.(existing)
				return
			}
			existing?.remove()
			const el = build()
			if (!this.#isRegistered(el)) {
				return
			}
			this.#elements.set(key, el)
			this.#place(key, el)
		} else if (existing?.isConnected) {
			existing.remove()
			this.#elements.set(key, null)
		}
	}

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio()
		if (!micrio) {
			return
		}

		// The element volumes follow the image's configured levels, so a muted video or
		// audio element plays at `mutedVolume` (silent by default) rather than being
		// hard-coded to 0 — and a playing one at `startVolume`.
		const volume = writable<number>(1)
		const syncVolume = () => {
			const { $current } = micrio
			const muted = get(micrio._isMuted)
			if ($current) {
				volume.set(volumeFor($current, muted))
			} else {
				volume.set(muted ? 0 : 1)
			}
		}
		syncVolume()
		this._provide('volume', volume)
		this._addCleanup(
			micrio._isMuted.subscribe(() => {
				syncVolume()
			}),
		)
		this._addCleanup(
			micrio.current.subscribe(() => {
				syncVolume()
			}),
		)
		this._addCleanup(() => this.#settingsUnsub?.())

		this._provide('mediaPaused', writable<boolean>(false))

		const onlyMarkers = micrio.dataset.ui === 'markers'
		if (onlyMarkers) {
			this.#props.noHTML = true
		}

		const didStart: string[] = []

		this._addCleanup(
			micrio.current.subscribe((c) => {
				if (!c) {
					return
				}
				this.#info = c.$info
				this.#settings = undefined

				this.#firstInited = true
				this.#settingsUnsub?.()
				this.#settings = c._settings
				this.#settingsUnsub = this.#settings?.subscribe(() => {
					this.#queueSync()
				})
				if (!this.#logoOrg && DataLoader._getOrganisation()?.logo) {
					this.#logoOrg = DataLoader._getOrganisation()
				}
				this.#queueSync()

				if (this.isConnected) {
					this.#sync()
				}

				const d = c.$data
				if (d && didStart.indexOf(c.id) < 0) {
					didStart.push(c.id)
					const autoStart = c.$settings.start
					if (autoStart) {
						void tick()
							.then(tick)
							.then(() => {
								if (get(micrio.state.popover) || get(micrio.state.marker) || get(micrio.state.tour)) {
									return
								}
								switch (autoStart.type) {
									case 'marker': {
										c.state.marker.set(autoStart.id)
										break
									}
									case 'markerTour': {
										const mt = d.markerTours?.find((t) => t.id === autoStart.id)
										if (mt) {
											micrio.state.tour.set(mt)
										}
										break
									}
									case 'tour': {
										const vt = d.tours?.find((t) => t.id === autoStart.id)
										if (vt) {
											micrio.state.tour.set(vt)
										}
										break
									}
									case 'page': {
										const page = findPage(autoStart.id, d.pages)
										if (page) {
											micrio.state.popover.set({ contentPage: page, showLangSelect: true })
										}
										break
									}
								}
							})
					}
				}
				this.#queueSync()
			}),
		)

		this._addCleanup(
			micrio.state.tour.subscribe(() => {
				const sub = this.#elements.get('subtitles')
				if (sub instanceof MicrioElement) {
					sub._setProps?.({ raised: Boolean(get(micrio.state.tour)) })
				}
			}),
		)

		for (const store of [
			micrio._visible,
			micrio.state.popup,
			micrio.state.popover,
			micrio.state.tour,
			micrio.state.marker,
		]) {
			this._addCleanup(
				store.subscribe(() => {
					this.#queueSync()
				}),
			)
		}
		this._addCleanup(
			micrio._lang.subscribe(() => {
				this.#queueSync()
			}),
		)

		this.#queueSync()
	}

	/** @internal */
	_setProps(props: Partial<MainProps>) {
		Object.assign(this.#props, props)
		if (this.isConnected) {
			this.#queueSync()
		}
	}

	#syncQueued = false
	#queueSync() {
		if (this.#syncQueued) {
			return
		}
		this.#syncQueued = true
		Frame.request(() => {
			this.#syncQueued = false
			if (this.isConnected) {
				this.#sync()
			}
		})
	}

	#sync() {
		const micrio = this._getMicrio()
		if (!micrio) {
			return
		}

		const $tour = get(micrio.state.tour)
		const $marker = get(micrio.state.marker)
		const $markerPopup = get(micrio.state.popup)
		const $popover = get(micrio.state.popover)
		const $info = this.#info
		const $settings = this.#settings ? get(this.#settings) : undefined
		const $data = micrio.$current ? get(micrio.$current.data) : undefined
		const { error } = this.#props
		const loadingProgress = this.#props.loadingProgress ?? 1
		const noHTML = this.#props.noHTML ?? false
		const noLogo = this.#props.noLogo ?? noHTML
		const isMobile = micrio.canvas.$isMobile

		const _360 = micrio.$current?._is360
		const video = _360 ? $settings?._360?.video : undefined
		const videoSrc = video?.src
		const isBook3d = micrio.$current?.album?.info?.type === 'book3d'
		this.classList.toggle('is3d', _360 || isBook3d)
		const positionalAudio = $data?.markers?.filter((m) => Boolean(m.positionalAudio))
		const hasAudio = Boolean($data?.music?.items.length) || Boolean(positionalAudio?.length)
		const hasTourOrMarker = $tour || $marker

		const showMarkers = !noHTML || micrio.dataset.ui === 'markers'
		const showLogo = !noLogo && (!$info || !noHTML) && !$settings?.noLogo && !$marker && !$markerPopup
		const showOrgLogo = !noHTML && showLogo && !$settings?.noOrgLogo && Boolean(this.#logoOrg) && !$popover
		const showControls = !noHTML && Boolean($info) && !$settings?.noControls
		const showDetails = !noHTML && !hasTourOrMarker && Boolean($settings?.showInfo)
		const showToolbar = !noHTML && this.#firstInited && !$settings?.noToolbar
		const showMinimap =
			!noHTML &&
			Boolean($info) &&
			$settings?.minimap !== false &&
			!$settings?.noControls &&
			Boolean(micrio.$current?.thumbSrc) &&
			!($markerPopup && isMobile)

		if (hasAudio && Boolean($data) && Boolean($info) && micrio.$current) {
			if (!this.#audioController) {
				this.#audioController = new MicrioAudioController(micrio, micrio.$current)
				this._addCleanup(() => {
					this.#destroyAudio()
				})
			}
		} else {
			this.#destroyAudio()
		}

		this.#show('media', Boolean(videoSrc) && Boolean($info), () => {
			return createElement('div')
		})

		this.#show('logo', showLogo, () => createElement('micrio-logo'))

		this.#show('details', showDetails && Boolean($data), () =>
			createElement('micrio-details', { setProps: { info: $info, data: $data } }),
		)

		this.#show('toolbar', showToolbar, () => createElement('micrio-toolbar'))

		const $visible = get(micrio._visible)
		this.#syncImageLayer(
			this.#markerElements,
			'micrio-markers',
			'markers',
			$visible,
			showMarkers,
			(i) => !i.opts?.isEmbed && (Boolean(i.$data?.markers?.length) || Boolean(micrio.spaceData)),
		)

		this.#syncImageLayer(
			this.#embedElements,
			'micrio-image-embeds',
			'embeds',
			$visible,
			micrio.dataset.embeds !== 'false',
			(i) => Boolean(i.$data?.embeds?.length),
		)

		this.#show('controls', showControls, () =>
			createElement('micrio-controls', {
				setProps: { hasAudio: hasAudio || (videoSrc !== undefined && video !== undefined && !video.muted) },
			}),
		)

		this.#show('orgLogo', showOrgLogo && Boolean(this.#logoOrg), () =>
			createElement('micrio-logo-org', { setProps: { organisation: this.#logoOrg } }),
		)

		const grid = micrio.$current?.grid
		if (grid) {
			this.#place('grid', grid)
		}

		this.#show(
			'gallery',
			Boolean($settings?.omni) || Boolean(micrio.gallery?._config?.type !== 'grid' && micrio.gallery),
			() => createElement('micrio-gallery', { setProps: { controller: micrio.gallery } }),
		)

		this.#show(
			'minimap',
			showMinimap,
			() => createElement('micrio-minimap', { setProps: { image: micrio.$current } }),
			(el) => {
				if (el instanceof MicrioElement) {
					el._setProps?.({ image: micrio.$current })
				}
			},
		)

		// Marker popup — only created when micrio.state.popup is set (after flyTo completes)
		const $popupMarker = get(micrio.state.popup)
		const hasPopup = $popupMarker != null && $popupMarker.popupType !== 'popover'

		const existing = this.#elements.get('popup')

		if (hasPopup) {
			const shouldReplace =
				existing?.isConnected &&
				($popupMarker.id !== this.#activePopupMarkerId || existing.classList.contains('destroying'))
			if (shouldReplace) {
				existing.remove()
				this.#elements.set('popup', null)
			}
			this.#activePopupMarkerId = $popupMarker.id

			if (!this.#elements.get('popup')?.isConnected) {
				this.#elements.set(
					'popup',
					createElement('micrio-marker-popup', { setProps: { marker: $popupMarker }, parent: this }),
				)
			}
		} else if (!existing?.isConnected) {
			// Don't remove — let the popup animate out via its destroying class
			this.#elements.set('popup', null)
			this.#activePopupMarkerId = undefined
		}

		this.#show('tour', Boolean($tour), () => {
			const isSerial = $tour && 'steps' in $tour && $tour.isSerialTour
			const tag = isSerial ? 'micrio-serial-tour' : 'micrio-tour'
			return createElement(tag, { setProps: { tour: $tour, noHTML } })
		})

		// A popover can be replaced while it is open (a page switching to a gallery, a
		// page action), and `#show` reuses the connected element, so the state has to
		// reach it through the update callback
		this.#show(
			'popover',
			Boolean($popover),
			() => createElement('micrio-popover', { setProps: { popover: $popover } }),
			(el) => {
				if (el instanceof MicrioElement) {
					el._setProps?.({ popover: $popover })
				}
			},
		)

		this.#show('error', Boolean(error), () => createElement('micrio-error', { setProps: { message: error } }))

		this.#show('progress', loadingProgress < 1, () =>
			createElement('micrio-progress-circle', { setProps: { progress: loadingProgress } }),
		)

		if (loadingProgress < 1) {
			const el = this.#elements.get('progress')
			if (el instanceof MicrioElement && el.isConnected) {
				el._setProps?.({ progress: loadingProgress })
			}
		}
	}

	#syncImageLayer(
		map: Map<string, HTMLElement>,
		tag: string,
		layerKey: string,
		visible: MicrioImage[],
		enabled: boolean,
		hasContent: (img: MicrioImage) => boolean,
	) {
		const filtered = visible.filter((i): i is MicrioImage => hasContent(i))
		const visibleIds = new Set(filtered.map((i) => i.id))

		for (const [id, el] of map) {
			if (!visibleIds.has(id)) {
				el.remove()
				map.delete(id)
			}
		}

		if (enabled && this.#isRegistered(tag)) {
			for (const img of filtered) {
				if (map.has(img.id)) {
					continue
				}
				const el = createElement(tag, { setProps: { image: img } })
				map.set(img.id, el)
				const before = this.#getBefore(layerKey)
				if (before) {
					this.insertBefore(el, before)
				} else {
					this.append(el)
				}
			}
		} else {
			for (const el of map.values()) {
				el.remove()
			}
			map.clear()
		}

		this.#elements.set(layerKey, map.values().next().value ?? null)
	}
}

customElements.define(MicrioMain.tag, MicrioMain)
