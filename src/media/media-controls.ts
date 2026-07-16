import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import { get } from '$core/store';
import { i18n } from '$core/i18n/strings';
import { captionsEnabled } from '$media/subtitles';
import { fmt } from '$utils/time';
import '$ui/button';
import './fullscreen';

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
	onclose?: () => void;
	getTimeDisplay?: (currentTime: number, duration: number) => string;
}

export class MicrioMediaControls extends MicrioElement<MediaControlsProps> {
	static tag = 'micrio-media-controls';
	static styles = `micrio-media-controls{display:block}
micrio-media-controls aside.controls-wrapper{display:flex;align-items:center;width:100%;--micrio-background:var(--micrio-background,#000)}
micrio-media-controls micrio-button{border-radius:0;margin:0;border:none}
micrio-media-controls .ctrl-subtitles button:not(.active){color:var(--micrio-color)!important}
micrio-media-controls .ctrl-subtitles button:not(.active) svg{fill:var(--micrio-color)!important}
micrio-media-controls micrio-button:last-child{margin-right:16px}
micrio-media-controls>*{--micrio-button-background:none;--micrio-background-filter:none;--micrio-button-shadow:none}
:fullscreen micrio-media-controls{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:430px;max-width:90vw;max-width:90cqw;border-radius:var(--micrio-border-radius)}
micrio-media-controls .container{flex:1;display:flex;align-items:center;gap:8px;padding:0 8px}
micrio-media-controls .bars{flex:1;height:4px;background:var(--micrio-progress-bar-background,var(--micrio-color-hover));cursor:pointer;position:relative;border-radius:2px}
micrio-media-controls .bar{position:absolute;top:0;left:0;height:100%;background:var(--micrio-color)}
micrio-media-controls .bars>.bar:first-child{border-radius:2px 0 0 2px}
micrio-media-controls .bars>.bar:last-child{border-radius:0 2px 2px 0}
micrio-media-controls .bars>.bar:only-child{border-radius:2px}
micrio-media-controls .time{font-size:90%;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--micrio-color);text-align:center;min-width:50px;padding:0;display:block}`;

	#props: MediaControlsProps = { paused: true, ended: false };
	#wrapperEl!: HTMLElement;
	#playBtn: any;
	#barEl!: HTMLElement;
	#timeEl!: HTMLElement;
	#built = false;
	#prevPaused: boolean | undefined;
	#prevSeeking = false;
	#prevMuted = false;
	#prevProgress = -1;
	#prevTime = '';

	onMount() {
		this.#build();
		this.addCleanup(captionsEnabled.subscribe(() => this.#sync()));
	}

	setProps(props: Partial<MediaControlsProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) { this.#build(); if (this.#built) this.#sync(); }
	}

	#build() {
		const p = this.#props;
		if (!this.#built) {
			this.#built = true;

			this.#wrapperEl = createElement('aside', {
				className: 'controls-wrapper',
				events: {
					click: e => e.stopPropagation(),
					keydown: e => e.stopPropagation(),
				},
				parent: this,
			});

			this.#playBtn = createElement('micrio-button', {
				parent: this.#wrapperEl,
			});

			if (p.hasAudio) {
				createElement('micrio-button', {
					className: 'ctrl-mute',
					parent: this.#wrapperEl,
				});
			}

			if (p.subtitles) {
				createElement('micrio-button', {
					className: 'ctrl-subtitles',
					parent: this.#wrapperEl,
				});
			}

			if (p.fullscreenEl) {
				createElement('micrio-fullscreen', {
					className: 'ctrl-fullscreen',
					parent: this.#wrapperEl,
				});
			}

			const container = createElement('div', {
				className: 'container',
			});

			const bars = createElement('div', {
				className: 'bars',
				children: [
					this.#barEl = createElement('div', { className: 'bar' }),
				],
			});

			const dStart = (e: MouseEvent) => {
				if (e.button != 0) return;
				window.addEventListener('mousemove', dMove);
				window.addEventListener('mouseup', dStop);
				dMove(e);
			};
			const dMove = (e: MouseEvent) => {
				const rect = bars.getClientRects()[0];
				if (!rect) return;
				const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
				this.#props.onseek?.(perc * this.#props.duration!);
			};
			const dStop = () => {
				window.removeEventListener('mousemove', dMove);
				window.removeEventListener('mouseup', dStop);
			};
			bars.addEventListener('mousedown', dStart);
			container.appendChild(bars);

			this.#timeEl = createElement('span', {
				className: 'time',
				parent: container,
			});

			this.#wrapperEl.appendChild(container);

			if (p.onclose) {
				createElement('micrio-button', {
					className: 'ctrl-close',
					setProps: { type: 'close', title: get(i18n).close, onclick: p.onclose },
					parent: this.#wrapperEl,
				});
			}
		}

		this.#sync();
	}

	#sync() {
		const p = this.#props;
		const $i18n = get(i18n);
		const $captionsEnabled = get(captionsEnabled);

		if (p.paused !== this.#prevPaused || p.seeking !== this.#prevSeeking || this.#prevPaused === undefined) {
			this.#prevPaused = p.paused;
			this.#prevSeeking = !!p.seeking;
			this.#playBtn.setProps({
				type: !p.paused ? 'pause' : 'play',
				title: !p.paused ? $i18n.pause : $i18n.play,
				disabled: !!p.seeking,
				onclick: p.onplaypause
			});
		}

		const muteBtn = this.#wrapperEl.querySelector('.ctrl-mute') as MicrioElement;
		if (muteBtn && p.muted !== this.#prevMuted) {
			this.#prevMuted = !!p.muted;
			muteBtn.setProps({
				type: p.muted ? 'volume-off' : 'volume-up',
				title: p.muted ? $i18n.audioUnmute : $i18n.audioMute,
				disabled: p.seeking,
				onclick: p.onmute
			});
		}

		const subBtn = this.#wrapperEl.querySelector('.ctrl-subtitles') as MicrioElement;
		if (subBtn) {
			subBtn.setProps({
				type: $captionsEnabled ? 'subtitles' : 'subtitles-off',
				active: $captionsEnabled,
				title: $i18n.subtitlesToggle,
				onclick: () => captionsEnabled.set(!get(captionsEnabled))
			});
		}

		const fsBtn = this.#wrapperEl.querySelector('.ctrl-fullscreen') as MicrioElement;
		if (fsBtn) fsBtn.setProps({ el: p.fullscreenEl });

		if (p.duration && !isNaN(p.duration)) {
			const progress = ((p.currentTime ?? 0) / p.duration) * 100;
			if (Math.abs(progress - this.#prevProgress) > 0.5 || progress === 0) {
				this.#prevProgress = progress;
				this.#barEl.style.width = `${progress}%`;
			}
			const t = p.getTimeDisplay
				? p.getTimeDisplay(p.currentTime ?? 0, p.duration)
				: ((p.duration - (p.currentTime ?? 0)) >= 0 ? '-' : '') + fmt(Math.abs(p.duration - (p.currentTime ?? 0)));
			if (t !== this.#prevTime) {
				this.#prevTime = t;
				this.#timeEl.textContent = t;
			}
		} else if (this.#prevTime !== '0:00' || this.#prevProgress !== 0) {
			this.#prevTime = '0:00';
			this.#prevProgress = 0;
			this.#timeEl.textContent = '0:00';
			this.#barEl.style.width = '0%';
		}
	}

}

customElements.define(MicrioMediaControls.tag, MicrioMediaControls);
