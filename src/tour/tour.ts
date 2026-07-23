import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { i18n } from '$core/i18n/strings';
import { DataLoader } from '$utils/dataLoader';
import '$ui/button';
import '$media/media';

export interface TourProps {
	tour: Models.ImageData.MarkerTour | Models.ImageData.VideoTour;
	noHTML?: boolean;
	onminimize?: (b: boolean) => void;
}
import './tour.css';

export class MicrioTour extends MicrioElement<TourProps> {
	static tag = 'micrio-tour';

	#props: TourProps = { tour: null! };
	#currentStep = 0;
	aside: HTMLElement | undefined;

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
				createElement('micrio-media', {
					parent: this,
					setProps: { src: audio?.src, image, tour: vt, controls: true, autoplay: true, fullscreenEl: micrio, onclose: () => micrio.state.tour.set(undefined) }
				});
			}
		}

		if (isMarkerTour) {
			const mt = tour as Models.ImageData.MarkerTour;
			mt.currentStep ??= mt.initialStep ?? 0;
			this.#currentStep = mt.currentStep;
			const stepInfo = mt.stepInfo as Models.ImageData.MarkerTourStepInfo[] | undefined;
			const tourControlsInPopup = !!micrio.$current!.$settings?._markers?.tourControlsInPopup;

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

			if(!this.aside) {
				this.aside = createElement('aside',{
					className: 'marker-tour',
					parent: tourControlsInPopup ? undefined : this
				});
			}

			const renderControls = () => {
				if(!this.aside) return;
				this.aside.replaceChildren();

				createElement('micrio-button', {
					parent: this.aside,
					setProps: {
						type: 'prev', title: get(i18n)._tourStepPrev,
						disabled: this.#currentStep === 0,
						onclick: () => mt.prev?.()
					}
				});

				createElement('span', {
					textContent: `${this.#currentStep + 1}/${mt.steps.length}`,
					parent: this.aside
				});

				createElement('micrio-button', {
					parent: this.aside,
					setProps: {
						type: 'next', title: get(i18n)._tourStepNext,
						disabled: this.#currentStep >= mt.steps.length - 1,
						onclick: () => mt.next?.()
					}
				});

				if (!mt.cannotClose) {
					const close = createElement('micrio-button', {
						parent: this.aside,
						setProps: {
							type: 'close', title: get(i18n)._close,
							onclick: () => micrio.state.tour.set(undefined)
						}
					});
					// Buttons in marker-popup -- put close button first
					if(tourControlsInPopup) {
						this.aside.insertBefore(close, this.aside.firstChild);
					}
				}
			};

			this.addCleanup(micrio.state.marker.subscribe(m => {
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

		this.addCleanup(micrio.state.tour.subscribe(t => {
			if (!t && isMarkerTour) {
				const mt = tour as Models.ImageData.MarkerTour;
				const si = (mt.stepInfo as Models.ImageData.MarkerTourStepInfo[] | undefined)?.[this.#currentStep];
				if (si) {
					const img = micrio.canvases?.find((c: MicrioImage) => c.id === si.micrioId);
					if (img) img.state.marker.set(undefined);
				}
			}
		}));
	}

	setProps(props: Partial<TourProps>) {
		Object.assign(this.#props, props);
	}

}

customElements.define(MicrioTour.tag, MicrioTour);
