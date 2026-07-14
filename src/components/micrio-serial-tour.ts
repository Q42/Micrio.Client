import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import './micrio-button';
import './micrio-fullscreen';
import './micrio-progress-bar';

export interface SerialTourProps {
	tour: Models.ImageData.MarkerTour;
	onended?: () => void;
}

export class MicrioSerialTour extends MicrioElement<SerialTourProps> {
	static tag = 'micrio-serial-tour';
	static styles = `micrio-serial-tour{position:absolute;bottom:0;left:0;right:0;z-index:5;background:var(--micrio-background);backdrop-filter:var(--micrio-background-filter);padding:8px var(--micrio-border-margin);display:flex;align-items:center;gap:8px;direction:ltr;box-shadow:0 -2px 10px rgba(0,0,0,.3)}
micrio-serial-tour micrio-button{--micrio-button-shadow:none;--micrio-background-filter:none;--micrio-button-background:none}`;

	#props: SerialTourProps = { tour: null! };
	#unsubs: (() => void)[] = [];
	#paused = false;
	#ended = false;
	#currentTime = 0;
	#duration = 0;
	#muted = false;
	#stepIndex = 0;
	#progressInterval: any;
	#built = false;
	#playBtn: any;
	#progressBar: any;

	onMount() {
		const { tour } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !tour) return;

		const stepInfo = (tour as any).stepInfo as any[] || [];
		const totalDuration: number = stepInfo.reduce((c: number, s: any) => c + (s.duration || 0), 0);

		this.#build();
		this.#sync();

		const nextStep = async () => {
			if (this.#paused) return;
			const si = stepInfo[this.#stepIndex];
			if (!si) { this.#ended = true; this.#sync(); return; }

			if (typeof si.micrioId == 'string' && micrio.$current?.id != si.micrioId) {
				await micrio.open(si.micrioId);
			}
			if (si.markerId) {
				micrio.$current?.state.marker.set(si.markerId);
			}
			this.#stepIndex++;
			this.#sync();
		};

		this.#progressInterval = setInterval(() => {
			if (!this.#paused && !this.#ended) {
				const elapsed = stepInfo.slice(0, this.#stepIndex).reduce((c: number, s: any) => c + (s.duration || 0), 0);
				this.#currentTime = elapsed;
				this.#duration = totalDuration;
				if (this.#currentTime >= this.#duration) {
					this.#ended = true;
					clearInterval(this.#progressInterval);
					this.#props.onended?.();
				}
				this.#sync();
			}
		}, 250);

		const playPause = () => { this.#paused = !this.#paused; this.#sync(); };
		const toggleMute = () => { this.#muted = !this.#muted; this.#sync(); };

		(this as any).__playPause = playPause;
		(this as any).__toggleMute = toggleMute;
		(this as any).__next = nextStep;
		(this as any).__prev = () => {
			if (this.#stepIndex > 1) this.#stepIndex -= 2;
			else this.#stepIndex = 0;
			nextStep();
		};

		nextStep();
	}

	#build() {
		if (this.#built) return;
		this.#built = true;

		const container = document.createElement('div');
		container.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%';

		this.#playBtn = document.createElement('micrio-button') as any;
		container.appendChild(this.#playBtn);

		const muteBtn = document.createElement('micrio-button') as any;
		muteBtn.setProps({
			type: 'volume-up', title: get(i18n).audioMute,
			onclick: (this as any).__toggleMute
		});
		container.appendChild(muteBtn);

		this.#progressBar = document.createElement('micrio-progress-bar') as any;
		container.appendChild(this.#progressBar);

		this.appendChild(container);
	}

	#sync() {
		if (this.#ended) {
			if (this.innerHTML) this.innerHTML = '';
			return;
		}
		if (!this.#built) return;

		const $i18n = get(i18n);

		this.#playBtn.setProps({
			type: this.#paused ? 'play' : 'pause',
			title: this.#paused ? $i18n.play : $i18n.pause,
			onclick: (this as any).__playPause
		});

		this.#progressBar.setProps({
			currentTime: this.#currentTime,
			duration: this.#duration || 1,
			ended: this.#ended
		});
	}

	setProps(props: Partial<SerialTourProps>) {
		if (props.tour !== undefined) this.#props.tour = props.tour;
		if (props.onended !== undefined) this.#props.onended = props.onended;
	}

	onDestroy() {
		clearInterval(this.#progressInterval);
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioSerialTour.tag, MicrioSerialTour);
