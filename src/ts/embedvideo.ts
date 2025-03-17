import type { Unsubscriber } from 'svelte/motion';
import type { HlsPlayer } from '../types/externals';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';
import type { Wasm } from './wasm';

import { Browser, hasNativeHLS, loadScript } from './utils';
import { tick } from 'svelte';

/** In-WebGL rendered embedded videos, used in <Embed /> */
export class GLEmbedVideo {
	private ism3u:boolean = false;
	private hlsPlayer: HlsPlayer|undefined = undefined;
	private usVid:Unsubscriber|undefined = undefined;
	private vidRepeatTo:any = undefined;
	private placeTo:any = undefined;
	private autoplay:boolean = true;

	_vid:HTMLVideoElement|undefined = undefined;

	isMounted:boolean = true;

	constructor(
		private wasm:Wasm,
		private image:MicrioImage,
		private embed:Models.ImageData.Embed,
		private paused:boolean,
		private moved:() => void
	) {
		this.ism3u = !!embed.video?.streamId && !embed.video?.transparent;
		this._vid = image._video;
		this.autoplay = embed.video?.autoplay ?? true;

		let first:boolean = true;
		this.usVid = this.image.visible.subscribe(v =>  {
			clearTimeout(this.placeTo);
			if(v) this.placeTo = setTimeout(() => {
				if(!this.isMounted) return;
				if(!this._vid) this.load();
				else {
					this.hook();
					if(this.autoplay) this._vid.play();
				}
			}, first ? 0 : 100);
			else this.placeTo = setTimeout(() => this._vid?.pause(), 0);
			first = false;
		});
	}

	unmount() : void {
		this.isMounted = false;
		clearTimeout(this.placeTo);
		clearTimeout(this.vidRepeatTo);
		this._vid?.pause();
		this.unhook();
		this.usVid?.();
	}

	private setPlaying(playing:boolean) : void {
		if(!this._vid) return;
		this.paused = !playing;
		this._vid.dataset.playing = playing ? '1' : undefined;
		this.wasm.e._setImageVideoPlaying(this.image.ptr, playing);
		if(this.embed.hideWhenPaused) this.wasm.fadeImage(this.image.ptr, playing ? 1 : 0);
		if(playing) this.wasm.render();
	}

	private load() : void {
		if(!this.embed.video || this._vid) return;

		// Cloudflare stream doesn't support alpha transparent videos yet,
		// so use the original src if transparency is set to true.
		const src = this.ism3u ? `https://videodelivery.net/${this.embed.video.streamId}/manifest/video.m3u8` : this.embed.video.src;
		this._vid = document.createElement('video');
		this._vid.crossOrigin = 'true';
		this._vid.playsInline = true;
		this._vid.width = this.embed.width! * .5;
		this._vid.height = this.embed.height! * .5;
		this._vid.muted = this.embed.video.muted;

		this.hook();

		if(!this.ism3u || hasNativeHLS(this._vid)) this._vid.src = src;
		else loadScript('https://i.micr.io/hls-1.5.17.min.js', undefined, 'Hls' in window ? {} : undefined).then(() => {
			/** @ts-ignore */
			this.hlsPlayer = new (window['Hls'] as HlsPlayer)();
			this.hlsPlayer.loadSource(src);
			if(this._vid) this.hlsPlayer.attachMedia(this._vid);
		});
	}

	private events = {
		play: () => this.setPlaying(true),
		pause: () => this.setPlaying(false),
		// Only on first frame drawn, print the video
		playing: () => {if(!this.image._video) this.image.video.set(this._vid) },
		// OF COURSE certain iOS versions (iPhone 13..) don't fire the canplay-event
		canplayEvt: Browser.iOS ? 'loadedmetadata' : 'canplay',
		canplay:() => {
			if(!this._vid || !this.isMounted) return;
			// It could already be paused by scale limiting
			if(this.autoplay && !this.paused) {
				this._vid.play();
				this.moved();
			}
			else if(!this.embed.hideWhenPaused) { // Show first frame
				this.setPlaying(true);
				tick().then(() => {
					this.setPlaying(false);
					setTimeout(() => this._vid?.remove(),50);
				})
			}
		}
	}

	private hook() {
		if(!this.embed.video || !this._vid) return;
		const loopAfter = this.embed.video.loopAfter;
		if(this.embed.video.loop && loopAfter) {
			this._vid.onended = () => {
				this.setPlaying(false);
				this.vidRepeatTo = <any>setTimeout(() => this._vid?.play(), loopAfter * 1000) as number;
			}
			this._vid.onplay = () => this.setPlaying(true);
		}
		else this._vid.loop = this.embed.video.loop;

		// If no autoplay, has to be rendered in DOM for first frame visibility
		if(!this._vid.parentNode && !this.autoplay && !this.ism3u) {
			this._vid.setAttribute('style','opacity:0;position:absolute;top:0;left:0;transform-origin:left top;transform:scale(0.1);pointer-events:none;');
			document.body.appendChild(this._vid);
		}

		this._vid.addEventListener('play', this.events.play);
		this._vid.addEventListener('pause', this.events.pause);
		this._vid.addEventListener('playing', this.events.playing, {once:true});
		this._vid.addEventListener(this.events.canplayEvt, this.events.canplay, {once: true});

	}

	private unhook() : void {
		if(!this._vid) return;
		this._vid.removeEventListener('play', this.events.play);
		this._vid.removeEventListener('pause', this.events.pause);
		this._vid.removeEventListener('playing', this.events.playing);
		this._vid.removeEventListener(this.events.canplayEvt, this.events.canplay);
	}

}
