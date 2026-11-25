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
	/** Cached `[width, height]` of rendered marker labels, kept while a marker is hidden by `.overlapped`. */
	#labelSizes = new Map<string, [number, number]>()
	/** Pending camera return after a marker closes; cleared when another marker opens. */
	#zoomReturnTo: ReturnType<typeof setTimeout> | undefined

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
				this.#labelSizes.clear()
			}),
		)

		/** Width of the view the cluster layout was last solved for (2D images only). */
		let lastClusterViewWidth: number | undefined

		const updateOverlapped = (nextView?: Models.Camera.View) => {
			if (!image.$settings.clusterMarkers || this.classList.contains('inactive')) {
				return
			}
			// On a 2D image markers only move relative to each other when the scale changes;
			// panning does not change the overlap graph. 360/omni projections depend on camera
			// rotation, so those keep recomputing. A rebuild calls without a view to force it.
			if (!image._is360 && !image._isOmni && image.canvas?.is360 !== true) {
				const width = nextView?.[2]
				if (width !== undefined && width === lastClusterViewWidth) {
					return
				}
				lastClusterViewWidth = width
			}
			const markers = image.$data?.markers?.filter(
				(m) => !m.noMarker && (!m.i18n || m.i18n[get(micrio._lang)] !== undefined),
			)
			if (!markers) {
				return
			}

			const r = image.$settings.clusterMarkerRadius ?? 24
			const halfR = r / 2
			const ms = image.$settings._markers
			const showTitles = Boolean(ms?.showTitles) && !ms?.noTitles && !image.$settings.omni?.sideLabels
			const omni = image._isOmni ? image.$settings.omni : undefined

			const markerEls = markers.map((m) =>
				this.querySelector<HTMLElement>(`:scope > micrio-marker[data-marker-id="${CSS.escape(m.id)}"]`),
			)

			// When labels are shown by default, include their rendered box in overlap checks.
			// Cache dimensions because `.overlapped` sets `display: none` (making offsetWidth/Height 0).
			const labelSizes: ([number, number] | null)[] = showTitles
				? markers.map((m, i) => {
						const lbl = markerEls[i]?.querySelector<HTMLElement>('label')
						if (!lbl) {
							return null
						}
						if (lbl.offsetWidth > 0 || lbl.offsetHeight > 0) {
							const size: [number, number] = [lbl.offsetWidth, lbl.offsetHeight]
							this.#labelSizes.set(m.id, size)
							return size
						}
						return this.#labelSizes.get(m.id) ?? null
					})
				: []

			// If `showTitles` turned on while markers were already `.overlapped`, reveal unmeasured
			// ones in one batch so their labels can be measured once without layout thrashing.
			if (showTitles) {
				const unmeasured: number[] = []
				for (let i = 0; i < markers.length; i++) {
					const el = markerEls[i]
					if (!labelSizes[i] && el?.classList.contains('overlapped') && el.querySelector('label')) {
						el.classList.remove('overlapped')
						unmeasured.push(i)
					}
				}
				if (unmeasured.length > 0) {
					for (const i of unmeasured) {
						const lbl = markerEls[i]?.querySelector<HTMLElement>('label')
						if (lbl && (lbl.offsetWidth > 0 || lbl.offsetHeight > 0)) {
							const size: [number, number] = [lbl.offsetWidth, lbl.offsetHeight]
							this.#labelSizes.set(markers[i].id, size)
							labelSizes[i] = size
						}
					}
					for (const i of unmeasured) {
						markerEls[i]?.classList.add('overlapped')
					}
				}
			}

			const coords = markers.map((m, i) => {
				const xy = image.camera._getXYDirect(m.x, m.y, { radius: m.radius, rotation: m.rotation })
				const obscured =
					(image._is360 && xy[3] >= 0) ||
					(xy[0] === -1 && xy[1] === -1) ||
					Boolean(omni?.distance && !m.visibleArc && xy[3] < 0)
				if (obscured) {
					return null
				}
				const size = labelSizes[i]
				return [xy[0], xy[1], size?.[0] ?? 0, Math.max(halfR, (size?.[1] ?? 0) / 2)] as [number, number, number, number]
			})

			// Build groups of overlapping markers. `groupOf` keeps the merge below from
			// scanning every existing group for each overlapping pair.
			const groups: number[][] = []
			const groupOf = new Map<number, number[]>()
			for (let i = 0; i < markers.length; i++) {
				const ci = coords[i]
				// Either end can opt a marker out of clustering
				if (!ci || markers[i].tags?.includes('no-cluster')) {
					continue
				}
				for (let j = i + 1; j < markers.length; j++) {
					const cj = coords[j]
					if (!cj || markers[j].tags?.includes('no-cluster')) {
						continue
					}
					if (ci[0] + ci[2] + r <= cj[0] || cj[0] + cj[2] + r <= ci[0] || Math.abs(cj[1] - ci[1]) >= ci[3] + cj[3]) {
						continue
					}
					// A pair can bridge two groups that already exist, so merge every
					// group either index belongs to — picking one would leave the other
					// holding a member that is now in two clusters.
					const gi = groupOf.get(i)
					const gj = groupOf.get(j)
					if (gi && gj) {
						if (gi !== gj) {
							// This pair bridges two existing groups, so merge them.
							gi.push(...gj)
							for (const member of gj) {
								groupOf.set(member, gi)
							}
							groups.splice(groups.indexOf(gj), 1)
						} else {
							continue
						}
					} else if (gi) {
						gi.push(j)
						groupOf.set(j, gi)
						continue
					} else if (gj) {
						gj.push(i)
						groupOf.set(i, gj)
						continue
					} else {
						const group = [i, j]
						groups.push(group)
						groupOf.set(i, group)
						groupOf.set(j, group)
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
				markerEls[i]?.classList.toggle('overlapped', overlapped.has(i))
			}

			// Sync cluster marker elements
			const clusterIds = new Set(clusters.map((g) => g.join(',')))
			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker.cluster')) {
				const id = el.dataset.markerId
				if (id && !clusterIds.has(id)) {
					el.remove()
				}
			}
			const isOmni = image._isOmni
			for (const g of clusters) {
				const id = g.join(',')
				if (this.querySelector(`:scope > micrio-marker.cluster[data-marker-id="${CSS.escape(id)}"]`)) {
					continue
				}
				const cx = g.reduce((s, i) => s + markers[i].x, 0) / g.length
				const cy = g.reduce((s, i) => s + markers[i].y, 0) / g.length
				// An Omni member is projected in 3D from its rotation and radius, so the cluster
				// has to carry those too (`_getXYDirect` only takes the Omni branch when a
				// rotation is given) — and it zooms to a fixed box, not to the members' views.
				let view: Models.Camera.View
				let avgRotation: number | undefined
				let avgRadius: number | undefined
				if (isOmni) {
					const viewSize = 0.3
					const minX = Math.max(0, cx - viewSize / 2)
					const minY = Math.max(0, cy - viewSize / 2)
					const maxX = Math.min(1, cx + viewSize / 2)
					const maxY = Math.min(1, cy + viewSize / 2)
					view = [minX, minY, Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY)]
					avgRotation = g.reduce((s, i) => s + (markers[i].rotation ?? 0), 0) / g.length
					avgRadius = g.reduce((s, i) => s + (markers[i].radius ?? 1), 0) / g.length
				} else {
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
					view = [minX + (maxX - minX) / 2 - viewW / 2, minY + (maxY - minY) / 2 - viewH / 2, viewW, viewH]
				}
				createElement('micrio-marker', {
					attrs: { 'data-marker-id': id },
					setProps: {
						marker: {
							id,
							x: cx,
							y: cy,
							type: 'cluster',
							view,
							rotation: avgRotation,
							radius: avgRadius,
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

			const $switching = get(switching)
			// Waypoints belong to the image the viewer is on. Gating on `$switching` alone is
			// not enough: the outgoing image's layer stays mounted until its own `_visible`
			// entry goes, which the layout sync then acts on a frame later — and the
			// `switching` watcher below would repaint its waypoints in that frame.
			const current = micrio.$current?.id === image.id
			if (!$switching && current && micrio.spaceData) {
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
						this.#labelSizes.delete(id)
					}
				}

				for (const m of filtered) {
					let el = this.querySelector(`:scope > micrio-marker[data-marker-id="${CSS.escape(m.id)}"]`)
					// New data for the same id means the mounted element is stale: removing
					// it runs the element's own cleanup, so the fresh one subscribes again
					if (el && this.#markerObjects.get(m.id) !== m) {
						el.remove()
						this.#markerObjects.delete(m.id)
						this.#labelSizes.delete(m.id)
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
				this.#labelSizes.clear()
			}

			if (inactive) {
				for (const el of this.querySelectorAll(':scope > micrio-marker, :scope > micrio-waypoint')) {
					el.remove()
				}
				this.#markerObjects.clear()
				this.#labelSizes.clear()
			}

			updateClickableAreas($visible, Boolean(inactive), $_lang)

			if (image.$settings.clusterMarkers && !inactive) {
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
		this._watchLazy(micrio._lang, () => {
			this.#labelSizes.clear()
			clearClusters()
			rebuild()
		})

		if (image.$settings.clusterMarkers) {
			this._addCleanup(image.state.view.subscribe(updateOverlapped))
		}

		if (!image.grid && image.$settings._markers?.zoomOutAfterClose) {
			let wasVideoTour = false
			this._addCleanup(
				image.state.marker.subscribe((m) => {
					if (m !== undefined && m !== '' && typeof m !== 'string') {
						// A new marker owns the next return point; a pending return for the
						// previous one must not fire over it.
						clearTimeout(this.#zoomReturnTo)
						this.#zoomReturnTo = undefined
						const $tour = get(micrio.state.tour)
						if (!m.noMarker && m.view && !($tour && !('steps' in $tour))) {
							image._openedView = structuredClone(image.state.$view ?? image.camera?.getView())
							wasVideoTour = Boolean(m.videoTour)
						} else {
							image._openedView = undefined
							wasVideoTour = false
						}
					} else if ((m === undefined || m === '') && image._openedView && !get(micrio.state.tour)) {
						clearTimeout(this.#zoomReturnTo)
						const view = image._openedView
						const delay = wasVideoTour ? 250 : 10
						this.#zoomReturnTo = setTimeout(() => {
							this.#zoomReturnTo = undefined
							// A newer marker replaced the return point during the delay.
							if (image._openedView !== view) {
								return
							}
							const w = Math.min(1, view[2])
							const h = Math.min(1, view[3])
							const hh = h / 2,
								hw = w / 2
							const cx = Math.max(hw, Math.min(1 - hw, view[0] + hw))
							const cy = Math.max(hh, Math.min(1 - hh, view[1] + hh))
							image.camera
								.flyToView([cx - hw, cy - hh, w, h] as Models.Camera.View, {
									speed: image.$settings._markers?.zoomOutAfterCloseSpeed,
								})
								.catch(() => {})
							image._openedView = undefined
							wasVideoTour = false
						}, delay)
					}
				}),
			)
			this._addCleanup(() => {
				clearTimeout(this.#zoomReturnTo)
				this.#zoomReturnTo = undefined
			})
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
