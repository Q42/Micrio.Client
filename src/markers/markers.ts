import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { clone } from '$utils/object';
import { createElement } from '$utils/dom';
import './marker';
import './waypoint';

export interface MarkersProps {
	image: MicrioImage;
}

type MarkerCoords = [x: number, y: number, w?: number, h?: number];

function overlaps([x0, y0, w0 = 0, h0 = 0]: MarkerCoords, [x1, y1, w1 = 0, h1 = 0]: MarkerCoords, r: number): boolean {
	const rY0 = Math.max(h0 / 2, r);
	const rY1 = Math.max(h1 / 2, r);
	return !(x0 + w0 + r < x1 - r || x0 - r > x1 + w1 + r || y0 + rY0 < y1 - rY1 || y0 - rY0 > y1 + rY1);
}

function calcClusters(
	visibleMarkers: Models.ImageData.Marker[] | undefined,
	coords: Map<string, MarkerCoords>,
	r: number,
	isOmni: boolean
): { overlapped: number[]; clusterMarkers: Models.ImageData.Marker[] } {
	if (!visibleMarkers) return { overlapped: [], clusterMarkers: [] };
	const q = visibleMarkers;
	const S: number[][] = [];
	const l = q.length;
	const overlappedIndices: number[] = [];
	for (let i = 0; i < l; i++) for (let j = i + 1; j < l; j++) {
		if (q[j].tags?.includes('no-cluster')) continue;
		const c1 = coords.get(q[i].id), c2 = coords.get(q[j].id);
		if (c1 && c2 && overlaps(c1, c2, r)) {
			overlappedIndices.push(i, j);
			const existing = S.find(c => c.findIndex(n => n == i || n == j) > -1);
			if (existing) existing.push(i, j);
			else S.push([i, j]);
		}
	}
	const clusterMarkers = S
		.map(c => c.filter((n, i) => c.indexOf(n) === i))
		.map(c => {
			let minX: number, maxX: number, minY: number, maxY: number, centerX: number, centerY: number;
			if (isOmni) {
				centerX = c.reduce((sum, j) => sum + q[j].x, 0) / c.length;
				centerY = c.reduce((sum, j) => sum + q[j].y, 0) / c.length;
				const viewSize = 0.3;
				minX = Math.max(0, centerX - viewSize / 2);
				minY = Math.max(0, centerY - viewSize / 2);
				maxX = Math.min(1, centerX + viewSize / 2);
				maxY = Math.min(1, centerY + viewSize / 2);
			} else {
				minX = Math.min(...c.map(j => q[j].view ? q[j].view![0] : q[j].x));
				maxX = Math.max(...c.map(j => q[j].view ? q[j].view![0] + q[j].view![2] : q[j].x));
				minY = Math.min(...c.map(j => q[j].view ? q[j].view![1] : q[j].y));
				maxY = Math.max(...c.map(j => q[j].view ? q[j].view![1] + q[j].view![3] : q[j].y));
				centerX = (minX + maxX) / 2;
				centerY = (minY + maxY) / 2;
			}
			return {
				title: c.length + '',
				type: 'cluster',
				view: [minX, minY, Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY)] as Models.Camera.View,
				x: centerX, y: centerY,
				rotation: isOmni ? c.reduce((sum, j) => sum + (q[j].rotation ?? 0), 0) / c.length : undefined,
				radius: isOmni ? c.reduce((sum, j) => sum + (q[j].radius ?? 1), 0) / c.length : undefined,
				id: c.sort((a, b) => a - b).join(','),
				data: {}, popupType: 'none', tags: []
			} as Models.ImageData.Marker;
		});
	return { overlapped: overlappedIndices, clusterMarkers };
}

export class MicrioMarkers extends MicrioElement<MarkersProps> {
	static tag = 'micrio-markers';
	static styles = `micrio-markers{pointer-events:none;position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;will-change:width,height,top,left,opacity;perspective:inherit}
micrio-markers:empty{display:none}
micrio-markers>*{pointer-events:all}
micrio-markers.inactive>*{pointer-events:none}
micrio-markers.is360{transition:opacity .25s}
micrio-markers.is360.inactive{opacity:0}`;

	#props: MarkersProps = { image: null! };
	#unsubs: (() => void)[] = [];
	#coords = new Map<string, MarkerCoords>();
	#overlapped: number[] = [];
	#clusterMarkers: Models.ImageData.Marker[] = [];

	onMount() {
		const { image } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !image) return;

		const { switching, state: micrioState } = micrio;
		const grid = micrio.canvases[0]?.grid;
		const focussed = grid?.focussed;
		const gridMarkersShown = grid?.markersShown;

		// Resize markers container to viewport
		const resize = (v: Models.Camera.View) => {
			if (!v || v.length < 4) return;
			v = v.map(f => Math.round(f * 100) / 100) as Models.Camera.View;
			this.style.cssText = [
				...(!v[0] ? [] : [`left: ${v[0]}px`]),
				...(!v[1] ? [] : [`top: ${v[1]}px`]),
				`width: ${v[2]}px`,
				`height: ${v[3]}px`
			].join(';') + ';';
		};
		this.#unsubs.push(image.viewport.subscribe(resize));

		// Build or update marker/waypoint DOM
		const syncClusters = () => {
			if (!image.$settings.clusterMarkers) return;
			calcOverlapped();
			const $visible = image.$data?.markers;
			if ($visible) {
				for (let i = 0; i < $visible.length; i++) {
					const el = this.querySelector(`:scope > micrio-marker[data-marker-id="${$visible[i].id}"]`) as any;
					if (el) el.setProps?.({ overlapped: this.#overlapped.includes(i) });
				}
			}
			const clusterIds = new Set(this.#clusterMarkers.map(m => m.id));
			for (const el of this.querySelectorAll(':scope > micrio-marker.cluster')) {
				const id = el.getAttribute('data-marker-id');
				if (id && !clusterIds.has(id)) el.remove();
			}
			for (const m of this.#clusterMarkers) {
				if (!this.querySelector(`:scope > micrio-marker[data-marker-id="${m.id}"]`)) {
					createElement('micrio-marker', {
						attrs: { 'data-marker-id': m.id },
						setProps: { marker: m, image, coords: this.#coords },
						parent: this
					}) as MicrioElement;
				}
			}
		};

		// Rebuild markers when data changes
		const rebuild = () => {
			if (image.$settings.clusterMarkers) calcOverlapped();

			const $visible = image.$data?.markers;
			const $focussed = focussed ? get(focussed) : undefined;
			const $gridMarkersShown = gridMarkersShown ? get(gridMarkersShown) : undefined;
			const inactive = grid && ($focussed != image && ($gridMarkersShown && $gridMarkersShown.indexOf(image) < 0));
			const showTitles = !!(image.$settings._markers?.showTitles);

			this.classList.toggle('inactive', !!inactive);
			this.classList.toggle('show-titles', showTitles);

			// Waypoints
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

			// Markers — diff-based: keep existing, only add/remove what changed
			if ($visible) {
				const $_lang = get(micrio._lang);
				const filtered = $visible.filter(m => !m.i18n || m.i18n[$_lang]);
				const expected = new Set(filtered.map(m => m.id));
				const clusterIds = new Set(this.#clusterMarkers.map(m => m.id));

				for (const el of this.querySelectorAll(':scope > micrio-marker')) {
					const id = el.getAttribute('data-marker-id');
					if (!id) continue;
					if (clusterIds.has(id)) continue;
					if (!expected.has(id)) el.remove();
				}

				for (const m of filtered) {
					const i = $visible.indexOf(m);
					let el = this.querySelector(`:scope > micrio-marker[data-marker-id="${m.id}"]`) as MicrioElement;
					if (!el) {
						el = createElement('micrio-marker', {
							attrs: { 'data-marker-id': m.id },
							setProps: {
								marker: m, image,
								coords: this.#coords,
								overlapped: this.#overlapped.includes(i),
								...(m.noMarker ? { forceHidden: true } : {})
							},
							parent: this
						}) as unknown as MicrioElement;
					} else {
						(el as any).setProps?.({ overlapped: this.#overlapped.includes(i) });
					}
				}

				// Cluster markers
				for (const m of this.#clusterMarkers) {
					if (!this.querySelector(`:scope > micrio-marker[data-marker-id="${m.id}"]`)) {
						createElement('micrio-marker', {
							attrs: { 'data-marker-id': m.id },
							setProps: { marker: m, image, coords: this.#coords },
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
		};

		const calcOverlapped = () => {
			if (!image.$settings.clusterMarkers) return;
			const filtered = image.$data?.markers?.filter(m => !m.i18n || m.i18n[get(micrio._lang)]);
			if (filtered) {
				for (const m of filtered) {
					const xy = image.camera.getXYDirect(m.x, m.y, {
						radius: m.radius, rotation: m.rotation
					});
					this.#coords.set(m.id, [xy[0], xy[1], 0, 0]);
				}
			}
			const result = calcClusters(
				filtered,
				this.#coords,
				image.$settings.clusterMarkerRadius ?? 16,
				image.isOmni
			);
			this.#overlapped = result.overlapped;
			this.#clusterMarkers = result.clusterMarkers;
		};

		this.watchLater(image.data, rebuild);
		this.watchLater(switching, rebuild);
		if (micrioState.tour) this.watchLater(micrioState.tour, rebuild);
		this.watchLazy(micrio._lang, rebuild);

		if (image.$settings.clusterMarkers) {
			this.#unsubs.push(image.state.view.subscribe(syncClusters));
		}

		if (image.is360) this.classList.add('is360');

		// Fly back to previous view when a marker closes
		if (!image.grid && image.$settings._markers?.zoomOutAfterClose) {
			let wasVideoTour = false;
			this.#unsubs.push(image.state.marker.subscribe(m => {
				if (m && typeof m != 'string' && !image.openedView && !m.noMarker && m.view) {
					image.openedView = get(micrio.state.tour) && !('steps' in get(micrio.state.tour)!) ? undefined
						: clone(image.state.$view ?? image.camera?.getView());
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
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMarkers.tag, MicrioMarkers);
