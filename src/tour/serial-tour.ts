import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { DataLoader } from '$utils/dataLoader';
import { parseTime } from '$utils/time';
import { afterFrame, createElement } from '$utils/dom';
import '$media/media';

export interface SerialTourProps {
	tour: Models.ImageData.MarkerTour;
	onended?: () => void;
}

export class MicrioSerialTour extends MicrioElement<SerialTourProps> {
	static tag = 'micrio-serial-tour';
	static styles = `micrio-serial-tour{display:contents}
micrio-serial-tour>micrio-media{display:contents}
micrio-serial-tour micrio-media-controls{display:contents}
micrio-serial-tour micrio-media figure.videotour{left:var(--micrio-border-margin);transform:none}
micrio-serial-tour .bars{display:flex;height:var(--micrio-progress-bar-height,6px);background:var(--micrio-progress-bar-background,rgba(128,128,128,.3));position:relative;border-radius:3px;overflow:hidden}
micrio-serial-tour .bars>.bar{height:100%;display:block;box-sizing:border-box;position:relative;cursor:pointer;overflow:hidden;background:transparent}
micrio-serial-tour .bars>.bar::before{display:block;position:absolute;content:' ';background:var(--micrio-color);height:100%;pointer-events:none;width:var(--progress,0%);will-change:width}
micrio-serial-tour .bars>.bar.active::before{background:var(--micrio-active-color,var(--micrio-color))}
micrio-serial-tour ol.chapters{position:absolute;left:var(--micrio-border-margin);bottom:calc(2 * var(--micrio-border-margin) + var(--micrio-button-size));color:var(--micrio-color);text-shadow:var(--micrio-marker-text-shadow);list-style-type:decimal-leading-zero;margin:0}
micrio-serial-tour ol.chapters>li{padding:.15em;white-space:pre;transition:height .25s ease,opacity .25s .25s ease}
micrio-serial-tour ol.chapters>li.active{font-weight:bold}
:global(.minimized) > micrio-serial-tour ol.chapters>li:not(.active){height:0;opacity:0;transition:height .25s .25s ease,opacity .25s ease}
micrio-serial-tour ol.chapters button{font:inherit;background:none;border:none;display:inline;color:inherit;text-shadow:inherit;cursor:pointer}
micrio-serial-tour ol.chapters button:hover{text-decoration:underline}`;

	#props: SerialTourProps = { tour: null! };
	#stepInfo: Models.ImageData.MarkerTourStepInfo[] = [];
	#currentStep = 0;
	#built = false;
	#mediaEl: MicrioElement | undefined = undefined;
	#duration = 0;
	#noTimeScrub = false;

	onMount() {
		const { tour } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !tour) return;

		this.#stepInfo = (tour.stepInfo as Models.ImageData.MarkerTourStepInfo[]) || [];
		this.#duration = this.#stepInfo.reduce((c, s) => c + (s.duration || 0), 0);
		this.#noTimeScrub = !!(micrio.$current?.$settings?.ui?.controls?.serialTourNoTimeScrub);

		const mt = tour;
		mt.next = () => this.#nextStep();
		mt.prev = () => { if (this.#currentStep > 0) this.#openStep(this.#currentStep - 1); };

		this.addCleanup(micrio.state.marker.subscribe(m => {
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
			const ol = createElement('ol', { className: 'chapters' });
			this.#stepInfo.forEach((si, i) => {
				const marker = DataLoader.getStepMarker(si);
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
		const micrio = this.getMicrio();
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

		if (si.micrioId && micrio.$current?.id !== si.micrioId) {
			await micrio.open(si.micrioId);
		}

		const marker = DataLoader.getStepMarker(si);

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
			this.#mediaEl!.querySelector('figure')?.classList.add('videotour');
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
			this.getMicrio()?.state.tour.set(undefined);
			this.remove();
		}
	}

	#getTitle(m: Models.ImageData.Marker | undefined): string | undefined {
		return m?.i18n?.[this.getMicrio()?.lang || 'en']?.title;
	}

	#injectBars() {
		const wrapper = this.#mediaEl?.querySelector('micrio-media-controls .controls-wrapper');
		if (!wrapper) return;

		const holder = wrapper.querySelector('.container');
		if (!holder) return;

		holder.querySelector('.bars')?.remove();

		const barsDiv = createElement('div', { className: 'bars' });
		this.#stepInfo.forEach((si, i) => {
			const marker = DataLoader.getStepMarker(si);
			createElement('div', {
				className: 'bar',
				dataset: { idx: String(i) },
				props: { title: this.#getTitle(marker) ?? '' },
				style: { width: `${(si.duration / (this.#duration || 1)) * 100}%` },
				events: { click: () => this.#goto(i) },
				attrs: { role: 'progressbar', tabindex: '0' },
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
		const bars = this.#mediaEl?.querySelectorAll<HTMLElement>('.controls-wrapper .bars > .bar') ?? [];
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

	setProps(props: Partial<SerialTourProps>) {
		if (props.tour !== undefined) this.#props.tour = props.tour;
		if (props.onended !== undefined) this.#props.onended = props.onended;
	}

}

customElements.define(MicrioSerialTour.tag, MicrioSerialTour);
