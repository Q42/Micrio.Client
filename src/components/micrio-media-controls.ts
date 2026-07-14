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
	static styles = `micrio-media-controls{cursor:default;position:relative;margin:0;background:var(--micrio-background)}
micrio-media-controls aside{display:flex;align-items:center}
micrio-media-controls micrio-button{border-radius:0;margin:0;border:none}
micrio-media-controls micrio-button:last-child{margin-right:16px}
micrio-media-controls>*{--micrio-button-background:none;--micrio-background-filter:none;--micrio-button-shadow:none}
:fullscreen micrio-media-controls{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:430px;max-width:90vw;max-width:90cqw;border-radius:var(--micrio-border-radius)}
micrio-media-controls circle{stroke-width:2;stroke:#fff;fill:transparent;stroke-dasharray:119.4 119.4;transition:stroke-dashoffset .25s linear;transform-origin:center center}
micrio-media-controls svg.circle-progress{pointer-events:none;position:absolute;left:-1px;top:-1px;width:42px;height:42px;transform:rotateZ(-90deg)}
micrio-media-controls .bar{height:4px;background:var(--micrio-color-hover);width:100%;cursor:pointer;position:relative}
micrio-media-controls .bar::before{content:'';position:absolute;top:0;left:0;height:100%;width:var(--progress,0%);background:var(--micrio-color)}`;

	#props: MediaControlsProps = { paused: true, ended: false };
	#asideEl!: HTMLElement;
	#playBtn: any;
	#progressEl!: HTMLElement;
	#built = false;
	#prevPaused = true;
	#prevMuted = false;
	#prevProgress = 0;

	onMount() {
		this.#build();
	}

	setProps(props: Partial<MediaControlsProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#build();
	}

	#build() {
		const p = this.#props;
		if (!this.#built) {
			this.#built = true;

			this.#asideEl = document.createElement('aside');
			this.#asideEl.addEventListener('click', e => e.stopPropagation());
			this.#asideEl.addEventListener('keydown', e => e.stopPropagation());
			this.appendChild(this.#asideEl);

			this.#playBtn = document.createElement('micrio-button');
			this.#asideEl.appendChild(this.#playBtn);

			if (p.hasAudio) {
				const muteBtn = document.createElement('micrio-button');
				muteBtn.className = 'ctrl-mute';
				this.#asideEl.appendChild(muteBtn);
			}

			if (p.subtitles) {
				const subBtn = document.createElement('micrio-button');
				subBtn.className = 'ctrl-subtitles';
				this.#asideEl.appendChild(subBtn);
			}

			if (p.fullscreenEl) {
				const fs = document.createElement('micrio-fullscreen');
				fs.className = 'ctrl-fullscreen';
				this.#asideEl.appendChild(fs);
			}

			const bar = document.createElement('div');
			bar.className = 'bar active';
			this.#progressEl = bar;

			const dStart = (e: MouseEvent) => {
				if (e.button != 0) return;
				window.addEventListener('mousemove', dMove);
				window.addEventListener('mouseup', dStop);
				dMove(e);
			};
			const dMove = (e: MouseEvent) => {
				const rect = this.#progressEl.getClientRects()[0];
				if (!rect) return;
				const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
				this.#props.onseek?.(perc * this.#props.duration!);
			};
			const dStop = () => {
				window.removeEventListener('mousemove', dMove);
				window.removeEventListener('mouseup', dStop);
			};
			bar.addEventListener('mousedown', dStart);
			this.appendChild(bar);
		}

		this.#sync();
	}

	#sync() {
		const p = this.#props;
		const $i18n = get(i18n);
		const $captionsEnabled = get(captionsEnabled);

		if (p.paused !== this.#prevPaused) {
			this.#prevPaused = p.paused;
			this.#playBtn.setProps({
				type: !p.paused ? 'pause' : 'play',
				title: !p.paused ? $i18n.pause : $i18n.play,
				onclick: p.onplaypause
			});
		}

		const muteBtn = this.#asideEl.querySelector('.ctrl-mute') as any;
		if (muteBtn && p.muted !== this.#prevMuted) {
			this.#prevMuted = !!p.muted;
			muteBtn.setProps({
				type: p.muted ? 'volume-off' : 'volume-up',
				title: p.muted ? $i18n.audioUnmute : $i18n.audioMute,
				disabled: p.seeking,
				onclick: p.onmute
			});
		}

		const subBtn = this.#asideEl.querySelector('.ctrl-subtitles') as any;
		if (subBtn) {
			subBtn.setProps({
				type: $captionsEnabled ? 'subtitles' : 'subtitles-off',
				active: $captionsEnabled,
				title: $i18n.subtitlesToggle,
				onclick: () => captionsEnabled.set(!$captionsEnabled)
			});
		}

		const fsBtn = this.#asideEl.querySelector('.ctrl-fullscreen') as any;
		if (fsBtn) fsBtn.setProps({ el: p.fullscreenEl });

		if (p.duration) {
			const progress = ((p.currentTime ?? 0) / p.duration) * 100;
			if (Math.abs(progress - this.#prevProgress) > 0.5) {
				this.#prevProgress = progress;
				this.#progressEl.style.setProperty('--progress', `${progress}%`);
			}
		}
	}
}

customElements.define(MicrioMediaControls.tag, MicrioMediaControls);
