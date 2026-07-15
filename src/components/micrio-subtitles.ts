import { MicrioElement } from '$ts/component';
import type { Writable } from '$ts/store';
import { get } from '$ts/store';
import { captionsEnabled } from '$ts/captions';
import type { Models } from '$types/models';

export interface SubtitlesProps {
	src?: string;
	raised?: boolean;
}

export class MicrioSubtitles extends MicrioElement<SubtitlesProps> {
	static tag = 'micrio-subtitles';
	static styles = `micrio-subtitles{position:absolute;bottom:50px;left:50vw;left:50cqw;transform:translate3d(-50%,0,0);text-align:center;color:#fff;width:100vw;width:100cqw;pointer-events:none;transition:transform .2s ease}
micrio-subtitles.raised{transform:translate3d(-50%,calc(-1 * var(--micrio-button-size)),0)}
micrio-subtitles p{margin:.5em 0;background-color:rgba(0,0,0,.6);padding:0 14px;-webkit-box-decoration-break:clone;box-decoration-break:clone;white-space:pre-wrap;display:inline;text-shadow:2px 2px 1px #0005;font-size:2.5em;line-height:inherit}
@media(max-width:640px){micrio-subtitles{width:95vw;width:95cqw;font-size:.7em}}`;

	#props: SubtitlesProps = {};
	#unsubs: (() => void)[] = [];
	#cues: Models.ImageData.Event[] = [];

	onMount() {
		const unsub = this.inject<Writable<number>>('volume')?.subscribe(() => this.#renderCue());
		if (unsub) this.#unsubs.push(unsub);

		this.#unsubs.push(captionsEnabled.subscribe(() => this.#renderCue()));

		const micrio = this.inject<any>('micrio');
		if (micrio) {
			const onTime = (e: Event) => {
				this.#currentTime = (e as CustomEvent).detail ?? 0;
				this.#renderCue();
			};
			micrio.addEventListener('timeupdate', onTime);
			this.#unsubs.push(() => micrio.removeEventListener('timeupdate', onTime));
		}

		this.classList.toggle('raised', !!this.#props.raised);
		this.#update();
	}

	#currentTime = 0;

	setProps(props: Partial<SubtitlesProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) { this.classList.toggle('raised', !!this.#props.raised); this.#update(); }
	}

	#update() {
		if (!this.#props.src) { this.innerHTML = ''; return; }

		this.#cues = [];
		const src = this.#props.src;
		fetch(src).then(r => r.text()).then(txt => {
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
		if (!get(captionsEnabled) || !this.#cues.length) { this.innerHTML = ''; return; }
		const cue = this.#cues.find(e => e.start <= this.#currentTime && e.end >= this.#currentTime);
		this.innerHTML = cue ? `<p>${cue.data}</p>` : '';
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioSubtitles.tag, MicrioSubtitles);
