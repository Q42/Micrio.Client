import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { i18n } from '$core/i18n/strings';
import { afterFrame, createElement } from '$utils/dom';
import '$ui/button';
import '$ui/button-group';
import './marker-content';

export interface MarkerPopupProps {
	marker: Models.ImageData.Marker;
}
import './marker-popup.css';

class MicrioMarkerPopup extends MicrioElement<MarkerPopupProps> {
	static tag = 'micrio-marker-popup';

	#props: MarkerPopupProps = { marker: null! };
	#content!: HTMLElement;
	#title!: HTMLElement;
	#isMinimized = false;
	#destroying = false;
	#clickedPrevNext = false;
	#originalHeights = new WeakMap<HTMLElement, number>();

	onMount() {
		const { marker } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !marker) return;

		marker.tags?.forEach(c => this.classList.add(c));
		afterFrame().then(() => this.querySelector('button')?.focus());

		this.addCleanup(micrio.state.popup.subscribe(m => {
			this.#destroying = !m || m != marker;
			this.classList.toggle('destroying', this.#destroying);
		}));

		this.addEventListener('transitionend', e => {
			if ((e as TransitionEvent).target === this && this.#destroying) this.remove();
		});

		this.#render();
	}

	setProps(props: Partial<MarkerPopupProps>) {
		if (props.marker !== undefined && props.marker.id !== this.#props.marker?.id) {
			this.#props.marker = props.marker;
			if (this.isConnected) this.#render();
		}
	}

	#render() {
		const { marker } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !marker) return;

		const markerImages = MicrioElement.markerImages as Map<string, MicrioImage>;
		const image = marker.id ? markerImages.get(marker.id) as MicrioImage : undefined;
		if (!image) return;

		const $tour = get(micrio.state.tour);
		const $current = get(micrio.current);
		const $i18n = get(i18n);
		const settings = image.$settings._markers ?? {};
		const data = marker.data || {};
		const canMinimize = settings.canMinimizePopup;

		const markerTour = $tour && 'steps' in $tour ? $tour as Models.ImageData.MarkerTour & { next?(): void; prev?(): void } : undefined;
		const tourSourceImage = markerTour ? micrio.canvases.find((c: MicrioImage) =>
			c.$data?.markerTours?.find((t: any) => t.id === markerTour.id)
		) : undefined;
		const tsSettings = tourSourceImage?.$settings._markers;
		const isPartOfTour = markerTour && markerTour.steps?.findIndex((s: string) => s.startsWith(marker.id)) >= 0;
		const showTourControls = isPartOfTour && !markerTour?.isSerialTour &&
			(tsSettings?.tourControlsInPopup ?? settings.tourControlsInPopup);
		const showTourStepCounter = isPartOfTour && !markerTour?.isSerialTour &&
			(tsSettings?.tourStepCounterInPopup ?? settings.tourStepCounterInPopup);
		const currentTourStep = markerTour?.currentStep ?? -1;
		const closeButtonStopsTour = showTourControls || (markerTour ? markerTour.currentStep == markerTour.steps.length - 1 : undefined);
		const isLastStep = markerTour ? markerTour.currentStep == markerTour.steps.length - 1 : false;

		const close = (e?: Event) => {
			if ($tour && isPartOfTour && 'steps' in $tour) {
				if (e instanceof Event && closeButtonStopsTour) {
					micrio.state.tour.set(undefined);
				} else {
					($tour as Models.ImageData.MarkerTour & { next?(): void }).next?.();
				}
			} else {
				if ($current && $current.id != image.id && data.micrioLink?.id == $current.id) {
					micrio.open(image.id);
					image.state.marker.set(undefined);
					micrio.state.popup.set(undefined);
				} else {
					image.state.marker.set(undefined);
				}
			}
		};

		const markerTourStep = (goPrev: boolean = false) => {
			if (!markerTour) return;
			if (goPrev) markerTour.prev?.();
			else markerTour.next?.();
			this.#clickedPrevNext = true;
			setTimeout(() => this.#clickedPrevNext = false, 200);
		};

		const toggleMinimize = () => {
			this.#isMinimized = !this.#isMinimized;
			this.classList.toggle('minimized', this.#isMinimized);
			if (this.#content) {
				for (let i = 0; i < this.#content.children.length; i++) {
					const n = this.#content.children[i] as HTMLElement;
					if (n && n !== this.#title) {
						if (!this.#originalHeights.has(n)) {
							this.#originalHeights.set(n, n.offsetHeight);
							n.style.height = n.offsetHeight + 'px';
						}
						setTimeout(() => {
							n.style.height = this.#isMinimized ? '0px' : this.#originalHeights.get(n)! + 'px';
						}, 100);
					}
				}
			}
		};

		this.replaceChildren();

		const aside = createElement('aside');

		if (!data.alwaysOpen) {
			createElement('micrio-button', {
				setProps: {
					type: (!isPartOfTour || closeButtonStopsTour) ? 'close' : 'next',
					title: (!isPartOfTour || closeButtonStopsTour) ? $i18n.closeMarker : $i18n.tourStepNext,
					disabled: this.#clickedPrevNext,
					onclick: close
				},
				parent: aside
			});
		}

		if (canMinimize) {
			createElement('micrio-button', {
				setProps: {
					type: this.#isMinimized ? 'up' : 'down',
					title: $i18n.minimize,
					onclick: toggleMinimize
				},
				parent: aside
			});
		}

		if (showTourControls && $tour && 'steps' in $tour) {
			createElement('progress', {
				attrs: { 'aria-hidden': 'true' },
				props: { value: (currentTourStep + 1) / $tour.steps.length },
				parent: aside
			});

			const group = createElement('micrio-button-group');

			createElement('micrio-button', {
				setProps: {
					type: 'prev',
					disabled: this.#clickedPrevNext || currentTourStep == 0,
					title: $i18n.tourStepPrev,
					onclick: () => markerTourStep(true)
				},
				parent: group
			});

			if (showTourStepCounter) {
				createElement('micrio-button', {
					setProps: {
						disabled: true,
					},
					children: [`${currentTourStep + 1} / ${$tour.steps.length}`],
					parent: group
				});
			}

			createElement('micrio-button', {
				setProps: {
					type: 'next',
					disabled: this.#clickedPrevNext || isLastStep,
					title: $i18n.tourStepNext,
					onclick: () => markerTourStep()
				},
				parent: group
			});
			aside.appendChild(group);
		}

		this.appendChild(aside);

		this.#content = createElement('micrio-marker-content', {
			setProps: { marker, onclose: close },
			parent: this
		});
	}

}

customElements.define(MicrioMarkerPopup.tag, MicrioMarkerPopup);
