import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
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
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !image) return;

		const { switching, state: micrioState } = micrio;
		const grid = micrio.canvases[0]?.grid;
		const focussed = grid?.focussed;
		const gridMarkersShown = grid?.markersShown;

		// Resize markers container to viewport
		const resize = (v: Models.Camera.View) => {
			v = v?.map(f => Math.round(f * 100) / 100) as Models.Camera.View;
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
			const showTitles = !!(image.$settings._markers as any)?.showTitles;

			this.classList.toggle('inactive', !!inactive);
			this.classList.toggle('show-titles', showTitles);

			// Remove all existing child markers/waypoints
			this.innerHTML = '';

			if (inactive) return;

			// Waypoints
			const $switching = get(switching);
			if (!$switching && micrio.spaceData) {
				const waypoints = micrio.spaceData.links
					.filter((l: any) => l[0] == image.id || l[1] == image.id)
					.map((l: any) => ({ targetId: l[0] == image.id ? l[1] : l[0], settings: l[2]?.[image.id] }));
				for (const wp of waypoints) {
					const el = document.createElement('micrio-waypoint') as any;
					el.setProps({ ...wp, image });
					this.appendChild(el);
				}
			}

			// Visible markers
			if ($visible) {
				const visibleMarkers = $visible.filter(m => !m.noMarker);
				for (const m of visibleMarkers) {
					const el = document.createElement('micrio-marker') as any;
					el.setProps({ marker: m, image });
					this.appendChild(el);
				}
			}
		};

		this.#unsubs.push(image.data.subscribe(rebuild));
		this.#unsubs.push(switching.subscribe(rebuild));
		if (micrioState.tour) this.#unsubs.push(micrioState.tour.subscribe(rebuild));

		if (image.is360) this.classList.add('is360');

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
