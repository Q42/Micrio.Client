import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import { clone } from '$ts/utils/object';
import './micrio-marker';
import './micrio-waypoint';

export interface MarkersProps {
	image: MicrioImage;
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

		// Rebuild markers when data changes
		const rebuild = () => {
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
						el = document.createElement('micrio-waypoint') as MicrioElement;
						el.setAttribute('data-target-id', id);
						el.setProps({ targetId: id, settings: l[2]?.[image.id], image });
						this.appendChild(el);
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

				for (const el of this.querySelectorAll(':scope > micrio-marker')) {
					if (!expected.has(el.getAttribute('data-marker-id') ?? '')) el.remove();
				}

				for (const m of filtered) {
					let el = this.querySelector(`:scope > micrio-marker[data-marker-id="${m.id}"]`) as MicrioElement;
					if (!el) {
						el = document.createElement('micrio-marker') as MicrioElement;
						el.setAttribute('data-marker-id', m.id);
						el.setProps({ marker: m, image, ...(m.noMarker ? { forceHidden: true } : {}) });
						this.appendChild(el);
					}
				}
			} else {
				for (const el of this.querySelectorAll(':scope > micrio-marker')) el.remove();
			}

			if (inactive) {
				for (const el of this.querySelectorAll(':scope > micrio-marker, :scope > micrio-waypoint')) el.remove();
			}
		};

		this.watchLater(image.data, rebuild);
		this.watchLater(switching, rebuild);
		if (micrioState.tour) this.watchLater(micrioState.tour, rebuild);
		this.watchLazy(micrio._lang, rebuild);

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
