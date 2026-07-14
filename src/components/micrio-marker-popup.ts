import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import './micrio-button';
import './micrio-button-group';
import './micrio-marker-content';

export interface MarkerPopupProps {
	marker: Models.ImageData.Marker;
}

export class MicrioMarkerPopup extends MicrioElement<MarkerPopupProps> {
	static tag = 'micrio-marker-popup';
	static styles = `micrio-marker-popup{display:block;cursor:auto;pointer-events:all;position:absolute;top:var(--micrio-border-margin);left:var(--micrio-border-margin)}
micrio-marker-popup.destroying{pointer-events:none}
micrio-marker-popup>main{max-height:80vh;max-height:80cqh}
micrio-marker-popup aside{padding:var(--micrio-border-margin)}
micrio-marker-popup aside progress{display:none}
@media(min-width:501px){micrio-marker-popup{width:440px;min-width:20%}micrio-marker-popup aside{position:absolute;left:100%;top:0;padding-top:0}
micrio-marker-popup aside>.micrio-button{padding:0;margin:0 0 8px 0;display:block}
}
@media(max-width:500px){micrio-marker-popup aside{position:relative;padding:0;display:flex;flex-direction:row-reverse;margin-bottom:var(--micrio-border-margin);align-items:center}
micrio-marker-popup aside progress{display:block;flex:1;opacity:0;pointer-events:none}
micrio-marker-popup aside .micrio-tour-controls{margin-bottom:0!important;display:flex}
micrio-marker-popup aside .micrio-button{display:block!important;height:var(--micrio-button-size);padding:0!important;margin:0 0 0 8px}
micrio-marker-popup{width:auto;right:var(--micrio-border-margin);display:flex;bottom:calc(var(--micrio-button-size) + 2 * var(--micrio-border-margin));flex-direction:column;justify-content:space-between}
micrio-marker-popup>main{max-height:40vh}
}
button.tour-step{height:auto;line-height:normal;vertical-align:middle;cursor:default}`;

	#props: MarkerPopupProps = { marker: null! };
	#unsubs: (() => void)[] = [];
	#content!: HTMLElement;
	#title!: HTMLElement;
	#isMinimized = false;
	#destroying = false;
	#clickedPrevNext = false;
	#originalHeights = new WeakMap<HTMLElement, number>();

	onMount() {
		const { marker } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !marker) return;

		marker.tags?.forEach(c => this.classList.add(c));
		setTimeout(() => this.querySelector('button')?.focus(), 500);

		this.#unsubs.push(micrio.state.popup.subscribe(m => {
			this.#destroying = !m || m != marker;
			this.classList.toggle('destroying', this.#destroying);
		}));

		this.#render();
	}

	setProps(props: Partial<MarkerPopupProps>) {
		if (props.marker !== undefined) this.#props.marker = props.marker;
	}

	#render() {
		const { marker } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
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

		const markerTour = $tour && 'steps' in $tour ? $tour as any : undefined;
		const tourSourceImage = markerTour ? micrio.canvases.find((c: MicrioImage) =>
			c.$data?.markerTours?.find((t: any) => t.id === markerTour.id)
		) : undefined;
		const isPartOfTour = markerTour && markerTour.steps?.findIndex((s: string) => s.startsWith(marker.id)) >= 0;
		const showTourControls = isPartOfTour && !markerTour?.isSerialTour &&
			(tourSourceImage?.$settings._markers?.tourControlsInPopup ?? settings.tourControlsInPopup);
		const showTourStepCounter = isPartOfTour && !markerTour?.isSerialTour &&
			(tourSourceImage?.$settings._markers?.tourStepCounterInPopup ?? settings.tourStepCounterInPopup);
		const currentTourStep = markerTour?.currentStep ?? -1;
		const closeButtonStopsTour = showTourControls || (markerTour ? markerTour.currentStep == markerTour.steps.length - 1 : undefined);
		const isLastStep = markerTour ? markerTour.currentStep == markerTour.steps.length - 1 : false;

		const close = (e?: Event) => {
			if ($tour && isPartOfTour && 'steps' in $tour) {
				if (e instanceof Event && closeButtonStopsTour) {
					micrio.state.tour.set(undefined);
				} else {
					($tour as any).next?.();
				}
			} else {
				if ($current && !image.opts.secondaryTo && $current.id != image.id && data.micrioLink?.id == $current.id) {
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

		const div = document.createElement('div');
		div.classList.toggle('destroying', this.#destroying);
		div.classList.toggle('minimized', this.#isMinimized);

		const aside = document.createElement('aside');

		if (!data.alwaysOpen) {
			const btn = document.createElement('micrio-button') as MicrioElement;
			btn.setProps({
				type: (!isPartOfTour || closeButtonStopsTour) ? 'close' : 'arrow-right',
				title: (!isPartOfTour || closeButtonStopsTour) ? $i18n.closeMarker : $i18n.tourStepNext,
				disabled: this.#clickedPrevNext,
				onclick: close
			});
			aside.appendChild(btn);
		}

		if (canMinimize) {
			const btn = document.createElement('micrio-button') as MicrioElement;
			btn.setProps({
				type: this.#isMinimized ? 'arrow-up' : 'arrow-down',
				title: $i18n.minimize,
				onclick: toggleMinimize
			});
			aside.appendChild(btn);
		}

		if (showTourControls && $tour && 'steps' in $tour) {
			const prog = document.createElement('progress');
			prog.setAttribute('aria-hidden', 'true');
			prog.value = (currentTourStep + 1) / $tour.steps.length;
			prog.className = 'progress';
			aside.appendChild(prog);

			const group = document.createElement('micrio-button-group') as MicrioElement;
			group.setProps?.({ className: 'micrio-tour-controls' });

			const prevBtn = document.createElement('micrio-button') as MicrioElement;
			prevBtn.setProps({
				type: 'arrow-left',
				disabled: this.#clickedPrevNext || currentTourStep == 0,
				title: $i18n.tourStepPrev,
				onclick: () => markerTourStep(true)
			});
			group.appendChild(prevBtn);

			if (showTourStepCounter) {
				const stepBtn = document.createElement('button');
				stepBtn.className = 'micrio-button tour-step';
				stepBtn.disabled = true;
				stepBtn.textContent = `${currentTourStep + 1} / ${$tour.steps.length}`;
				group.appendChild(stepBtn);
			}

			const nextBtn = document.createElement('micrio-button') as MicrioElement;
			nextBtn.setProps({
				type: 'arrow-right',
				disabled: this.#clickedPrevNext || isLastStep,
				title: $i18n.tourStepNext,
				onclick: () => markerTourStep()
			});
			group.appendChild(nextBtn);
			aside.appendChild(group);
		}

		div.appendChild(aside);

		const content = document.createElement('micrio-marker-content') as MicrioElement;
		content.setProps({ marker, onclose: close });
		div.appendChild(content);

		this.appendChild(div);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMarkerPopup.tag, MicrioMarkerPopup);
