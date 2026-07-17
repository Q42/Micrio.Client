import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { VideoTourInstance } from './videotour';
import { YouTubePlayerAdapter } from './youtube-adapter';
import { VimeoPlayerAdapter } from './vimeo-adapter';
import { HLSPlayerAdapter, cloudflareStreamUrl, mediaSourceSupported } from './hls-adapter';
import type { MediaPlayerAdapter } from './types';
import '$ui/button';
import './media-controls';

const YOUTUBE_RE = /((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be|youtube-nocookie\.com))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?/;
const VIMEO_RE = /vimeo\.com/;

export interface MediaProps {
	src?: string;
	image?: MicrioImage;
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
	figcaption?: string;
	className?: string;
	onended?: () => void;
	onclose?: () => void;
	getTimeDisplay?: (currentTime: number, duration: number) => string;
	hasAudio?: boolean;
	fullscreenEl?: HTMLElement;
}

export class MicrioMedia extends MicrioElement<MediaProps> {
	static tag = 'micrio-media';
	static styles = `micrio-media{display:block}
micrio-media figure{position:relative;margin:0;padding:0}
micrio-media figure video,micrio-media figure audio{width:100%;display:block}
micrio-media figure figcaption{padding:5px 10px;font-size:.85em;opacity:.7;text-align:center;background:var(--micrio-background)}
micrio-media figure iframe{width:100%;border:none;display:block}
micrio-media figure:has(video){width:auto}
micrio-media figure.videotour{position:fixed;bottom:var(--micrio-border-margin);left:50%;transform:translateX(-50%);width:500px;max-width:90vw;display:flex;flex-direction:column;background:var(--micrio-button-background,var(--micrio-background,none));border-radius:var(--micrio-border-radius);box-shadow:var(--micrio-button-shadow);backdrop-filter:var(--micrio-background-filter);margin:0;padding:0;z-index:5}
micrio-media figure.hidden{display:none!important}
micrio-media figure .overlay{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1;background:rgba(0,0,0,.3);transition:opacity .3s ease}
micrio-media figure .overlay.hidden{opacity:0;pointer-events:none}
micrio-media figure .overlay micrio-button{--micrio-button-size:80px;--micrio-icon-size:40px;--micrio-border-radius:100%;--micrio-button-background:rgba(0,0,0,.6);--micrio-button-shadow:none;--micrio-background-filter:none;pointer-events:none}`;

	#videoEl: HTMLVideoElement | HTMLAudioElement | undefined;
	#tourInstance: VideoTourInstance | undefined;
	#frame: HTMLIFrameElement | undefined;
	#hlsSrc: string | undefined;
	#adapter: MediaPlayerAdapter | undefined;
	#adapterTick: ReturnType<typeof setInterval> | undefined;
	#paused = true;
	#ended = false;
	#duration = 0;
	#currentTime = 0;
	#seeking = false;
	#muted = false;
	#subEl: MicrioElement | undefined;

	#createYoutubeIframe(src: string, p: MediaProps, figure: HTMLElement) {
		const match = src.match(YOUTUBE_RE);
		const videoId = match?.[5];
		if (!videoId) return;
		const iframe = createElement('iframe', {
			props: {
				src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${p.autoplay ? 1 : 0}&playsinline=1&enablejsapi=1`,
				width: String(p.width ?? 400),
				height: String(p.height ?? 240),
			},
			attrs: {
				allow: 'autoplay; encrypted-media',
				allowfullscreen: '',
			},
			parent: figure,
		});
		this.#frame = iframe;
	}

	#createVimeoIframe(src: string, p: MediaProps, figure: HTMLElement) {
		const idMatch = src.match(/\/(\d+)/);
		if (!idMatch?.[1]) return;
		const vimeoId = idMatch[1];
		const tokenPart = src.slice(src.indexOf(vimeoId) + vimeoId.length + 1);
		const vimeoToken = tokenPart.replace(/\?.*$/, '') || undefined;
		const embedSrc = `https://player.vimeo.com/video/${vimeoId}?${vimeoToken ? `h=${vimeoToken}&` : ''}title=0&portrait=0&sidedock=0&byline=0&controls=0`;
		const iframe = createElement('iframe', {
			props: {
				src: embedSrc,
				width: String(p.width ?? 400),
				height: String(p.height ?? 240),
			},
			attrs: {
				allow: 'autoplay; fullscreen',
				allowfullscreen: '',
			},
			parent: figure,
		});
		this.#frame = iframe;
	}

	#createCloudflareVideo(src: string, p: MediaProps, figure: HTMLElement) {
		const cfId = src.slice(8);
		const hlsSrc = cloudflareStreamUrl(cfId);
		const video = createElement('video', {
			props: {
				src: hlsSrc,
				width: p.width ?? 400,
				height: p.height ?? 240,
				controls: false,
				preload: 'metadata',
				playsInline: true,
				crossOrigin: 'anonymous',
				...(p.autoplay ? { autoplay: true } : {}),
				...(p.muted ? { muted: true } : {}),
			},
			parent: figure,
		});
		this.#videoEl = video;
		this.#wireEvents(video);
		this.#hlsSrc = hlsSrc;
	}

	#createAudioElement(src: string, p: MediaProps, figure: HTMLElement) {
		const audio = createElement('audio', {
			props: {
				src,
				controls: false,
				preload: 'metadata',
				...(p.autoplay ? { autoplay: true } : {}),
				...(p.muted ? { muted: true } : {}),
			},
			style: { display: 'none' },
			parent: figure,
		});
		this.#videoEl = audio;
		this.#wireEvents(audio);
	}

	#createNativeVideo(src: string, p: MediaProps, figure: HTMLElement) {
		const video = createElement('video', {
			props: {
				src,
				width: p.width ?? 400,
				height: p.height ?? 240,
				controls: false,
				preload: 'metadata',
				playsInline: true,
				crossOrigin: 'anonymous',
				...(p.autoplay ? { autoplay: true } : {}),
				...(p.muted ? { muted: true } : {}),
			},
			parent: figure,
		});
		this.#videoEl = video;
		this.#wireEvents(video);
	}

	protected _render() {
		const p = this._props;
		const src = p.src;
		if (!src && !p.tour) { this.replaceChildren(); return; }

		const isYoutube = src ? YOUTUBE_RE.test(src) : false;
		const isVimeo = src ? VIMEO_RE.test(src) : false;
		const isCloudflare = src ? src.startsWith('cfvid://') : false;
		const isAudio = src ? src.includes('.mp3') || src.includes('.ogg') || src.includes('.wav') || src.includes('audio/') : false;
		const isTourOnly = !src && !!p.tour && !!p.image;
		this.replaceChildren();

		const figure = createElement('figure', {
			className: p.className ?? undefined,
		});
		if (p.className?.includes('hidden')) figure.classList.add('hidden');
		if (isTourOnly) figure.classList.add('videotour');

		if (p.is360) figure.style.setProperty('--micrio-background', 'transparent');

		if (isYoutube) {
			this.#createYoutubeIframe(src!, p, figure);
		} else if (isVimeo) {
			this.#createVimeoIframe(src!, p, figure);
		} else if (isCloudflare) {
			this.#createCloudflareVideo(src!, p, figure);
		} else if (!isTourOnly && isAudio) {
			this.#createAudioElement(src!, p, figure);
		} else if (!isTourOnly) {
			this.#createNativeVideo(src!, p, figure);
		}

		if (p.figcaption) {
			createElement('figcaption', {
				textContent: p.figcaption,
				parent: figure,
			});
		}

		this.appendChild(figure);

		// Initialize player adapters
		if (this.#frame) {
			const pWidth = p.width ?? 400;
			const pHeight = p.height ?? 240;
			if (isYoutube) {
				this.#adapter = new YouTubePlayerAdapter(this.#frame, { width: pWidth, height: pHeight }, {
					onPlay: () => { this.#paused = false; this.#startAdapterTick(); this.#updateControls(); },
					onPause: () => { this.#paused = true; this.#stopAdapterTick(); this.#updateControls(); },
					onEnded: () => { this.#ended = true; this.#paused = true; this.#stopAdapterTick(); this.#updateControls(); p.onended?.(); },
					onSeeking: () => { this.#seeking = true; },
					onSeeked: () => { this.#seeking = false; this.#updateControls(); },
				});
				(this.#adapter as YouTubePlayerAdapter).initialize().then(() => { if (p.autoplay) this.#adapter!.play(); }).catch(() => {});
			} else if (isVimeo) {
				this.#adapter = new VimeoPlayerAdapter(this.#frame, { width: pWidth, height: pHeight }, {
					onPlay: () => { this.#paused = false; this.#updateControls(); },
					onPause: () => { this.#paused = true; this.#updateControls(); },
					onEnded: () => { this.#ended = true; this.#paused = true; this.#updateControls(); p.onended?.(); },
					onTimeUpdate: (t) => { this.#currentTime = t; this.#updateControls(); },
					onDurationChange: (d) => { this.#duration = d; },
				});
				(this.#adapter as VimeoPlayerAdapter).initialize().then(() => { if (p.autoplay) this.#adapter!.play(); }).catch(() => {});
			}
		}

		// Initialize HLS adapter for Cloudflare video
		if (isCloudflare && this.#hlsSrc && this.#videoEl && mediaSourceSupported()) {
			this.#adapter = new HLSPlayerAdapter(this.#videoEl as HTMLVideoElement, this.#hlsSrc, {
				onReady: () => { this.#updateControls(); },
				onEnded: () => { this.#ended = true; this.#paused = true; this.#updateControls(); p.onended?.(); },
			});
			(this.#adapter as HLSPlayerAdapter).initialize().catch(() => {});
		}

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
					if (!p.secondary) this.getMicrio()?.dispatchEvent(new CustomEvent('timeupdate', { detail: this.#currentTime }));
					if (this.#ended) p.onended?.();
				}, 250);
				this.addCleanup(() => clearInterval(ival));
				if (p.autoplay) this.#tourInstance.play();
			} else {
				const start = () => this.#tourInstance?.play();
				this.#videoEl?.addEventListener('play', start);
				this.#videoEl?.addEventListener('pause', () => this.#tourInstance?.pause());
				this.#videoEl?.addEventListener('ended', () => this.#tourInstance?.pause());
				if (!this.#videoEl?.paused) start();
			}
		}

		// Create subtitles element as a child (auto-destroyed when media is removed)
		if (!p.secondary && p.tour && !('steps' in p.tour)) {
			const micrio = this.getMicrio();
			const lang = micrio?.lang || 'en';
			const sub = p.tour.i18n?.[lang]?.subtitle;
			if (sub?.src) {
				this.#subEl = createElement('micrio-subtitles', {
					setProps: { src: sub.src, mediaEl: this },
					parent: (this.closest('micrio-main') || this.parentNode) as HTMLElement | undefined,
				}) as MicrioElement;
			}
		}

		// Controls
		if (p.controls !== false) {
			const hasSub = !p.secondary && !!p.tour && !('steps' in p.tour) && !!(p.tour.i18n?.[(this.getMicrio()?.lang || 'en')]?.subtitle);

			const onplaypause = () => {
				const el = this.#videoEl;
				if (el) {
					if (el.paused) el.play().catch(() => { });
					else el.pause();
				} else if (this.#tourInstance) {
					if (this.#tourInstance.paused) this.#tourInstance.play();
					else this.#tourInstance.pause();
				} else if (this.#adapter) {
					this.#adapter.isPaused().then(paused => {
						if (paused) this.#adapter!.play();
						else this.#adapter!.pause();
					});
				}
			};

			const onmute = () => {
				const el = this.#videoEl;
				if (el) {
					this.#muted = !this.#muted;
					el.muted = this.#muted;
					this.#updateControls();
				} else if (this.#adapter) {
					this.#muted = !this.#muted;
					this.#adapter.setMuted(this.#muted);
					this.#updateControls();
				}
			};

			const onseek = (n: number) => {
				const el = this.#videoEl;
				if (el) {
					el.currentTime = n;
				} else if (this.#tourInstance) {
					this.#tourInstance.currentTime = n;
				} else if (this.#adapter) {
					this.#adapter.setCurrentTime(n);
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
				} else if (this.#adapter) {
					// YouTube tick updates #currentTime already; Vimeo uses callbacks
					return;
				} else return;
				ctrlEl.setProps({
					currentTime: this.#currentTime,
					duration: this.#duration,
					paused: this.#paused,
					ended: this.#ended,
					seeking: this.#seeking,
					muted: this.#muted,
					hasAudio: p.hasAudio ?? (!!p.src && !isAudio),
					subtitles: hasSub,
					getTimeDisplay: p.getTimeDisplay,
					fullscreenEl: p.fullscreenEl ?? (isAudio ? undefined : figure),
					onplaypause, onmute, onseek,
					onclose: p.onclose
				});
			};

			const ctrlEl = createElement('micrio-media-controls', {
				setProps: {
					paused: true,
					ended: false,
					hasAudio: p.hasAudio ?? (!!p.src && !isAudio),
					subtitles: hasSub,
					getTimeDisplay: p.getTimeDisplay,
					fullscreenEl: p.fullscreenEl ?? (isAudio ? undefined : figure),
					onplaypause, onmute, onseek,
					onclose: p.onclose
				},
				parent: figure,
			}) as MicrioElement;

			if (this.#videoEl && (this.#videoEl instanceof HTMLVideoElement || this.#videoEl instanceof HTMLAudioElement)) {
				this.#videoEl.addEventListener('timeupdate', () => {
					update();
					if (!p.secondary) this.getMicrio()?.dispatchEvent(new CustomEvent('timeupdate', { detail: this.#currentTime }));
				});
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

		// Play overlay (360 full-window video only)
		if (p.is360 && !p.noPlayOverlay && !isTourOnly) {
			const overlay = createElement('div', {
				className: 'overlay' + (!p.autoplay || p.paused ? ' hidden' : ''),
				children: [
					createElement('micrio-button', {
						setProps: { type: 'play', noClick: true },
					}) as Node,
				],
				events: {
					click: () => {
						const el = this.#videoEl;
						if (el) { el.play().catch(() => { }); overlay.classList.add('hidden'); }
						else if (this.#adapter) { this.#adapter.play(); overlay.classList.add('hidden'); }
					},
				},
				parent: figure,
			});
		}
	}

	#wireEvents(el: HTMLVideoElement | HTMLAudioElement) {
		const volumeStore = this.inject<any>('volume');
		if (volumeStore) {
			this.addCleanup(volumeStore.subscribe((v: number) => { el.volume = v; }));
		}
	}

	#startAdapterTick() {
		if (this.#adapterTick != null) return;
		this.#adapterTick = setInterval(async () => {
			if (!this.#adapter) return;
			this.#currentTime = await this.#adapter.getCurrentTime();
			this.#duration = await this.#adapter.getDuration();
			this.#updateControls();
		}, 250);
	}

	#stopAdapterTick() {
		if (this.#adapterTick != null) {
			clearInterval(this.#adapterTick);
			this.#adapterTick = undefined;
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
		this.#adapter?.destroy();
		this.#stopAdapterTick();
		this.#subEl?.remove();
	}
}

customElements.define(MicrioMedia.tag, MicrioMedia);
