import { MicrioElement } from '$ts/component';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import { captionsEnabled } from '$ts/captions';
import './micrio-button';
import './micrio-fullscreen';

export interface MediaControlsProps {
	currentTime?: number;
	duration?: number;
	seeking?: boolean;
	minimal?: boolean;
	paused: boolean;
	ended: boolean;
	fullscreenEl?: HTMLElement | undefined;
	subtitles?: boolean;
	hasAudio?: boolean;
	muted?: boolean;
	onplaypause?: () => void;
	onmute?: () => void;
	onseek?: (n: number) => void;
}

export class MicrioMediaControls extends MicrioElement<MediaControlsProps> {
	static tag = 'micrio-media-controls';
	static styles = `micrio-media-controls{cursor:default;position:relative;display:flex;align-items:center;margin:0;background:var(--micrio-background)}
micrio-media-controls micrio-button{border-radius:0;margin:0;border:none}
micrio-media-controls micrio-button:last-child{margin-right:16px}
micrio-media-controls>*{--micrio-button-background:none;--micrio-background-filter:none;--micrio-button-shadow:none}
:fullscreen micrio-media-controls{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:430px;max-width:90vw;max-width:90cqw;border-radius:var(--micrio-border-radius)}
micrio-media-controls svg{pointer-events:none;position:absolute;left:-1px;top:-1px;width:42px;height:42px;transform:rotateZ(-90deg)}
micrio-media-controls circle{stroke-width:2;stroke:#fff;fill:transparent;stroke-dasharray:119.4 119.4;transition:stroke-dashoffset .25s linear;transform-origin:center center}`;

	#props: MediaControlsProps = { paused: true, ended: false };

	onMount() {
		this.#render();
	}

	setProps(props: Partial<MediaControlsProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	#render() {
		const p = this.#props;
		const { currentTime = 0, duration = 0, minimal = false, paused, ended } = p;
		const $i18n = get(i18n);
		const $captionsEnabled = get(captionsEnabled);

		this.replaceChildren();

		const aside = document.createElement('aside');
		aside.addEventListener('click', e => e.stopPropagation());
		aside.addEventListener('keydown', e => e.stopPropagation());

		const playBtn = document.createElement('micrio-button') as any;
		playBtn.setProps({
			type: !paused ? 'pause' : 'play',
			title: !paused ? $i18n.pause : $i18n.play,
			onclick: p.onplaypause
		});

		if (minimal && currentTime !== undefined && currentTime > 0) {
			const ns = 'http://www.w3.org/2000/svg';
			const svg = document.createElementNS(ns, 'svg');
			svg.setAttribute('height', '42');
			svg.setAttribute('width', '42');
			const circle = document.createElementNS(ns, 'circle');
			circle.setAttribute('r', '19');
			circle.setAttribute('cx', '21');
			circle.setAttribute('cy', '21');
			circle.setAttribute('stroke-dashoffset', String((1 - (currentTime / duration)) * 119.4));
			svg.appendChild(circle);
			playBtn.appendChild(svg);
		}
		aside.appendChild(playBtn);

		if (!minimal) {
			if (p.hasAudio) {
				const muteBtn = document.createElement('micrio-button') as any;
				muteBtn.setProps({
					type: p.muted ? 'volume-off' : 'volume-up',
					title: p.muted ? $i18n.audioUnmute : $i18n.audioMute,
					disabled: p.seeking,
					onclick: p.onmute
				});
				aside.appendChild(muteBtn);
			}

			if (p.subtitles) {
				const subBtn = document.createElement('micrio-button') as any;
				subBtn.setProps({
					type: $captionsEnabled ? 'subtitles' : 'subtitles-off',
					active: $captionsEnabled,
					title: $i18n.subtitlesToggle,
					onclick: () => captionsEnabled.set(!$captionsEnabled)
				});
				aside.appendChild(subBtn);
			}

			if (p.fullscreenEl) {
				const fs = document.createElement('micrio-fullscreen') as any;
				fs.setProps({ el: p.fullscreenEl });
				aside.appendChild(fs);
			}
		}

		this.appendChild(aside);

		if (!minimal) {
			const bar = document.createElement('div');
			bar.className = 'bar active';
			bar.style.setProperty('--progress', `${((currentTime ?? 0) / duration) * 100}%`);
			const dStart = (e: MouseEvent) => {
				if (e.button != 0) return;
				window.addEventListener('mousemove', dMove);
				window.addEventListener('mouseup', dStop);
				dMove(e);
			};
			const dMove = (e: MouseEvent) => {
				const rect = bar.getClientRects()[0];
				if (!rect) return;
				const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
				p.onseek?.(perc * duration);
			};
			const dStop = () => {
				window.removeEventListener('mousemove', dMove);
				window.removeEventListener('mouseup', dStop);
			};
			bar.addEventListener('mousedown', dStart);

			const progressBar = document.createElement('micrio-progress-bar') as any;
			progressBar.setProps({ currentTime, duration, ended });
			progressBar.appendChild(bar);
			this.appendChild(progressBar);
		}
	}
}

customElements.define(MicrioMediaControls.tag, MicrioMediaControls);
