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
import './media-controls.css';

class MicrioMediaControls extends MicrioElement<MediaControlsProps> {
	static tag = 'micrio-media-controls';

	#props: MediaControlsProps = { paused: true, ended: false };
	#wrapperEl!: HTMLElement;
	#playBtn: any;
	#muteBtnEl!: MicrioElement;
	#subBtnEl!: MicrioElement;
	#fsBtnEl!: MicrioElement;
	#barEl!: HTMLElement;
	#timeEl!: HTMLElement;
	#built = false;
	#prevPaused: boolean | undefined;
	#prevSeeking = false;
	#prevMuted = false;
	#prevProgress = -1;
	#prevTime = '';

	_onMount() {
		this.#build();
		this._addCleanup(captionsEnabled.subscribe(() => this.#sync()));
	}

	_setProps(props: Partial<MediaControlsProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) { this.#build(); if (this.#built) this.#sync(); }
	}

	#build() {
		const p = this.#props;
		if (!this.#built) {
			this.#built = true;

			this.#wrapperEl = createElement('aside', {
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
				this.#muteBtnEl = createElement('micrio-button', {
					parent: this.#wrapperEl,
				}) as MicrioElement;
			}

			if (p.subtitles) {
				this.#subBtnEl = createElement('micrio-button', {
					parent: this.#wrapperEl,
				}) as MicrioElement;
			}

			const container = createElement('div');

			const bars = createElement('div', {
				attrs: { 'data-part': 'bars' },
				children: [
					this.#barEl = createElement('div', { attrs: { 'data-part': 'bar' } }),
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
				parent: container,
			});

			this.#wrapperEl.appendChild(container);

			if (p.fullscreenEl) {
				this.#fsBtnEl = createElement('micrio-fullscreen', {
					parent: this.#wrapperEl,
				}) as MicrioElement;
			}

			if (p.onclose) {
				createElement('micrio-button', {
					setProps: { type: 'close', title: get(i18n)._close, onclick: p.onclose },
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
			this.#playBtn._setProps({
				type: !p.paused ? 'pause' : 'play',
				title: !p.paused ? $i18n._pause : $i18n._play,
				disabled: !!p.seeking,
				onclick: p.onplaypause
			});
		}

		if (this.#muteBtnEl && p.muted !== this.#prevMuted) {
			this.#prevMuted = !!p.muted;
			this.#muteBtnEl._setProps({
				type: p.muted ? 'muted' : 'unmuted',
				title: p.muted ? $i18n._audioUnmute : $i18n._audioMute,
				disabled: p.seeking,
				onclick: p.onmute
			});
		}

		if (this.#subBtnEl) {
			this.#subBtnEl._setProps({
				type: $captionsEnabled ? 'subtitles' : 'subtitlesOff',
				active: $captionsEnabled,
				title: $i18n._subtitlesToggle,
				onclick: () => captionsEnabled.set(!get(captionsEnabled))
			});
		}

		if (this.#fsBtnEl) this.#fsBtnEl._setProps({ el: p.fullscreenEl });

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
