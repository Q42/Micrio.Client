import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
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
	onclose?: () => void;
}

export class MicrioMedia extends MicrioElement<MediaProps> {
	static tag = 'micrio-media';
	static styles = `micrio-media figure{position:relative;margin:0;padding:0}
micrio-media figure.hidden{display:none}
micrio-media figure video,micrio-media figure audio{width:100%;display:block}
micrio-media figure figcaption{padding:5px 10px;font-size:.85em;opacity:.7;text-align:center;background:var(--micrio-background)}
micrio-media figure iframe{width:100%;height:100%;border:none;display:block}
micrio-media figure.videotour{position:fixed;bottom:var(--micrio-border-margin);left:50%;transform:translateX(-50%);width:500px;max-width:90vw;display:flex;flex-direction:column;background:var(--micrio-button-background,var(--micrio-background,none));border-radius:var(--micrio-border-radius);box-shadow:var(--micrio-button-shadow);backdrop-filter:var(--micrio-background-filter);margin:0;padding:0;z-index:5}
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
		const isTourOnly = !src && !!p.tour && !!p.image;
		this.replaceChildren();

		const figure = document.createElement('figure');
		figure.className = p.className ?? '';
		if (p.className?.includes('hidden')) figure.classList.add('hidden');
		if (isTourOnly) figure.classList.add('videotour');

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
		} else if (!isTourOnly && isAudio) {
			const audio = document.createElement('audio');
			audio.src = src!;
			audio.controls = !!p.controls;
			audio.preload = 'metadata';
			if (p.autoplay) audio.autoplay = true;
			if (p.muted) audio.muted = true;
			figure.appendChild(audio);
			this.#videoEl = audio;
			this.#wireEvents(audio);
		} else if (!isTourOnly) {
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

		// Tour instance
		if (p.tour && p.image && (this.#videoEl || isTourOnly)) {
			this.#tourInstance = new VideoTourInstance(p.image, p.tour);
			if (isTourOnly) {
				this.#duration = this.#tourInstance.duration;
				const ival = setInterval(() => {
					this.#currentTime = this.#tourInstance!.currentTime;
					this.#duration = this.#tourInstance!.duration;
					this.#paused = this.#tourInstance!.paused;
					this.#ended = this.#tourInstance!.ended;
					this.#updateControls();
					if (this.#ended) p.onended?.();
				}, 250);
				this.#unsubs.push(() => clearInterval(ival));
				if (p.autoplay) this.#tourInstance.play();
			} else {
				const start = () => this.#tourInstance?.play();
				this.#videoEl?.addEventListener('play', start, { once: true });
				if (!this.#videoEl?.paused) start();
			}
		}

		// Controls
		if (p.controls !== false && !isYoutube && !isVimeo) {
			const ctrlEl = document.createElement('micrio-media-controls') as MicrioElement;

			const onplaypause = () => {
				const el = this.#videoEl;
				if (el) {
					if (el.paused) el.play().catch(() => { });
					else el.pause();
				} else if (this.#tourInstance) {
					if (this.#tourInstance.paused) this.#tourInstance.play();
					else this.#tourInstance.pause();
				}
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
				if (el) {
					el.currentTime = n;
				} else if (this.#tourInstance) {
					this.#tourInstance.currentTime = n;
				}
			};

			const update = () => {
				const el = this.#videoEl;
				if (el) {
					this.#currentTime = el.currentTime;
					this.#duration = el.duration || 0;
					this.#paused = el.paused;
					this.#ended = el.ended || false;
					this.#seeking = el.seeking;
					this.#muted = el.muted;
				} else if (this.#tourInstance) {
					return; // tour-only uses its own interval
				} else return;
				ctrlEl.setProps({
					currentTime: this.#currentTime,
					duration: this.#duration,
					paused: this.#paused,
					ended: this.#ended,
					seeking: this.#seeking,
					muted: this.#muted,
					hasAudio: !!p.src && !isAudio,
					minimal: false,
					fullscreenEl: figure,
					onplaypause, onmute, onseek,
					onclose: p.onclose
				});
			};

			ctrlEl.setProps({
				minimal: false,
				paused: true,
				ended: false,
				hasAudio: !!p.src && !isAudio,
				fullscreenEl: figure,
				onplaypause, onmute, onseek,
				onclose: p.onclose
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

		// Play overlay (not for tour-only)
		if (!p.noPlayOverlay && !isYoutube && !isVimeo && !isTourOnly) {
			const overlay = document.createElement('div');
			overlay.className = 'overlay';
			if (!p.autoplay || p.paused) overlay.classList.add('hidden');
			const playBtn = document.createElement('micrio-button') as MicrioElement;
			playBtn.setProps({ type: 'play', noClick: true });
			overlay.appendChild(playBtn);
			overlay.addEventListener('click', () => {
				const el = this.#videoEl;
				if (el) { el.play().catch(() => { }); overlay.classList.add('hidden'); }
			});
			figure.appendChild(overlay);
		}
	}

	#wireEvents(el: HTMLVideoElement | HTMLAudioElement) {
		const volumeStore = this.inject<any>('volume');
		if (volumeStore) {
			this.#unsubs.push(volumeStore.subscribe((v: number) => { el.volume = v; }));
		}
	}

	#updateControls() {
		const controlsEl = this.querySelector('micrio-media-controls') as MicrioElement;
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
