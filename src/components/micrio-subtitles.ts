import { MicrioElement } from '$ts/component';
import { get } from '$ts/store';
import { captionsEnabled } from '$ts/captions';
import type { Models } from '$types/models';

export interface SubtitlesProps {
	src?: string;
	mediaEl?: HTMLElement;
}

export class MicrioSubtitles extends MicrioElement<SubtitlesProps> {
	static tag = 'micrio-subtitles';
	static styles = `micrio-subtitles{position:fixed;bottom:50px;left:50vw;transform:translate3d(-50%,0,0);text-align:center;color:#fff;width:100vw;pointer-events:none;z-index:6;transition:transform .2s ease}
micrio-subtitles.raised{transform:translate3d(-50%,calc(-1 * var(--micrio-button-size)),0)}
micrio-subtitles p{margin:.5em 0;background-color:rgba(0,0,0,.6);padding:0 14px;-webkit-box-decoration-break:clone;box-decoration-break:clone;white-space:pre-wrap;display:inline;text-shadow:2px 2px 1px #0005;font-size:2.5em;line-height:inherit}
@media(max-width:640px){micrio-subtitles{width:95vw;font-size:.7em}}`;

	#props: SubtitlesProps = {};
	#cues: Models.ImageData.Event[] = [];
	#currentTime = 0;
	#cleanup: (() => void) | undefined;

	onMount() {
		this.#cleanup = captionsEnabled.subscribe(() => this.#renderCue());

		const micrio = this.getMicrio();
		if (micrio) {
			const updateRaised = () => this.classList.toggle('raised', !!get(micrio.state.tour));
			updateRaised();
			const unsub = micrio.state.tour.subscribe(updateRaised);
			const prev = this.#cleanup;
			this.#cleanup = () => { prev?.(); unsub(); };
		}

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
		if (!this.#props.src) { this.innerHTML = ''; return; }

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
		if (!get(captionsEnabled) || !this.#cues.length) { this.innerHTML = ''; return; }
		const cue = this.#cues.find(e => e.start <= this.#currentTime && e.end >= this.#currentTime);
		this.innerHTML = cue ? `<p>${cue.data}</p>` : '';
	}

	onDestroy() {
		this.#cleanup?.();
	}
}

customElements.define(MicrioSubtitles.tag, MicrioSubtitles);
