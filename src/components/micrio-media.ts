import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import type { HTMLMicrioElement } from '$ts/element';
import { VideoTourInstance } from '$ts/media/videotour';
import './micrio-button';
import './micrio-media-controls';

const YOUTUBE_RE = /((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be|youtube-nocookie\.com))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?/;
const VIMEO_RE = /vimeo\.com/;

export interface MediaProps {
	src?: string;
	image?: MicrioImage;
	uuid?: string;
	tour?: Models.ImageData.VideoTour | null;
	autoplay?: boolean;
	controls?: boolean;
	paused?: boolean;
	noPlayOverlay?: boolean;
	is360?: boolean;
	width?: number;
	height?: number;
	muted?: boolean;
	secondary?: boolean;
	title?: string;
	figcaption?: string;
	className?: string;
	onended?: () => void;
}

export class MicrioMedia extends MicrioElement<MediaProps> {
	static tag = 'micrio-media';
	static styles = `micrio-media figure{position:relative;margin:0;padding:0;--micrio-background:#000}
micrio-media figure.hidden{display:none}
micrio-media figure video,micrio-media figure audio{width:100%;display:block}
micrio-media figure figcaption{padding:5px 10px;font-size:.85em;opacity:.7;text-align:center;background:var(--micrio-background)}
micrio-media figure iframe{width:100%;height:100%;border:none;display:block}
micrio-media figure .overlay{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1;background:rgba(0,0,0,.3);transition:opacity .3s ease}
micrio-media figure .overlay.hidden{opacity:0;pointer-events:none}
micrio-media figure .overlay micrio-button{--micrio-button-size:80px;--micrio-icon-size:40px;--micrio-border-radius:100%;--micrio-button-background:rgba(0,0,0,.6);--micrio-button-shadow:none;--micrio-background-filter:none;pointer-events:none}`;

	#props: MediaProps = {};
	#unsubs: (() => void)[] = [];
	#videoEl: HTMLVideoElement | HTMLAudioElement | undefined;
	#tourInstance: VideoTourInstance | undefined;
	#paused = true;
	#ended = false;
	#duration = 0;
	#currentTime = 0;
	#seeking = false;
	#muted = false;

	onMount() {
		this.#render();
	}

	setProps(props: Partial<MediaProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	#render() {
		const p = this.#props;
		const src = p.src;
		if (!src && !p.tour) { this.innerHTML = ''; return; }

		const isYoutube = src ? YOUTUBE_RE.test(src) : false;
		const isVimeo = src ? VIMEO_RE.test(src) : false;
		const isAudio = src ? src.includes('.mp3') || src.includes('.ogg') || src.includes('.wav') || src.includes('audio/') : false;
		this.replaceChildren();

		const figure = document.createElement('figure');
		figure.className = p.className ?? '';
		if (p.className?.includes('hidden')) figure.classList.add('hidden');

		if (p.is360) figure.style.setProperty('--micrio-background', 'transparent');

		if (isYoutube) {
			const match = src!.match(YOUTUBE_RE);
			const videoId = match?.[5];
			if (videoId) {
				const iframe = document.createElement('iframe');
				iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${p.autoplay ? 1 : 0}&playsinline=1&enablejsapi=1`;
				iframe.setAttribute('allow', 'autoplay; encrypted-media');
				iframe.setAttribute('allowfullscreen', '');
				figure.appendChild(iframe);
			}
		} else if (isVimeo) {
			const iframe = document.createElement('iframe');
			iframe.src = `${src}?autoplay=${p.autoplay ? 1 : 0}&title=0&byline=0&portrait=0`;
			iframe.setAttribute('allow', 'autoplay; fullscreen');
			iframe.setAttribute('allowfullscreen', '');
			figure.appendChild(iframe);
		} else if (isAudio) {
			const audio = document.createElement('audio');
			audio.src = src!;
			audio.controls = !!p.controls;
			audio.preload = 'metadata';
			if (p.autoplay) audio.autoplay = true;
			if (p.muted) audio.muted = true;
			figure.appendChild(audio);
			this.#videoEl = audio;
			this.#wireEvents(audio);
		} else {
			const video = document.createElement('video');
			video.src = src!;
			video.controls = !!p.controls;
			video.preload = 'metadata';
			video.playsInline = true;
			video.crossOrigin = 'anonymous';
			if (p.autoplay) video.autoplay = true;
			if (p.muted) video.muted = true;
			figure.appendChild(video);
			this.#videoEl = video;
			this.#wireEvents(video);
		}

		// Title/figcaption
		if (p.figcaption) {
			const cap = document.createElement('figcaption');
			cap.textContent = p.figcaption;
			figure.appendChild(cap);
		}

		this.appendChild(figure);

		// Controls
		if (p.controls !== false && !isYoutube && !isVimeo) {
			const ctrlEl = document.createElement('micrio-media-controls') as any;
			const micrio = this.inject<HTMLMicrioElement>('micrio');
			void micrio;

			const onplaypause = () => {
				const el = this.#videoEl;
				if (!el) return;
				if (el.paused) el.play().catch(() => { });
				else el.pause();
			};

			const onmute = () => {
				const el = this.#videoEl;
				if (!el) return;
				this.#muted = !this.#muted;
				el.muted = this.#muted;
				this.#updateControls();
			};

			const onseek = (n: number) => {
				const el = this.#videoEl;
				if (!el) return;
				el.currentTime = n;
			};

			const update = () => {
				const el = this.#videoEl;
				if (!el) return;
				this.#currentTime = el.currentTime;
				this.#duration = el.duration || 0;
				this.#paused = el.paused;
				this.#ended = el.ended || false;
				this.#seeking = el.seeking;
				this.#muted = el.muted;
				ctrlEl.setProps({
					currentTime: this.#currentTime,
					duration: this.#duration,
					paused: this.#paused,
					ended: this.#ended,
					seeking: this.#seeking,
					muted: this.#muted,
					hasAudio: !isAudio,
					minimal: false,
					fullscreenEl: figure,
					onplaypause, onmute, onseek
				});
			};

			ctrlEl.setProps({
				minimal: false,
				paused: true,
				ended: false,
				hasAudio: !isAudio,
				fullscreenEl: figure,
				onplaypause, onmute, onseek
			});
			figure.appendChild(ctrlEl);

			if (this.#videoEl && this.#videoEl instanceof HTMLVideoElement) {
				this.#videoEl.addEventListener('timeupdate', update);
				this.#videoEl.addEventListener('loadedmetadata', update);
				this.#videoEl.addEventListener('play', update);
				this.#videoEl.addEventListener('pause', update);
				this.#videoEl.addEventListener('ended', () => {
					update();
					p.onended?.();
				});
				this.#videoEl.addEventListener('seeking', () => { this.#seeking = true; update(); });
				this.#videoEl.addEventListener('seeked', () => { this.#seeking = false; update(); });
			}
		}

		// Play overlay
		if (!p.noPlayOverlay && !isYoutube && !isVimeo) {
			const overlay = document.createElement('div');
			overlay.className = 'overlay';
			if (!p.autoplay || p.paused) overlay.classList.add('hidden');
			const playBtn = document.createElement('micrio-button') as any;
			playBtn.setProps({ type: 'play', noClick: true });
			overlay.appendChild(playBtn);
			overlay.addEventListener('click', () => {
				const el = this.#videoEl;
				if (el) { el.play().catch(() => { }); overlay.classList.add('hidden'); }
			});
			figure.appendChild(overlay);
		}

		// Tour instance
		if (p.tour && this.#videoEl) {
			this.#tourInstance = new VideoTourInstance(p.image!, p.tour);
		}
	}

	#wireEvents(el: HTMLVideoElement | HTMLAudioElement) {
		const volumeStore = this.inject<any>('volume');
		if (volumeStore) {
			this.#unsubs.push(volumeStore.subscribe((v: number) => { el.volume = v; }));
		}
	}

	#updateControls() {
		const controlsEl = this.querySelector('micrio-media-controls') as any;
		if (controlsEl) {
			controlsEl.setProps({
				currentTime: this.#currentTime,
				duration: this.#duration,
				paused: this.#paused,
				ended: this.#ended,
				seeking: this.#seeking,
				muted: this.#muted,
			});
		}
	}

	onDestroy() {
		this.#tourInstance?.destroy();
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMedia.tag, MicrioMedia);
