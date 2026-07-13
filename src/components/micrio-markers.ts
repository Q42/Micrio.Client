import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
	import { get } from '$ts/store';
import './micrio-marker';
import './micrio-waypoint';

type MarkerData = Models.ImageData.Marker;
type MarkerCoords = [x: number, y: number, w?: number, h?: number];

function overlaps([x0, y0, w0 = 0, h0 = 0]: MarkerCoords, [x1, y1, w1 = 0, h1 = 0]: MarkerCoords, r: number): boolean {
	const rY0 = Math.max(h0 / 2, r);
	const rY1 = Math.max(h1 / 2, r);
	return !(x0 + w0 + r < x1 - r || x0 - r > x1 + w1 + r || y0 + rY0 < y1 - rY1 || y0 - rY0 > y1 + rY1);
}

function calcClusters(visibleMarkers: MarkerData[] | undefined, coords: Map<string, MarkerCoords>, r: number, isOmni: boolean) {
	if (!visibleMarkers) return { overlapped: [] as number[], clusterMarkers: [] as MarkerData[] };
	const q = visibleMarkers;
	const S: number[][] = [];
	const overlappedIndices: number[] = [];
	for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
		if (q[j].tags?.includes('no-cluster')) continue;
		const c1 = coords.get(q[i].id), c2 = coords.get(q[j].id);
		if (c1 && c2 && overlaps(c1, c2, r)) {
			overlappedIndices.push(i, j);
			const existing = S.find(c => c.findIndex(n => n == i || n == j) > -1);
			if (existing) { existing.push(i, j); }
			else { S.push([i, j]); }
		}
	}
	const clusterMarkers = S.map(c => [...new Set(c)])
		.map(c => {
			const minX = isOmni ? 0 : Math.min(...c.map(j => q[j].view ? q[j].view![0] : q[j].x));
			const maxX = isOmni ? 1 : Math.max(...c.map(j => q[j].view ? q[j].view![0] + q[j].view![2] : q[j].x));
			const minY = isOmni ? 0 : Math.min(...c.map(j => q[j].view ? q[j].view![1] : q[j].y));
			const maxY = isOmni ? 1 : Math.max(...c.map(j => q[j].view ? q[j].view![1] + q[j].view![3] : q[j].y));
			const centerX = (minX + maxX) / 2;
			const centerY = (minY + maxY) / 2;
			return {
				title: c.length + '', type: 'cluster',
				view: [minX, minY, Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY)] as Models.Camera.View,
				x: centerX, y: centerY,
				id: c.sort((a, b) => a - b).join(','),
				data: {}, popupType: 'none' as const, tags: []
			} as MarkerData;
		});
	return { overlapped: overlappedIndices, clusterMarkers };
}

export interface MarkersProps {
	image: MicrioImage;
}

export class MicrioMarkers extends MicrioElement<MarkersProps> {
	static tag = 'micrio-markers';
	static styles = `micrio-markers{pointer-events:none;position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;will-change:width,height,top,left,opacity;perspective:inherit}
micrio-markers:empty{display:none}
micrio-markers>:global(*){pointer-events:all}
micrio-markers.inactive>:global(*){pointer-events:none}
micrio-markers.is360{transition:opacity .25s}
micrio-markers.is360.inactive{opacity:0}`;

	#props: MarkersProps = { image: null! };
	#unsubs: (() => void)[] = [];
	#overlapped: number[] = [];
	#clusterMarkers: MarkerData[] = [];
	#coords = new Map<string, MarkerCoords>();
	#container!: HTMLElement;
	onMount() {
		const { image } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !image) return;

		const { switching, state: micrioState } = micrio;
		const markerSettings: Models.ImageInfo.MarkerSettings = image.$settings._markers ?? {};
		const grid = micrio.canvases[0]?.grid;
		const focussed = grid?.focussed;
		const gridMarkersShown = grid?.markersShown;

		const cR = image.$settings.clusterMarkerRadius ?? 16;

		const limitView = (v: Models.Camera.View): Models.Camera.View => {
			const width = Math.min(1, v[2]), height = Math.min(1, v[3]);
			const halfW = width / 2, halfH = height / 2;
			const cx = Math.max(halfW, Math.min(1 - halfW, v[0] + v[2] / 2));
			const cy = Math.max(halfH, Math.min(1 - halfH, v[1] + v[3] / 2));
			return [cx - halfW, cy - halfH, width, height];
		};

		let wasMarkerVideoTour = false;
		const setOpenedView = (m: MarkerData | string | undefined) => {
			if (m && typeof m != 'string' && !image.openedView && !m.noMarker && m.view) {
				image.openedView = micrio.state.$tour && !('steps' in micrio.state.$tour!) ? undefined : m.view;
				wasMarkerVideoTour = !!m.videoTour;
			} else if (!m && image.openedView && !micrio.state.$tour) {
				setTimeout(() => {
					if (!image.camera.aniDone && image.openedView)
						image.camera.flyToView(limitView(image.openedView), { speed: markerSettings.zoomOutAfterCloseSpeed }).catch(() => { });
					image.openedView = undefined;
				}, wasMarkerVideoTour ? 250 : 10);
			}
		};

		let wasMarkerTour = false;
		this.#unsubs.push(micrioState.tour.subscribe((t: any) => {
			if (t && 'steps' in t) { wasMarkerTour = true; if (t.keepLastStep) image.openedView = undefined; }
			else { if (!t && !image.openedView && wasMarkerTour) image.camera.stop(); wasMarkerTour = false; }
		}));

		// Container for markers
		this.#container = document.createElement('div');
		// style is set in resize
		this.appendChild(this.#container);

		// Re-render markers on data/view changes
		const renderMarkers = () => {
			const $visible = image.$data?.markers;
			const $focussed = focussed ? get(focussed) : undefined;
			const $gridMarkersShown = gridMarkersShown ? get(gridMarkersShown) : undefined;

			const inactive = grid && ($focussed != image && ($gridMarkersShown && $gridMarkersShown.indexOf(image) < 0));
			const visibleMarkers = inactive ? [] : $visible?.filter(m => !m.noMarker) ?? [];

			const r = cR;
			const result = calcClusters(visibleMarkers, this.#coords, r, image.isOmni);
			this.#overlapped = result.overlapped;
			this.#clusterMarkers = result.clusterMarkers;

			this.#container.classList.toggle('inactive', !!inactive);

			// Rebuild marker/waypoint elements
			const existing = this.#container.querySelectorAll(':scope > micrio-marker, :scope > micrio-waypoint');
			existing.forEach(el => el.remove());

			// Waypoints
			const $switching = get(switching);
			if (!inactive && !$switching && micrio.spaceData) {
				const waypoints = micrio.spaceData.links
					.filter((l: any) => l[0] == image.id || l[1] == image.id)
					.map((l: any) => ({ targetId: l[0] == image.id ? l[1] : l[0], settings: l[2]?.[image.id] }));
				for (const wp of waypoints) {
					const el = document.createElement('micrio-waypoint') as any;
					el.setProps({ ...wp, image });
					this.#container.appendChild(el);
				}
			}

			// Visible markers
			for (let i = 0; i < visibleMarkers.length; i++) {
				const m = visibleMarkers[i];
				const el = document.createElement('micrio-marker') as any;
				el.setProps({ marker: m, image, coords: this.#coords, overlapped: this.#overlapped.includes(i) });
				this.#container.appendChild(el);
			}

			// Cluster markers
			for (const m of this.#clusterMarkers) {
				const el = document.createElement('micrio-marker') as any;
				el.setProps({ marker: m, image });
				this.#container.appendChild(el);
			}
		};

		// Subscribe to view changes for clustering/side labels
		const resize = (v: Models.Camera.View) => {
			v = v?.map(f => Math.round(f * 100) / 100) as Models.Camera.View;
			this.#container.style.cssText = [
				...(!v[0] ? [] : [`left: ${v[0]}px`]),
				...(!v[1] ? [] : [`top: ${v[1]}px`]),
				`width: ${v[2]}px`,
				`height: ${v[3]}px`
			].join(';') + ';';
		};

		this.#unsubs.push(image.viewport.subscribe(resize));

		if (image.$settings.clusterMarkers) {
			this.#unsubs.push(image.state.view.subscribe(() => this.#coords.clear()));
			this.#unsubs.push(image.state.view.subscribe(renderMarkers));
			this.#unsubs.push(image.data.subscribe(() => setTimeout(renderMarkers, 0)));
		}

		this.#unsubs.push(image.data.subscribe(renderMarkers));
		this.#unsubs.push(switching.subscribe(renderMarkers));

		if (micrio.state.tour) this.#unsubs.push(micrio.state.tour.subscribe(renderMarkers));

		if (markerSettings.zoomOutAfterClose) {
			this.#unsubs.push(image.state.marker.subscribe(setOpenedView));
		}

		// Initially mark as 360 if applicable
		if (image.is360) this.#container.classList.add('is360');

		renderMarkers();
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
