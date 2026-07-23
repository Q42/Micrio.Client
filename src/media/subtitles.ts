import { MicrioElement } from '$core/component';
import { get, writable } from '$core/store';
import type { Models } from '$types/models';

const CAPTIONS_KEY = 'micrio-captions-disable';

export const captionsEnabled = writable<boolean>(localStorage.getItem(CAPTIONS_KEY) != '1');

captionsEnabled.subscribe(b => {
	if (b) localStorage.removeItem(CAPTIONS_KEY);
	else localStorage.setItem(CAPTIONS_KEY, '1');
});

export interface SubtitlesProps {
	src?: string;
	mediaEl?: HTMLElement;
}
import './subtitles.css';

class MicrioSubtitles extends MicrioElement<SubtitlesProps> {
	static tag = 'micrio-subtitles';

	#props: SubtitlesProps = {};
	#cues: Models.ImageData.Event[] = [];
	#currentTime = 0;
	#currentCue: Models.ImageData.Event | undefined;
	#cleanup: (() => void) | undefined;

	onMount() {
		this.#cleanup = captionsEnabled.subscribe(() => this.#renderCue());

		const el = this.#props.mediaEl?.querySelector('video,audio') as HTMLMediaElement;
		if (el) {
			const onTime = () => { this.#currentTime = el.currentTime; this.#renderCue(); };
			el.addEventListener('timeupdate', onTime);
			const prev = this.#cleanup;
			this.#cleanup = () => { prev?.(); el.removeEventListener('timeupdate', onTime); };
		}

		if (this.#props.src) this.#update();
	}

	setProps(props: Partial<SubtitlesProps>) {
		const srcChanged = props.src !== undefined && props.src !== this.#props.src;
		Object.assign(this.#props, props);
		if (srcChanged && this.isConnected) this.#update();
	}

	#update() {
		if (!this.#props.src) { this.replaceChildren(); return; }

		this.#cues = [];
		fetch(this.#props.src).then(r => r.text()).then(txt => {
			const s = txt.split('\n');
			const cues: Models.ImageData.Event[] = [];
			for(let l=0; l<s.length; l++) {
				if(/-->/.test(s[l])) {
					let idx = l+1;
					const lines: string[] = [];
					while(!s[idx] && idx < s.length) idx++;
					while(s[idx] && s[idx].trim()) lines.push(s[idx++]);
					const [start,end] = s[l].split(' --> ')
						.map(t => t.trim().replace(',','.').split(':').map(Number))
						.map(v => {
							if(v.length === 3) return v[0]*3600+v[1]*60+v[2];
							else if(v.length === 2) return v[0]*60+v[1];
							else return 0;
						});
					cues.push({start, end, data: lines.join('\n')});
					l+=lines.length+1;
				}
			}
			this.#cues = cues;
			this.#renderCue();
		}).catch(err => console.error('micrio-subtitles: fetch error:', err));
	}

	#renderCue() {
		if (!get(captionsEnabled) || !this.#cues.length) { this.replaceChildren(); this.#currentCue = undefined; return; }
		const cue = this.#cues.find(e => e.start <= this.#currentTime && e.end >= this.#currentTime);
		if (cue === this.#currentCue) return;
		this.#currentCue = cue;
		this.innerHTML = cue ? `<p>${cue.data}</p>` : '';
	}

	onDestroy() {
		this.#cleanup?.();
	}
}

customElements.define(MicrioSubtitles.tag, MicrioSubtitles);
