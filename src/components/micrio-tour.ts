import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import './micrio-button';
import './micrio-media';

export interface TourProps {
	tour: Models.ImageData.MarkerTour | Models.ImageData.VideoTour;
	noHTML?: boolean;
	onminimize?: (b: boolean) => void;
}

export class MicrioTour extends MicrioElement<TourProps> {
	static tag = 'micrio-tour';
	static styles = `micrio-tour{display:contents}
micrio-tour .controls{position:absolute;bottom:var(--micrio-border-margin);left:50%;max-width:calc(100% - var(--micrio-border-margin) * 2);transform:translateX(-50%);box-sizing:border-box;display:flex;border-radius:var(--micrio-border-radius);box-shadow:var(--micrio-button-shadow);backdrop-filter:var(--micrio-background-filter);background-color:var(--micrio-button-background,var(--micrio-background,none));padding:0;transition:transform .2s ease;z-index:5}
micrio-tour .controls>micrio-button{--micrio-button-background:none;--micrio-background-filter:none;--micrio-button-shadow:none;margin:0;border:none;border-radius:0}
micrio-tour .controls .step-counter{height:var(--micrio-button-size);line-height:var(--micrio-button-size);padding:0 12px;font-size:90%;cursor:default;font-family:inherit;background:transparent;border:none;color:var(--micrio-color);display:flex;align-items:center}`;

	#props: TourProps = { tour: null! };
	#unsubs: (() => void)[] = [];
	#currentStep = 0;

	onMount() {
		const { tour } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !tour) return;

		const isVideoTour = !('steps' in tour);
		const isMarkerTour = 'steps' in tour;

		if (isVideoTour) {
			const vt = tour as Models.ImageData.VideoTour;
			const image = micrio.$current;
			if (image) {
				const audio = (vt as any).i18n?.[get(micrio._lang)]?.audio;
				const media = document.createElement('micrio-media') as any;
				media.setProps({ src: audio?.src, image, tour: vt, controls: true, autoplay: true });
				this.appendChild(media);
			}
			micrio.setAttribute('data-tour-active', '');
		}

		if (isMarkerTour) {
			const mt = tour as Models.ImageData.MarkerTour;
			mt.currentStep ??= mt.initialStep ?? 0;
			this.#currentStep = mt.currentStep;

			const markerImages = MicrioElement.markerImages as Map<string, MicrioImage>;

			const openStep = (idx: number) => {
				const stepId = mt.steps[idx];
				const img = markerImages.get(stepId);
				if (img) img.state.marker.set(stepId);
			};

			const renderControls = () => {
				this.replaceChildren();

				const div = document.createElement('div');
				div.className = 'controls';

				const prevBtn = document.createElement('micrio-button') as any;
				prevBtn.setProps({
					type: 'arrow-left', title: get(i18n).tourStepPrev,
					disabled: this.#currentStep === 0,
					onclick: () => {
						if (this.#currentStep > 0) {
							this.#currentStep--;
							mt.currentStep = this.#currentStep;
							openStep(this.#currentStep);
							renderControls();
						}
					}
				});
				div.appendChild(prevBtn);

				const counter = document.createElement('span');
				counter.className = 'step-counter';
				counter.textContent = `${this.#currentStep + 1} / ${mt.steps.length}`;
				div.appendChild(counter);

				const nextBtn = document.createElement('micrio-button') as any;
				nextBtn.setProps({
					type: 'arrow-right', title: get(i18n).tourStepNext,
					disabled: this.#currentStep >= mt.steps.length - 1,
					onclick: () => {
						if (this.#currentStep < mt.steps.length - 1) {
							this.#currentStep++;
							mt.currentStep = this.#currentStep;
							openStep(this.#currentStep);
							renderControls();
						}
					}
				});
				div.appendChild(nextBtn);

				if (!(mt as any).cannotClose) {
					const closeBtn = document.createElement('micrio-button') as any;
					closeBtn.setProps({
						type: 'close', title: get(i18n).close,
						onclick: () => micrio.state.tour.set(undefined)
					});
					div.appendChild(closeBtn);
				}

				this.appendChild(div);
			};

			this.#unsubs.push(micrio.state.marker.subscribe(m => {
				if (!m) return;
				const id = typeof m == 'string' ? m : m.id;
				const idx = mt.steps.findIndex(s => s.startsWith(id));
				if (idx >= 0 && idx !== this.#currentStep) {
					this.#currentStep = idx;
					mt.currentStep = idx;
					renderControls();
				}
			}));

			openStep(this.#currentStep);
			renderControls();
		}

		this.#unsubs.push(micrio.state.tour.subscribe(t => {
			if (!t) {
				micrio.removeAttribute('data-tour-active');
				if (isMarkerTour) {
					const mt = tour as Models.ImageData.MarkerTour;
					const markerImages = MicrioElement.markerImages as Map<string, MicrioImage>;
					const stepId = mt.steps[this.#currentStep];
					const img = markerImages.get(stepId);
					if (img) img.state.marker.set(undefined);
				}
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
