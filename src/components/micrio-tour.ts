import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';
import { get } from '$ts/store';
import './micrio-button';
import './micrio-media';

export interface TourProps {
	tour: Models.ImageData.MarkerTour | Models.ImageData.VideoTour;
	noHTML?: boolean;
	onminimize?: (b: boolean) => void;
}

export class MicrioTour extends MicrioElement<TourProps> {
	static tag = 'micrio-tour';
	static styles = '';

	#props: TourProps = { tour: null! };
	#unsubs: (() => void)[] = [];

	onMount() {
		const { tour } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !tour) return;

		const isVideoTour = !('steps' in tour);
		const isMarkerTour = 'steps' in tour;
		const isSerialTour = isMarkerTour && (tour as any).isSerialTour;

		if (isVideoTour) {
			const vt = tour as Models.ImageData.VideoTour;
			const src = (vt as any).i18n?.[get(micrio._lang)]?.src;
			if (src) {
				const media = document.createElement('micrio-media') as any;
				media.setProps({ src, tour: vt, controls: true, autoplay: true });
				this.appendChild(media);
			}
			// Set micrio state to mark tour as active
			micrio.setAttribute('data-tour-active', '');
		}

		if (isSerialTour) {
			// TODO: full serial tour component
		}

		if (isMarkerTour && !isSerialTour) {
			// Standard marker tour: listen to step changes
			const mt = tour as Models.ImageData.MarkerTour;
			if (!mt.currentStep) mt.currentStep = 0;
		}

		this.#unsubs.push(micrio.state.tour.subscribe(t => {
			if (!t) {
				micrio.removeAttribute('data-tour-active');
			}
		}));
	}

	setProps(props: Partial<TourProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioTour.tag, MicrioTour);
