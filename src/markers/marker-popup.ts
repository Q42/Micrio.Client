import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import type { MicrioTour } from '$tour/tour';
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

	_onMount() {
		const { marker } = this.#props;
		const micrio = this._getMicrio();
		if (!micrio || !marker) return;

		marker.tags?.forEach(c => this.classList.add(c));
		afterFrame().then(() => (this.querySelector('micrio-button:last-child > button') as HTMLElement)?.focus());

		this._addCleanup(micrio.state.popup.subscribe(m => {
			this.#destroying = !m || m != marker;
			this.classList.toggle('destroying', this.#destroying);
		}));

		this.addEventListener('transitionend', e => {
			if ((e as TransitionEvent).target === this && this.#destroying) this.remove();
		});

		this.#render();
	}

	_setProps(props: Partial<MarkerPopupProps>) {
		if (props.marker !== undefined && props.marker.id !== this.#props.marker?.id) {
			this.#props.marker = props.marker;
			if (this.isConnected) this.#render();
		}
	}

	#render() {
		const { marker } = this.#props;
		const micrio = this._getMicrio();
		if (!micrio || !marker) return;

		const markerImages = MicrioElement._markerImages as Map<string, MicrioImage>;
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
			(micrio.canvas.$isMobile || (tsSettings?.tourControlsInPopup ?? settings.tourControlsInPopup));
		const closeButtonStopsTour = showTourControls || (markerTour ? markerTour.currentStep == markerTour.steps.length - 1 : undefined);

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

		if (!showTourControls) {
			const aside = createElement('aside');

			if (!data.alwaysOpen) {
				createElement('micrio-button', {
					setProps: {
						type: (!isPartOfTour || closeButtonStopsTour) ? 'close' : 'next',
						title: (!isPartOfTour || closeButtonStopsTour) ? $i18n._closeMarker : $i18n._tourStepNext,
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
						title: $i18n._minimize,
						onclick: toggleMinimize
					},
					parent: aside
				});
			}

			this.appendChild(aside);
		}

		this.#content = createElement('micrio-marker-content', {
			setProps: { marker, onclose: close },
			parent: this
		});

		if (showTourControls) {
			requestAnimationFrame(() => {
				const tourAside = (document.querySelector('micrio-tour') as MicrioTour)?.aside;
				if (tourAside && !this.contains(tourAside)) {
					this.appendChild(tourAside);
				}
			});
		}
	}

}

customElements.define(MicrioMarkerPopup.tag, MicrioMarkerPopup);
