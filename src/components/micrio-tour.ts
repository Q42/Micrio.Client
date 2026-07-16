import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import { DataLoader } from '$ts/utils/dataLoader';
import './micrio-button';
import '$media/media';

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
		const micrio = this.getMicrio();
		if (!micrio || !tour) return;

		const isVideoTour = !('steps' in tour);
		const isMarkerTour = 'steps' in tour;

		if (isVideoTour) {
			const vt = tour as Models.ImageData.VideoTour;
			const image = micrio.$current;
			if (image) {
				const audio = vt.i18n?.[get(micrio._lang)]?.audio;
				const media = document.createElement('micrio-media') as MicrioElement;
				media.setProps({ src: audio?.src, image, tour: vt, controls: true, autoplay: true, onclose: () => micrio.state.tour.set(undefined) });
				this.appendChild(media);
			}
			micrio.setAttribute('data-tour-active', '');
		}

		if (isMarkerTour) {
			const mt = tour as Models.ImageData.MarkerTour;
			mt.currentStep ??= mt.initialStep ?? 0;
			this.#currentStep = mt.currentStep;
			const stepInfo = mt.stepInfo as Models.ImageData.MarkerTourStepInfo[] | undefined;

			const openStep = async (prevIdx: number, newIdx: number) => {
				const si = stepInfo?.[newIdx];
				if (!si) return;

				// Clear previous step's marker before navigating
				const prevSi = stepInfo?.[prevIdx];
				if (prevSi?.micrioId) {
					const prevImg = micrio.canvases?.find((c: MicrioImage) => c.id === prevSi.micrioId);
					if (prevImg && get(prevImg.state.marker)) prevImg.state.marker.set(undefined);
				}

				// If the new step has a video tour, use its first timeline viewport as the start view
				let startView: Models.Camera.View | undefined;
				const marker = DataLoader.getStepMarker(si);
				if (marker?.videoTour) {
					const lang = micrio.lang;
					const vt = marker.videoTour;
					const timeline = vt.i18n?.[lang]?.timeline;
					if (timeline?.length) startView = timeline[0].rect;
				}

				const img = si.micrioId && micrio.$current?.id !== si.micrioId
					? await micrio.open(si.micrioId, { startView })
					: micrio.$current;
				if (img) img.state.marker.set(si.markerId);
			};

			mt.next = () => {
				if (this.#currentStep < mt.steps.length - 1) {
					const prev = this.#currentStep;
					this.#currentStep++;
					mt.currentStep = this.#currentStep;
					openStep(prev, this.#currentStep);
					renderControls();
				}
			};

			mt.prev = () => {
				if (this.#currentStep > 0) {
					const prev = this.#currentStep;
					this.#currentStep--;
					mt.currentStep = this.#currentStep;
					openStep(prev, this.#currentStep);
					renderControls();
				}
			};

			const renderControls = () => {
				this.replaceChildren();

				const div = document.createElement('div');
				div.className = 'controls';

				const prevBtn = document.createElement('micrio-button') as MicrioElement;
				prevBtn.setProps({
					type: 'arrow-left', title: get(i18n).tourStepPrev,
					disabled: this.#currentStep === 0,
					onclick: () => mt.prev?.()
				});
				div.appendChild(prevBtn);

				const counter = document.createElement('span');
				counter.className = 'step-counter';
				counter.textContent = `${this.#currentStep + 1} / ${mt.steps.length}`;
				div.appendChild(counter);

				const nextBtn = document.createElement('micrio-button') as MicrioElement;
				nextBtn.setProps({
					type: 'arrow-right', title: get(i18n).tourStepNext,
					disabled: this.#currentStep >= mt.steps.length - 1,
					onclick: () => mt.next?.()
				});
				div.appendChild(nextBtn);

				if (!mt.cannotClose) {
					const closeBtn = document.createElement('micrio-button') as MicrioElement;
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

			openStep(-1, this.#currentStep);
			renderControls();
		}

		this.#unsubs.push(micrio.state.tour.subscribe(t => {
			if (!t) {
				micrio.removeAttribute('data-tour-active');
				if (isMarkerTour) {
					const mt = tour as Models.ImageData.MarkerTour;
					const si = (mt.stepInfo as Models.ImageData.MarkerTourStepInfo[] | undefined)?.[this.#currentStep];
					if (si) {
						const img = micrio.canvases?.find((c: MicrioImage) => c.id === si.micrioId);
						if (img) img.state.marker.set(undefined);
					}
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
