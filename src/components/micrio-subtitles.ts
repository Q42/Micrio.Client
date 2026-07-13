import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';

export interface SubtitlesProps {
	src?: string;
	raised?: boolean;
}

export class MicrioSubtitles extends MicrioElement<SubtitlesProps> {
	static tag = 'micrio-subtitles';
	static styles = `micrio-subtitles{position:absolute;bottom:calc(var(--micrio-border-margin) + var(--micrio-button-size) + 16px);left:50%;transform:translateX(-50%);z-index:3;pointer-events:none;text-align:center;max-width:80%}
micrio-subtitles.raised{bottom:calc(var(--micrio-border-margin) + var(--micrio-button-size) + 80px)}
micrio-subtitles p{display:inline;background:var(--micrio-background);color:var(--micrio-color);padding:4px 12px;border-radius:var(--micrio-border-radius);font-size:.85em;line-height:1.6;backdrop-filter:var(--micrio-background-filter)}`;

	#props: SubtitlesProps = {};
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		// Subscribe to volume store to determine if subtitles can be shown
		this.#unsubs.push((micrio as any)?.volume?.subscribe?.(() => this.#update()));
		this.#update();
	}

	setProps(props: Partial<SubtitlesProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) { this.classList.toggle('raised', !!this.#props.raised); this.#update(); }
	}

	#update() {
		if (!this.#props.src) { this.innerHTML = ''; return; }

		// Check if captions are enabled
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !(window as any).micrioCaptionsEnabled) { this.innerHTML = ''; return; }

		// Load the VTT track
		const video = this.closest('micrio-media')?.querySelector('video');
		if (!video) return;

		// Find or create track element
		let track = video.querySelector('track') as HTMLTrackElement | null;
		if (!track) {
			track = document.createElement('track');
			track.kind = 'captions';
			track.default = true;
			video.appendChild(track);
		}
		track.src = this.#props.src;

		const showCue = () => {
			const cues = track!.track?.activeCues;
			if (cues && cues.length) {
				this.innerHTML = `<p>${(cues[0] as VTTCue).text}</p>`;
			} else {
				this.innerHTML = '';
			}
		};

		track.addEventListener('load', showCue);
		video.addEventListener('timeupdate', showCue);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioSubtitles.tag, MicrioSubtitles);
