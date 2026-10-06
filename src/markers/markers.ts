import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import { get } from '$core/store'
import { createElement } from '$utils/dom'
import './marker'
import './waypoint'
import '$embed/embed'

/** Props for the markers container element. @internal */
export interface MarkersProps {
	/** The MicrioImage instance whose markers to render. */
	image: MicrioImage
}
import './markers.css'

/** Custom element that manages all markers and waypoints for a MicrioImage, including clustering and spatial links. */
class MicrioMarkers extends MicrioElement<MarkersProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-markers'

	#props: Partial<MarkersProps> = {}
	/** The marker object each rendered marker element was built from, to detect data edits. */
	#markerObjects = new Map<string, Models.ImageData.Marker>()
	/** The marker object each clickable-area embed was built from. */
	#areaObjects = new Map<string, Models.ImageData.Marker>()

	/** @internal */
	_onMount() {
		const { image } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !image) {
			return
		}

		const { _switching: switching, state: micrioState } = micrio
		const grid = micrio._canvases[0]?.grid
		const focussed = grid?._focussed
		const gridMarkersShown = grid?._markersShown

		this._addCleanup(
			image._viewport.subscribe((v: Models.Camera.View) => {
				if (v === undefined || v.length < 4) {
					return
				}
				v = v.map((f) => Math.round(f * 100) / 100)
				const size = micrio.canvas.viewport
				this.style.left = !v[0] ? '' : `${v[0]}px`
				this.style.top = !v[1] ? '' : `${v[1]}px`
				this.style.width = v[2] === size.width ? '' : `${v[2]}px`
				this.style.height = v[3] === size.height ? '' : `${v[3]}px`
			}),
		)

		const updateOverlapped = () => {
			if (!image.$settings.clusterMarkers) {
				return
			}
			const markers = image.$data?.markers?.filter((m) => !m.i18n || m.i18n[get(micrio._lang)] !== undefined)
			if (!markers) {
				return
			}

			const r = image.$settings.clusterMarkerRadius ?? 24
			const coords = markers.map((m) => {
				const xy = image.camera._getXYDirect(m.x, m.y, { radius: m.radius, rotation: m.rotation })
				return [xy[0], xy[1]] as [number, number]
			})

			// Build groups of overlapping markers
			const groups: number[][] = []
			for (let i = 0; i < markers.length; i++) {
				for (let j = i + 1; j < markers.length; j++) {
					// Either end can opt a marker out of clustering
					if (markers[i].tags?.includes('no-cluster') || markers[j].tags?.includes('no-cluster')) {
						continue
					}
					if (Math.abs(coords[j][0] - coords[i][0]) >= r || Math.abs(coords[j][1] - coords[i][1]) >= r) {
						continue
					}
					// A pair can bridge two groups that already exist, so merge every
					// group either index belongs to — picking one would leave the other
					// holding a member that is now in two clusters.
					const matches = groups.filter((g) => g.includes(i) || g.includes(j))
					if (matches.length > 0) {
						const [first, ...rest] = matches
						first.push(i, j)
						for (const extra of rest) {
							first.push(...extra)
							groups.splice(groups.indexOf(extra), 1)
						}
					} else {
						groups.push([i, j])
					}
				}
			}

			// Deduplicate & sort each group
			const clusters = groups.map((g) => [...new Set(g)].sort((a, b) => a - b))
			const overlapped = new Set<number>()
			for (const g of clusters) {
				for (const i of g) {
					overlapped.add(i)
				}
			}

			// Toggle overlapped class on individual markers
			for (let i = 0; i < markers.length; i++) {
				const el = this.querySelector(`[data-marker-id="${CSS.escape(markers[i].id)}"]`)
				el?.classList.toggle('overlapped', overlapped.has(i))
			}

			// Sync cluster marker elements
			const clusterIds = new Set(clusters.map((g) => g.join(',')))
			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker.cluster')) {
				const id = el.dataset.markerId
				if (id && !clusterIds.has(id)) {
					el.remove()
				}
			}
			for (const g of clusters) {
				const id = g.join(',')
				if (this.querySelector(`:scope > micrio-marker.cluster[data-marker-id="${CSS.escape(id)}"]`)) {
					continue
				}
				const cx = g.reduce((s, i) => s + markers[i].x, 0) / g.length
				const cy = g.reduce((s, i) => s + markers[i].y, 0) / g.length
				const minX = Math.min(...g.map((i) => (markers[i].view ? markers[i].view[0] : markers[i].x)))
				const maxX = Math.max(
					...g.map((i) => (markers[i].view ? markers[i].view[0] + markers[i].view[2] : markers[i].x)),
				)
				const minY = Math.min(...g.map((i) => (markers[i].view ? markers[i].view[1] : markers[i].y)))
				const maxY = Math.max(
					...g.map((i) => (markers[i].view ? markers[i].view[1] + markers[i].view[3] : markers[i].y)),
				)
				const viewW = Math.max(0.1, maxX - minX)
				const viewH = Math.max(0.1, maxY - minY)
				const view = [minX + (maxX - minX) / 2 - viewW / 2, minY + (maxY - minY) / 2 - viewH / 2, viewW, viewH]
				createElement('micrio-marker', {
					attrs: { 'data-marker-id': id },
					setProps: {
						marker: {
							id,
							x: cx,
							y: cy,
							type: 'cluster',
							view,
							data: {},
							popupType: 'none',
							tags: [],
						},
						image,
						clusterCount: g.length,
					},
					parent: this,
				})
			}
		}

		/**
		 * Removes every synthetic cluster and clears the overlap flags, for when
		 * `clusterMarkers` is turned off while a layer is already up.
		 */
		const clearClusters = () => {
			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker.cluster')) {
				el.remove()
			}
			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker.overlapped')) {
				el.classList.remove('overlapped')
			}
		}

		/**
		 * Syncs the clickable area embeds of markers (`marker.clickableArea`).
		 *
		 * These are HTML embeds placed over a region of the image which open their
		 * own marker when clicked. They are intentionally rendered *before* the
		 * marker elements, so marker dots (and waypoints) stay on top of them.
		 */
		const updateClickableAreas = ($markers: Models.ImageData.Marker[] | undefined, inactive: boolean, lang: string) => {
			const areas =
				!inactive && $markers ? $markers.filter((m) => m.clickableArea && (!m.i18n || m.i18n[lang] !== undefined)) : []
			const areasById = new Map(areas.map((m) => [m.id, m]))

			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-embed[data-marker-id]')) {
				const id = el.dataset.markerId
				// An embed whose marker data changed carries stale props, so it is rebuilt
				if (!id || areasById.get(id) !== this.#areaObjects.get(id)) {
					el.remove()
					if (id) {
						this.#areaObjects.delete(id)
					}
				}
			}

			const before = this.querySelector(':scope > micrio-marker, :scope > micrio-waypoint')
			for (const m of areas) {
				if (this.querySelector(`:scope > micrio-embed[data-marker-id="${CSS.escape(m.id)}"]`)) {
					continue
				}
				const el = createElement('micrio-embed', {
					attrs: { 'data-marker-id': m.id },
					setProps: { embed: m.clickableArea, marker: m, image },
				})
				this.#areaObjects.set(m.id, m)
				if (before) {
					this.insertBefore(el, before)
				} else {
					this.append(el)
				}
			}
		}

		const rebuild = () => {
			const $visible = image.$data?.markers
			const $focussed = focussed ? get(focussed) : undefined
			const $gridMarkersShown = gridMarkersShown ? get(gridMarkersShown) : undefined
			const inactive = grid && $focussed !== image && $gridMarkersShown && $gridMarkersShown.indexOf(image) < 0
			const ms = image.$settings._markers ?? {}
			const showTitles = Boolean(ms.showTitles)
			const $_lang = get(micrio._lang)

			this.classList.toggle('inactive', Boolean(inactive))
			this.classList.toggle('show-titles', showTitles)

			// A running tour hides the layer unless the tour keeps the markers (`keepMarkers`
			// exists on video tours). Video tours hide by default; a marker tour hides only
			// when the image asks for it, because its steps are usually the point of it.
			const $tour = get(micrioState.tour)
			const tourIsMarkerTour = $tour !== undefined && 'steps' in $tour
			const keepMarkers = $tour !== undefined && 'keepMarkers' in $tour && Boolean($tour.keepMarkers)
			this.classList.toggle(
				'hidden',
				$tour !== undefined && !keepMarkers && (tourIsMarkerTour ? Boolean(ms.hideMarkersDuringTour) : true),
			)

			// The marker size/colour are CSS variables on the layer, so every marker (and
			// the synthetic clusters) inherits them; an unset setting clears the inline
			// value again instead of pinning it to a stale one.
			this.style.setProperty('--micrio-marker-size', ms.markerSize ?? '')
			this.style.setProperty('--micrio-marker-color', ms.markerColor ?? '')

			const $switching = get(switching)
			if (!$switching && micrio.spaceData) {
				const links = micrio.spaceData.links.filter((l) => l[0] === image.id || l[1] === image.id)
				const linkIds = new Set(links.map((l) => (l[0] === image.id ? l[1] : l[0])))
				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-waypoint')) {
					const { targetId } = el.dataset
					if (!targetId || !linkIds.has(targetId)) {
						el.remove()
					}
				}
				for (const l of links) {
					const id = l[0] === image.id ? l[1] : l[0]
					let el = this.querySelector(`:scope > micrio-waypoint[data-target-id="${CSS.escape(id)}"]`)
					if (!el) {
						el = createElement('micrio-waypoint', {
							attrs: { 'data-target-id': id },
							setProps: { targetId: id, settings: l[2]?.[image.id], image },
							parent: this,
						})
					}
				}
			} else {
				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-waypoint')) {
					el.remove()
				}
			}

			if ($visible) {
				const filtered = $visible.filter((m) => !m.i18n || m.i18n[$_lang] !== undefined)
				const expected = new Set(filtered.map((m) => m.id))

				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker')) {
					const id = el.dataset.markerId
					if (!id || el.classList.contains('cluster')) {
						continue
					}
					if (!expected.has(id)) {
						el.remove()
						this.#markerObjects.delete(id)
					}
				}

				for (const m of filtered) {
					let el = this.querySelector(`:scope > micrio-marker[data-marker-id="${CSS.escape(m.id)}"]`)
					// New data for the same id means the mounted element is stale: removing
					// it runs the element's own cleanup, so the fresh one subscribes again
					if (el && this.#markerObjects.get(m.id) !== m) {
						el.remove()
						this.#markerObjects.delete(m.id)
						el = null
					}
					if (!el) {
						createElement('micrio-marker', {
							attrs: { 'data-marker-id': m.id },
							setProps: { marker: m, image, ...(m.noMarker ? { forceHidden: true } : {}) },
							parent: this,
						})
						this.#markerObjects.set(m.id, m)
					}
				}
			} else {
				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker')) {
					el.remove()
				}
				this.#markerObjects.clear()
			}

			if (inactive) {
				for (const el of this.querySelectorAll(':scope > micrio-marker, :scope > micrio-waypoint')) {
					el.remove()
				}
				this.#markerObjects.clear()
			}

			updateClickableAreas($visible, Boolean(inactive), $_lang)

			if (image.$settings.clusterMarkers) {
				updateOverlapped()
			} else {
				clearClusters()
			}
		}

		this._watchLater(image.data, rebuild)
		this._watchLater(image._settings, rebuild)
		this._watchLater(switching, rebuild)
		this._watchLater(micrioState.tour, rebuild)
		if (focussed) {
			this._watchLater(focussed, rebuild)
		}
		if (gridMarkersShown) {
			this._watchLater(gridMarkersShown, rebuild)
		}
		this._watchLazy(micrio._lang, rebuild)

		if (image.$settings.clusterMarkers) {
			this._addCleanup(image.state.view.subscribe(updateOverlapped))
		}

		if (!image.grid && image.$settings._markers?.zoomOutAfterClose) {
			let wasVideoTour = false
			this._addCleanup(
				image.state.marker.subscribe((m) => {
					if (m !== undefined && m !== '' && typeof m !== 'string' && !image._openedView && !m.noMarker && m.view) {
						const $tour = get(micrio.state.tour)
						image._openedView =
							$tour && !('steps' in $tour) ? undefined : structuredClone(image.state.$view ?? image.camera?.getView())
						wasVideoTour = Boolean(m.videoTour)
					} else if ((m === undefined || m === '') && image._openedView && !get(micrio.state.tour)) {
						setTimeout(
							() => {
								if (image._openedView) {
									const v = image._openedView
									const w = Math.min(1, v[2])
									const h = Math.min(1, v[3])
									const hh = h / 2,
										hw = w / 2
									const cx = Math.max(hw, Math.min(1 - hw, v[0] + hw))
									const cy = Math.max(hh, Math.min(1 - hh, v[1] + hh))
									image.camera
										.flyToView([cx - hw, cy - hh, w, h] as Models.Camera.View, {
											speed: image.$settings._markers?.zoomOutAfterCloseSpeed,
										})
										.catch(() => {})
								}
								image._openedView = undefined
								wasVideoTour = false
							},
							wasVideoTour ? 250 : 10,
						)
					}
				}),
			)
		}

		rebuild()
	}

	/** @internal */
	_setProps(props: Partial<MarkersProps>) {
		if (props.image !== undefined) {
			this.#props.image = props.image
		}
	}
}

customElements.define(MicrioMarkers.tag, MicrioMarkers)
