import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { DataLoader } from '$utils/dataLoader';
import { parseTime } from '$utils/time';
import { afterFrame, createElement } from '$utils/dom';
import '$media/media';

/** Properties for the serial tour component. @internal */
export interface SerialTourProps {
	tour: Models.ImageData.MarkerTour;
	onended?: () => void;
}
import './serial-tour.css';

/** Web component that plays a sequential tour with progress bars and chapter navigation. */
class MicrioSerialTour extends MicrioElement<SerialTourProps> {
	/** The custom element tag name. @internal */
	static tag = 'micrio-serial-tour';

	#props: SerialTourProps = { tour: null! };
	#stepInfo: Models.ImageData.MarkerTourStepInfo[] = [];
	#currentStep = 0;
	#built = false;
	#mediaEl: MicrioElement | undefined = undefined;
	#duration = 0;
	#noTimeScrub = false;

	/** @internal */
	_onMount() {
		const { tour } = this.#props;
		const micrio = this._getMicrio();
		if (!micrio || !tour) return;

		this.#stepInfo = (tour.stepInfo as Models.ImageData.MarkerTourStepInfo[]) || [];
		this.#duration = this.#stepInfo.reduce((c, s) => c + (s.duration || 0), 0);
		this.#noTimeScrub = !!(micrio.$current?.$settings?.ui?.controls?.serialTourNoTimeScrub);

		micrio.setAttribute('data-tour-active', '');
		this._addCleanup(() => micrio.removeAttribute('data-tour-active'));

		const mt = tour;
		mt.next = () => this.#nextStep();
		mt.prev = () => { if (this.#currentStep > 0) this.#openStep(this.#currentStep - 1); };

		this._addCleanup(micrio.state.marker.subscribe(m => {
			if (!m || !this.#stepInfo.length) return;
			const id = typeof m == 'string' ? m : m.id;
			const idx = this.#stepInfo.findIndex(s => s.markerId === id);
			if (idx >= 0 && idx !== this.#currentStep) {
				this.#stepInfo.forEach(s => s.ended = false);
				this.#openStep(idx);
			}
		}));

		this.#build();

		this.#openStep(0);
	}

	#build() {
		if (this.#built) return;
		this.#built = true;

		if (this.#props.tour.printChapters) {
			const ol = createElement('ol');
			this.#stepInfo.forEach((si, i) => {
				const marker = DataLoader._getStepMarker(si);
				const title = this.#getTitle(marker);
				if (title) {
					createElement('li', {
						dataset: { idx: String(i) },
						parent: ol,
						children: [
							createElement('button', {
								textContent: title,
								events: { click: () => this.#goto(i) }
							})
						]
					});
				}
			});
			if (ol.children.length) this.appendChild(ol);
		}
	}

	async #openStep(idx: number) {
		const micrio = this._getMicrio();
		if (!micrio) return;

		const close = () => {
			micrio.state.tour.set(undefined);
			this.#props.onended?.();
			this.remove();
		};

		const si = this.#stepInfo[idx];
		if (!si) return;

		si.ended = false;
		si.currentTime = 0;

		const marker = DataLoader._getStepMarker(si);

		let startView: Models.Camera.View | undefined;
		if (marker?.videoTour) {
			const timeline = marker.videoTour.i18n?.[micrio.lang]?.timeline;
			if (timeline?.length) startView = timeline[0].rect;
		}

		if (si.micrioId && micrio.$current?.id !== si.micrioId) {
			await micrio.open(si.micrioId, { startView });
		}

		if (this.#mediaEl) {
			this.#mediaEl.remove();
			this.#mediaEl = undefined;
		}

		if (marker?.videoTour) {
			const lang = micrio.lang;
			const audio = marker.videoTour.i18n?.[lang]?.audio ?? marker.i18n?.[lang]?.audio;

			const prevPaused = false;
			const media = createElement('micrio-media', {
				parent: this,
				setProps: {
					tour: marker.videoTour,
					src: audio?.src,
					image: micrio.$current,
					controls: true,
					autoplay: !prevPaused,
					onended: () => this.#nextStep(),
					onclose: close,
					hasAudio: this.#stepInfo.some(s => s.duration > 0),
					fullscreenEl: micrio,
					getTimeDisplay: () => `${parseTime(this.#calcTime())} / ${parseTime(this.#duration)}`
				}
			}) as MicrioElement;
			this.#mediaEl = media;
			await afterFrame();
			this.#injectBars();

			const videoEl = this.#mediaEl!.querySelector('video,audio') as HTMLMediaElement;
			if (videoEl) {
				videoEl.addEventListener('timeupdate', () => {
					const si = this.#stepInfo[this.#currentStep];
					if (si) si.currentTime = videoEl.currentTime;
					this.#updateBars();
				});
			}
		}

		this.#currentStep = idx;
		this.#updateBars();

		if (!marker?.videoTour && idx === this.#stepInfo.length - 1) {
			this.#nextStep();
		}
	}

	#nextStep() {
		const si = this.#stepInfo[this.#currentStep];
		if (si) si.ended = true;

		if (this.#currentStep < this.#stepInfo.length - 1) {
			this.#openStep(this.#currentStep + 1);
		} else {
			this.#props.onended?.();
			this._getMicrio()?.state.tour.set(undefined);
			this.remove();
		}
	}

	#getTitle(m: Models.ImageData.Marker | undefined): string | undefined {
		return m?.i18n?.[this._getMicrio()?.lang || 'en']?.title;
	}

	#injectBars() {
		const wrapper = this.#mediaEl?.querySelector('micrio-media-controls > aside');
		if (!wrapper) return;

		const holder = wrapper.querySelector('div');
		if (!holder) return;

		holder.querySelector('[data-part="bars"]')?.remove();

		const barsDiv = createElement('div', { attrs: { 'data-part': 'bars' } });
		this.#stepInfo.forEach((si, i) => {
			const marker = DataLoader._getStepMarker(si);
			createElement('div', {
				attrs: { 'data-part': 'bar', role: 'progressbar', tabindex: '0' },
				dataset: { idx: String(i) },
				props: { title: this.#getTitle(marker) ?? '' },
				style: { width: `${(si.duration / (this.#duration || 1)) * 100}%` },
				events: { click: () => this.#goto(i) },
				parent: barsDiv
			});
		});
		holder.prepend(barsDiv);
	}

	#goto(i: number) {
		if (this.#noTimeScrub && i === this.#currentStep) return;
		if (i === this.#currentStep) return;
		this.#stepInfo.forEach(s => s.ended = false);
		this.#openStep(i);
	}

	#calcTime() {
		let total = 0;
		for (let i = 0; i < this.#stepInfo.length; i++) {
			const s = this.#stepInfo[i];
			if (i < this.#currentStep || s.ended) total += s.duration;
			else if (i === this.#currentStep) { total += s.currentTime ?? 0; break; }
			else break;
		}
		return total;
	}

	#updateBars() {
		if (!this.#built) return;
		const bars = this.#mediaEl?.querySelectorAll<HTMLElement>('aside [data-part="bars"] > [data-part="bar"]') ?? [];
		bars.forEach((bar, i) => {
			const si = this.#stepInfo[i];
			const ct = i === this.#currentStep ? (si.currentTime ?? 0) : 0;
			const pct = i < this.#currentStep || si.ended ? 100
				: i === this.#currentStep ? Math.round((ct / (si.duration || 1)) * 10000) / 100
				: 0;
			bar.style.setProperty('--progress', `${pct}%`);
			bar.classList.toggle('active', i === this.#currentStep);
		});

		const chapters = this.querySelectorAll<HTMLElement>('ol.chapters li');
		chapters.forEach(li => li.classList.toggle('active', Number(li.dataset.idx) === this.#currentStep));
	}

	/** @internal */
	_setProps(props: Partial<SerialTourProps>) {
		if (props.tour !== undefined) this.#props.tour = props.tour;
		if (props.onended !== undefined) this.#props.onended = props.onended;
	}

}

customElements.define(MicrioSerialTour.tag, MicrioSerialTour);
