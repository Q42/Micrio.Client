import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import './marker';
import './waypoint';
import '$embed/embed';

/** Props for the markers container element. @internal */
export interface MarkersProps {
	/** The MicrioImage instance whose markers to render. */
	image: MicrioImage;
}
import './markers.css';

/** Custom element that manages all markers and waypoints for a MicrioImage, including clustering and spatial links. */
class MicrioMarkers extends MicrioElement<MarkersProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-markers';

	#props: Partial<MarkersProps> = {};

	/** @internal */
	_onMount() {
		const { image } = this.#props;
		const micrio = this._getMicrio();
		if (!micrio || !image) {return;}

		const { _switching: switching, state: micrioState } = micrio;
		const grid = micrio._canvases[0]?.grid;
		const focussed = grid?._focussed;
		const gridMarkersShown = grid?._markersShown;

		this._addCleanup(image._viewport.subscribe((v: Models.Camera.View) => {
			if (v === undefined || v.length < 4) {return;}
			v = v.map(f => Math.round(f * 100) / 100);
			const size = micrio.canvas.viewport;
			this.style.left = !v[0] ? '' : `${v[0]}px`;
			this.style.top = !v[1] ? '' : `${v[1]}px`;
			this.style.width = v[2] === size.width ? '' : `${v[2]}px`;
			this.style.height = v[3] === size.height ? '' : `${v[3]}px`;
		}));

		const updateOverlapped = () => {
			if (!image.$settings.clusterMarkers) {return;}
			const markers = image.$data?.markers?.filter(m => !m.i18n || m.i18n[get(micrio._lang)] !== undefined);
			if (!markers) {return;}

			const r = image.$settings.clusterMarkerRadius ?? 24;
			const coords = markers.map(m => {
				const xy = image.camera._getXYDirect(m.x, m.y, { radius: m.radius, rotation: m.rotation });
				return [xy[0], xy[1]] as [number, number];
			});

			// Build groups of overlapping markers
			const groups: number[][] = [];
			for (let i = 0; i < markers.length; i++) {
				for (let j = i + 1; j < markers.length; j++) {
					if (markers[j].tags?.includes('no-cluster')) {continue;}
					if (Math.abs(coords[j][0] - coords[i][0]) >= r || Math.abs(coords[j][1] - coords[i][1]) >= r) {continue;}
					const existing = groups.find(g => g.includes(i) || g.includes(j));
					if (existing) { existing.push(i, j); }
					else { groups.push([i, j]); }
				}
			}

			// Deduplicate & sort each group
			const clusters = groups.map(g => [...new Set(g)].sort((a, b) => a - b));
			const overlapped = new Set<number>();
			for (const g of clusters) {for (const i of g) {overlapped.add(i);}}

			// Toggle overlapped class on individual markers
			for (let i = 0; i < markers.length; i++) {
				const el = this.querySelector(`[data-marker-id="${CSS.escape(markers[i].id)}"]`);
				el?.classList.toggle('overlapped', overlapped.has(i));
			}

			// Sync cluster marker elements
			const clusterIds = new Set(clusters.map(g => g.join(',')));
			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker.cluster')) {
				const id = el.dataset.markerId;
				if (id && !clusterIds.has(id)) {el.remove();}
			}
			for (const g of clusters) {
				const id = g.join(',');
				if (this.querySelector(`:scope > micrio-marker.cluster[data-marker-id="${CSS.escape(id)}"]`)) {continue;}
				const cx = g.reduce((s, i) => s + markers[i].x, 0) / g.length;
				const cy = g.reduce((s, i) => s + markers[i].y, 0) / g.length;
				const minX = Math.min(...g.map(i => markers[i].view ? markers[i].view[0] : markers[i].x));
				const maxX = Math.max(...g.map(i => markers[i].view ? markers[i].view[0] + markers[i].view[2] : markers[i].x));
				const minY = Math.min(...g.map(i => markers[i].view ? markers[i].view[1] : markers[i].y));
				const maxY = Math.max(...g.map(i => markers[i].view ? markers[i].view[1] + markers[i].view[3] : markers[i].y));
				const viewW = Math.max(0.1, maxX - minX);
				const viewH = Math.max(0.1, maxY - minY);
				const view = [minX + (maxX - minX) / 2 - viewW / 2, minY + (maxY - minY) / 2 - viewH / 2, viewW, viewH];
				createElement('micrio-marker', {
					attrs: { 'data-marker-id': id },
					setProps: {
						marker: {
							id, x: cx, y: cy, type: 'cluster', title: `${g.length  }`,
							view,
							data: {}, popupType: 'none', tags: []
						},
						image
					},
					parent: this
				});
			}
		};

		/**
		 * Syncs the clickable area embeds of markers (`marker.clickableArea`).
		 *
		 * These are HTML embeds placed over a region of the image which open their
		 * own marker when clicked. They are intentionally rendered *before* the
		 * marker elements, so marker dots (and waypoints) stay on top of them.
		 */
		const updateClickableAreas = ($markers: Models.ImageData.Marker[] | undefined, inactive: boolean, lang: string) => {
			const areas = !inactive && $markers
				? $markers.filter(m => m.clickableArea && (!m.i18n || m.i18n[lang] !== undefined))
				: [];
			const expected = new Set(areas.map(m => m.id));

			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-embed[data-marker-id]')) {
				const id = el.dataset.markerId;
				if (!id || !expected.has(id)) {el.remove();}
			}

			const before = this.querySelector(':scope > micrio-marker, :scope > micrio-waypoint');
			for (const m of areas) {
				if (this.querySelector(`:scope > micrio-embed[data-marker-id="${CSS.escape(m.id)}"]`)) {continue;}
				const el = createElement('micrio-embed', {
					attrs: { 'data-marker-id': m.id },
					setProps: { embed: m.clickableArea, marker: m, image }
				});
				if (before) {this.insertBefore(el, before);}
				else {this.append(el);}
			}
		};

		const rebuild = () => {
			const $visible = image.$data?.markers;
			const $focussed = focussed ? get(focussed) : undefined;
			const $gridMarkersShown = gridMarkersShown ? get(gridMarkersShown) : undefined;
			const inactive = grid && ($focussed !== image && ($gridMarkersShown && $gridMarkersShown.indexOf(image) < 0));
			const showTitles = Boolean(image.$settings._markers?.showTitles);
			const $_lang = get(micrio._lang);

			this.classList.toggle('inactive', Boolean(inactive));
			this.classList.toggle('show-titles', showTitles);

			const $switching = get(switching);
			if (!$switching && micrio.spaceData) {
				const links = micrio.spaceData.links.filter(l => l[0] === image.id || l[1] === image.id);
				const linkIds = new Set(links.map(l => l[0] === image.id ? l[1] : l[0]));
				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-waypoint')) {
					const {targetId} = el.dataset;
					if (!targetId || !linkIds.has(targetId)) {el.remove();}
				}
				for (const l of links) {
					const id = l[0] === image.id ? l[1] : l[0];
					let el = this.querySelector(`:scope > micrio-waypoint[data-target-id="${CSS.escape(id)}"]`);
					if (!el) {
						el = createElement('micrio-waypoint', {
							attrs: { 'data-target-id': id },
							setProps: { targetId: id, settings: l[2]?.[image.id], image },
							parent: this
						});
					}
				}
			} else {
				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-waypoint')) {el.remove();}
			}

			if ($visible) {
				const filtered = $visible.filter(m => !m.i18n || m.i18n[$_lang] !== undefined);
				const expected = new Set(filtered.map(m => m.id));

				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker')) {
					const id = el.dataset.markerId;
					if (!id || el.classList.contains('cluster')) {continue;}
					if (!expected.has(id)) {el.remove();}
				}

				for (const m of filtered) {
					let el = this.querySelector(`:scope > micrio-marker[data-marker-id="${CSS.escape(m.id)}"]`);
					if (!el) {
						el = createElement('micrio-marker', {
							attrs: { 'data-marker-id': m.id },
							setProps: { marker: m, image, ...(m.noMarker ? { forceHidden: true } : {}) },
							parent: this
						});
					}
				}
			} else {
				for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-marker')) {el.remove();}
			}

			if (inactive) {
				for (const el of this.querySelectorAll(':scope > micrio-marker, :scope > micrio-waypoint')) {el.remove();}
			}

			updateClickableAreas($visible, Boolean(inactive), $_lang);

			if (image.$settings.clusterMarkers) {updateOverlapped();}
		};

		this._watchLater(image.data, rebuild);
		this._watchLater(switching, rebuild);
		this._watchLater(micrioState.tour, rebuild);
		if (focussed) {this._watchLater(focussed, rebuild);}
		if (gridMarkersShown) {this._watchLater(gridMarkersShown, rebuild);}
		this._watchLazy(micrio._lang, rebuild);

		if (image.$settings.clusterMarkers) {
			this._addCleanup(image.state.view.subscribe(updateOverlapped));
		}

		if (!image.grid && image.$settings._markers?.zoomOutAfterClose) {
			let wasVideoTour = false;
			this._addCleanup(image.state.marker.subscribe(m => {
				if (m !== undefined && m !== '' && typeof m !== 'string' && !image._openedView && !m.noMarker && m.view) {
			const $tour = get(micrio.state.tour);
			image._openedView = $tour && !('steps' in $tour) ? undefined
				: structuredClone(image.state.$view ?? image.camera?.getView());
					wasVideoTour = Boolean(m.videoTour);
				} else if ((m === undefined || m === '') && image._openedView && !get(micrio.state.tour)) {
					setTimeout(() => {
						if (image._openedView) {
							const v = image._openedView;
							const w = Math.min(1, v[2]);
							const h = Math.min(1, v[3]);
							const hh = h / 2, hw = w / 2;
							const cx = Math.max(hw, Math.min(1 - hw, v[0] + hw));
							const cy = Math.max(hh, Math.min(1 - hh, v[1] + hh));
							image.camera.flyToView([cx - hw, cy - hh, w, h] as Models.Camera.View, {
								speed: image.$settings._markers?.zoomOutAfterCloseSpeed,
							}).catch(() => {});
						}
						image._openedView = undefined;
						wasVideoTour = false;
					}, wasVideoTour ? 250 : 10);
				}
			}));
		}

		rebuild();
	}

	/** @internal */
	_setProps(props: Partial<MarkersProps>) {
		if (props.image !== undefined) {this.#props.image = props.image;}
	}

}

customElements.define(MicrioMarkers.tag, MicrioMarkers);
