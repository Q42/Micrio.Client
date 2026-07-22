import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import './marker';
import './waypoint';

export interface MarkersProps {
	image: MicrioImage;
}

class MicrioMarkers extends MicrioElement<MarkersProps> {
	static tag = 'micrio-markers';
	static styles = `micrio-markers{pointer-events:none;position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;will-change:width,height,top,left,opacity;perspective:inherit}
micrio-markers:empty{display:none}
micrio-markers>*{pointer-events:all}
micrio-markers.inactive>*{pointer-events:none}
micrio-main.is360 micrio-markers{transition:opacity .25s}
micrio-main.is360 micrio-markers.inactive{opacity:0}`;

	#props: MarkersProps = { image: null! };

	onMount() {
		const { image } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !image) return;

		const { switching, state: micrioState } = micrio;
		const grid = micrio.canvases[0]?.grid;
		const focussed = grid?.focussed;
		const gridMarkersShown = grid?.markersShown;

		this.addCleanup(image.viewport.subscribe((v: Models.Camera.View) => {
			if (!v || v.length < 4) return;
			v = v.map(f => Math.round(f * 100) / 100) as Models.Camera.View;
			this.style.cssText = [
				...(!v[0] ? [] : [`left: ${v[0]}px`]),
				...(!v[1] ? [] : [`top: ${v[1]}px`]),
				`width: ${v[2]}px`,
				`height: ${v[3]}px`
			].join(';') + ';';
		}));

		const updateOverlapped = () => {
			if (!image.$settings.clusterMarkers) return;
			const markers = image.$data?.markers?.filter(m => !m.i18n || m.i18n[get(micrio._lang)]);
			if (!markers) return;

			const r = image.$settings.clusterMarkerRadius ?? 16;
			const coords = markers.map(m => {
				const xy = image.camera.getXYDirect(m.x, m.y, { radius: m.radius, rotation: m.rotation });
				return [xy[0], xy[1]] as [number, number];
			});

			// Build groups of overlapping markers
			const groups: number[][] = [];
			for (let i = 0; i < markers.length; i++) {
				for (let j = i + 1; j < markers.length; j++) {
					if (markers[j].tags?.includes('no-cluster')) continue;
					if (Math.abs(coords[j][0] - coords[i][0]) >= r || Math.abs(coords[j][1] - coords[i][1]) >= r) continue;
					const existing = groups.find(g => g.includes(i) || g.includes(j));
					if (existing) { existing.push(i, j); }
					else { groups.push([i, j]); }
				}
			}

			// Deduplicate & sort each group
			const clusters = groups.map(g => [...new Set(g)].sort((a, b) => a - b));
			const overlapped = new Set<number>();
			for (const g of clusters) for (const i of g) overlapped.add(i);

			// Toggle overlapped class on individual markers
			for (let i = 0; i < markers.length; i++) {
				const el = this.querySelector(`[data-marker-id="${markers[i].id}"]`);
				el?.classList.toggle('overlapped', overlapped.has(i));
			}

			// Sync cluster marker elements
			const clusterIds = new Set(clusters.map(g => g.join(',')));
			for (const el of this.querySelectorAll(':scope > micrio-marker.cluster')) {
				const id = el.getAttribute('data-marker-id');
				if (id && !clusterIds.has(id)) el.remove();
			}
			for (const g of clusters) {
				const id = g.join(',');
				if (this.querySelector(`:scope > micrio-marker.cluster[data-marker-id="${id}"]`)) continue;
				const cx = g.reduce((s, i) => s + markers[i].x, 0) / g.length;
				const cy = g.reduce((s, i) => s + markers[i].y, 0) / g.length;
				const minX = Math.min(...g.map(i => markers[i].view ? markers[i].view![0] : markers[i].x));
				const maxX = Math.max(...g.map(i => markers[i].view ? markers[i].view![0] + markers[i].view![2] : markers[i].x));
				const minY = Math.min(...g.map(i => markers[i].view ? markers[i].view![1] : markers[i].y));
				const maxY = Math.max(...g.map(i => markers[i].view ? markers[i].view![1] + markers[i].view![3] : markers[i].y));
				createElement('micrio-marker', {
					attrs: { 'data-marker-id': id },
					setProps: {
						marker: {
							id, x: cx, y: cy, type: 'cluster', title: g.length + '',
							view: [minX, minY, Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY)],
							data: {}, popupType: 'none', tags: []
						} as any,
						image
					},
					parent: this
				});
			}
		};

		const rebuild = () => {
			const $visible = image.$data?.markers;
			const $focussed = focussed ? get(focussed) : undefined;
			const $gridMarkersShown = gridMarkersShown ? get(gridMarkersShown) : undefined;
			const inactive = grid && ($focussed != image && ($gridMarkersShown && $gridMarkersShown.indexOf(image) < 0));
			const showTitles = !!(image.$settings._markers?.showTitles);

			this.classList.toggle('inactive', !!inactive);
			this.classList.toggle('show-titles', showTitles);

			const $switching = get(switching);
			if (!$switching && micrio.spaceData) {
				const links = micrio.spaceData.links.filter((l: any) => l[0] == image.id || l[1] == image.id);
				const linkIds = new Set(links.map((l: any) => l[0] == image.id ? l[1] : l[0]));
				for (const el of this.querySelectorAll(':scope > micrio-waypoint')) {
					if (!linkIds.has(el.getAttribute('data-target-id'))) el.remove();
				}
				for (const l of links) {
					const id = l[0] == image.id ? l[1] : l[0];
					let el = this.querySelector(`:scope > micrio-waypoint[data-target-id="${id}"]`) as MicrioElement;
					if (!el) {
						el = createElement('micrio-waypoint', {
							attrs: { 'data-target-id': id },
							setProps: { targetId: id, settings: l[2]?.[image.id], image },
							parent: this
						}) as unknown as MicrioElement;
					}
				}
			} else {
				for (const el of this.querySelectorAll(':scope > micrio-waypoint')) el.remove();
			}

			if ($visible) {
				const $_lang = get(micrio._lang);
				const filtered = $visible.filter(m => !m.i18n || m.i18n[$_lang]);
				const expected = new Set(filtered.map(m => m.id));

				for (const el of this.querySelectorAll(':scope > micrio-marker')) {
					const id = el.getAttribute('data-marker-id');
					if (!id || el.classList.contains('cluster')) continue;
					if (!expected.has(id)) el.remove();
				}

				for (const m of filtered) {
					let el = this.querySelector(`:scope > micrio-marker[data-marker-id="${m.id}"]`) as MicrioElement;
					if (!el) {
						el = createElement('micrio-marker', {
							attrs: { 'data-marker-id': m.id },
							setProps: { marker: m, image, ...(m.noMarker ? { forceHidden: true } : {}) },
							parent: this
						}) as unknown as MicrioElement;
					}
				}
			} else {
				for (const el of this.querySelectorAll(':scope > micrio-marker')) el.remove();
			}

			if (inactive) {
				for (const el of this.querySelectorAll(':scope > micrio-marker, :scope > micrio-waypoint')) el.remove();
			}

			if (image.$settings.clusterMarkers) updateOverlapped();
		};

		this.watchLater(image.data, rebuild);
		this.watchLater(switching, rebuild);
		if (micrioState.tour) this.watchLater(micrioState.tour, rebuild);
		if (focussed) this.watchLater(focussed, rebuild);
		if (gridMarkersShown) this.watchLater(gridMarkersShown, rebuild);
		this.watchLazy(micrio._lang, rebuild);

		if (image.$settings.clusterMarkers) {
			this.addCleanup(image.state.view.subscribe(updateOverlapped));
		}

		if (!image.grid && image.$settings._markers?.zoomOutAfterClose) {
			let wasVideoTour = false;
			this.addCleanup(image.state.marker.subscribe(m => {
				if (m && typeof m != 'string' && !image.openedView && !m.noMarker && m.view) {
			image.openedView = get(micrio.state.tour) && !('steps' in get(micrio.state.tour)!) ? undefined
				: structuredClone(image.state.$view ?? image.camera?.getView());
					wasVideoTour = !!m.videoTour;
				} else if (!m && image.openedView && !get(micrio.state.tour)) {
					setTimeout(() => {
						if (image.openedView) {
							const v = image.openedView;
							const w = Math.min(1, v[2]);
							const h = Math.min(1, v[3]);
							const hw = w / 2, hh = h / 2;
							const cx = Math.max(hw, Math.min(1 - hw, v[0] + hw));
							const cy = Math.max(hh, Math.min(1 - hh, v[1] + hh));
							image.camera.flyToView([cx - hw, cy - hh, w, h] as Models.Camera.View, {
								speed: image.$settings._markers?.zoomOutAfterCloseSpeed,
							}).catch(() => {});
						}
						image.openedView = undefined;
						wasVideoTour = false;
					}, wasVideoTour ? 250 : 10);
				}
			}));
		}

		rebuild();
	}

	setProps(props: Partial<MarkersProps>) {
		if (props.image !== undefined) this.#props.image = props.image;
	}

	onDestroy() {
	}
}

customElements.define(MicrioMarkers.tag, MicrioMarkers);
