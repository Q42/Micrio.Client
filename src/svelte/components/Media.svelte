<script lang="ts" context="module">
	const iOSAudio = new Audio;
</script>

<script lang="ts">
	import type { Models } from '../../types/models';
	import type { VimeoPlayer, YouTubePlayer, HlsPlayer } from '../../types/externals';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import { get, type Writable } from 'svelte/store';

	import { onMount, getContext, createEventDispatcher } from 'svelte';

	import { i18n } from '../../ts/i18n';
	import { loadScript, Browser, notypecheck } from '../../ts/utils';
	import { VideoTourInstance } from '../../ts/videotour';

	import MediaControls from './MediaControls.svelte';
	import Events from '../virtual/Events.svelte';
	import Button from '../ui/Button.svelte';

	/** Src */
	export let src:string|undefined = undefined;

	/** Volume */
	export let volume: number = 1;

	/** Width */
	export let width: number = 640;

	/** Height */
	export let height: number = 380;

	/** Frame scale */
	export let frameScale: number = 1;

	/** Autoplays */
	export let autoplay: boolean = false;

	/** Loops */
	export let loop: boolean = false;

	/** Pause between loops */
	export let loopDelay: number|undefined = undefined;

	/** Controls */
	export let controls: string|boolean = false;

	/** Embed title */
	export let title: string|undefined = undefined;

	/** Figure caption */
	export let figcaption: string|null = null;

	/** Internal paused state */
	export let paused: boolean = true;

	/** Force pause */
	export let forcePause: boolean|undefined = undefined;

	/** Seeking state*/
	export let seeking: boolean = true;

	/** Duration */
	export let duration: number = -1;

	/** CurrentTime */
	export let currentTime: number = 0;

	/** Muted state*/
	export let muted: boolean = volume == 0;
	const originallyMuted = muted;

	/** Is main 360 vid */
	export let is360: boolean = false;

	/** Optional video tour to sync */
	export let tour: Models.ImageData.VideoTour|null = null;

	/** Tour is secondary to other media */
	export let secondary: boolean = false;

	/** Optional full screen element */
	export let fullscreen:HTMLElement|undefined = undefined;

	/** Optional custom className */
	export let className:string|null = null;

	/** A destroying writable to indicate media should pause */
	export let destroying:Writable<boolean>|undefined = undefined;

	/** Video has transparent .mp4s for Safari */
	export let hasTransparentH265:boolean = false;

	/** Don't show large PLAY button when autoplay blocked */
	export let noPlayOverlay:boolean = false;

	/** Unique identifier */
	export let uuid:string = '';
	uuid += (src ?? tour?.id);

	const micrio = <HTMLMicrioElement>getContext('micrio');

	/** The MicrioImage it belongs to */
	export let image:MicrioImage = get(micrio.current) as MicrioImage;
	const info = image.$info as Models.ImageInfo.ImageInfo;

	const dispatch = createEventDispatcher();

	const {events, state, _lang } = micrio;

	const mainVolume:Writable<number> = getContext('volume');
	const wasMuted = $mainVolume == 0;

	// Gets set in onMount
	let startTime:number;

	// Check if there is a stored starting time and state
	const existing = state.mediaState.get(uuid);
	if(existing) {
		currentTime = existing.currentTime;
		autoplay = !(paused = existing.paused);
	}
	state.mediaState.set(uuid, {
		get currentTime(){return currentTime},
		set currentTime(v:number){setCurrentTime(v)},
		get paused(){return paused},
		set paused(b:boolean){if(b)pause(); else play()}
	});

	// Parse srcs with <iframe> into urls
	if(src && /<iframe /.test(src)) src = src.replace(/^.* src="([^"]+)".*$/,'$1');

	if(src?.startsWith('video://')) src = src.replace('video:','https:');

	enum Type {
		None = 0,
		IFrame = 1,
		Video = 2,
		Audio = 3,
		VideoTour = 4,
		Micrio = 5
	}

	enum FrameType {
		YouTube = 1,
		Vimeo = 2
	}

	/** YouTube url regex */
	const ytUrl = /((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be|youtube-nocookie\.com))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?/;

	/** Use YT nocookies */
	const ytHost = 'https://www.youtube-nocookie.com';

	/** Vimeo url regex */
	const vimeo = /vimeo\.com/;

	/** The corrected iframe src */
	let realSrc: string|undefined = src;

	/** Cloudflare video */
	const isCFVid = src && src.startsWith('cfvid://');

	/** The requested service type */
	const srcL = src && src.toLowerCase();
	const type: Type = srcL ? (
			srcL.endsWith('mp3') ? Type.Audio
			: srcL.endsWith('.mp4') || srcL.endsWith('.webm') || isCFVid ? Type.Video
			: srcL.startsWith('micrio://') ? Type.Micrio
			: srcL.startsWith('http') ? Type.IFrame
			: Type.None
		) : tour ? Type.VideoTour
		: Type.None;

	/** Micrio */
	const mic = type == Type.Micrio ? src?.slice(9).split(',') : null;
	if(mic) paused = false;

	/** IFrame type */
	let frameType: FrameType|undefined;

	/** YouTube API player */
	let ytPlayer: YouTubePlayer|undefined;

	/** Vimeo API player */
	let vimeoPlayer: VimeoPlayer|undefined;

	/** HLS cloudflare vid player */
	let hlsPlayer: HlsPlayer|undefined;

	/** Currenttime ticker interval ptr */
	let _tick: number = -1;

	/** Hooked means no pointer events */
	let hooked:boolean = false;

	/** For iOS -- autoplay audio is per <audio> element, so use a single one for everything */
	const singleAudio:boolean = type == Type.Audio && Browser.iOS;

	let scale:number = 1;

	let _frame:HTMLIFrameElement;
	export let _media:HTMLMediaElement|undefined = undefined;

	const noJSPlayers = micrio.hasAttribute('data-native-frame');

	// YouTube
	const ytMatch = src && ytUrl.exec(src);
	const timeRegExp = /^.*t=(\d+).*$/;
	if(src && !noJSPlayers && ytMatch && ytMatch[5]) {
		if(ytMatch[5] == 'playlist') {
			const listId = /list=([^&]+)/.exec(src);
			if(listId?.[1]) realSrc = `${ytHost}/embed/videoseries?list=${listId[1]}`;
		}
		else {
			frameType = FrameType.YouTube;
			const startingTime = Math.round((timeRegExp.test(src) ? Number(src.replace(timeRegExp,'$1')) : currentTime) ?? 0);
			realSrc = `${ytHost}/embed/${ytMatch[5]}?autoplay=0&enablejsapi=1&controls=0&start=${startingTime}`;
			hooked = true;
		}
	}

	// Vimeo
	if(!noJSPlayers && src && vimeo.test(src)) {
		const id = src.match(/\/(\d+)/);
		if(id && id[1]) {
			const token = src.slice(src.indexOf(id[1])+id[1].length+1).replace(/\?.*$/,'');
			frameType = FrameType.Vimeo;
			realSrc = `https://player.vimeo.com/video/${id[1]}?${token ? `h=${token}&` : ''}title=0&portrait=0&sidedock=0&byline=0&controls=0#t=`+Math.round(currentTime)+'s';
			hooked = true;
		}
	}

	// Cloudflare video
	let cfVidSrc:string;
	if(isCFVid && src) {
		// IOS can straight up play vid IDs
		cfVidSrc = `https://videodelivery.net/${src.slice(8)}/manifest/video.m3u8`;
		if(Browser.iOS) realSrc = cfVidSrc;
		else realSrc = undefined;
	}

	// Micrio video tour
	let videoTour:VideoTourInstance;
	if(tour) {
		videoTour = new VideoTourInstance(image, tour);
		if(currentTime > 0) videoTour.currentTime = currentTime;
		if(type == Type.VideoTour) { // No audio
			duration = 'duration' in tour ? Number(tour.duration) : tour.i18n?.[$_lang]?.duration ?? 0;
			volume = NaN;
		}
	}

	// Regular iframes or micrio embedsdon't get controls
	if(type == Type.Micrio || (type == Type.IFrame && !frameType)) controls=false;

	/** SRT subtitle file src */
	const sub:Models.Assets.Subtitle|undefined = tour && !('steps' in tour) ? ('subtitle' in tour ? tour['subtitle'] as Models.Assets.Subtitle : tour.i18n?.[micrio.lang]?.subtitle) : undefined;
	const srt = sub && ('fileUrl' in sub ? sub['fileUrl'] as string : sub.src);
	const subtitle = getContext<Writable<string|undefined>>('srt');

	function canplay() : void {
		seeking = false;
		if(is360 && image && !image._video) image.video.set(_media as HTMLVideoElement);
	}

	let showPlayButton: boolean = false;

	// When <audio> or <video> succesfully started playing
	function mediaPlaying(){
		showPlayButton = false;
		paused = false;
		if(videoTour && _media) {
			videoTour.duration = _media.duration;
			videoTour.currentTime = _media.currentTime;
			videoTour.play();
		}
	}

	function playPause(e?:PointerEvent|CustomEvent) : void {
		if(e && 'button' in e && e.button != 0) return;
		if(paused) play();
		else pause();
	}

	const isPaused = async () : Promise<boolean> => _media ? _media.paused
		: videoTour ? paused
		// Unloaded, ended, paused YT state
		: ytPlayer ? [-1,0,2].indexOf(ytPlayer.getPlayerState()) >= 0
		// In case YT player hasn't loaded yet
		: frameType == FrameType.YouTube ? paused
		: vimeoPlayer ? await vimeoPlayer.getPaused()
		: false;

	let wasPlaying:Function;
	let frameAutoplayBlocked:boolean = false;
	let hasInited:boolean = false;

	// Global paused state
	const mediaPaused = getContext<Writable<boolean>>('mediaPaused');

	let loopDelayTo:any;

	async function play(e?:PointerEvent) : Promise<void> {
		if(e && e instanceof PointerEvent && e.button != 0) return;
		if(hasInited && !(await isPaused())) return;
		_ended = false;

		// If it was ended before, reset time
		if(duration > 0 && currentTime >= duration) currentTime = 0;

		// Show subtitles if not secondary media
		if(!secondary && srt) subtitle.set(srt);

		switch(type) {
			case Type.VideoTour:
				paused = seeking = false;
				videoTour.play();
				startTick();
			break;
			case Type.Audio: case Type.Video:
				_media?.addEventListener('play', mediaPlaying, {once: true});
				_media?.play().catch((e) => {
					if(noPlayOverlay) paused = true;
					else if(!/pause\(\)/.test(e.toString())) {
						showPlayButton = true;
						dispatch('blocked');
					}
				});
			break;
			case Type.IFrame: {
				switch(frameType) {
					case FrameType.YouTube:
						if(ytPlayer) ytPlayer.playVideo();
					break;
					case FrameType.Vimeo:
						if(vimeoPlayer) vimeoPlayer.play();
					break;
				}
			} break;
			default: return;
		}

		hasInited = true;
		events.dispatch('media-play');
		mediaPaused.set(false);
		dispatch('play');

		// Fade volume out if not silent video tour
		if(!is360 && !wasMuted && !(videoTour && !_media)) mainVolume.set(image.$settings.mutedVolume||0);
	}

	function pause() : void {
		events.dispatch('media-pause');
		mediaPaused.set(true);
		if(_media) {
			_media.pause();
			if(singleAudio) paused = true;
		}
		else if(videoTour) { videoTour.pause(); paused = true; endTick(); }
		else if(ytPlayer?.pauseVideo && !destroyed) ytPlayer.pauseVideo();
		else if(vimeoPlayer?.pause) vimeoPlayer.pause();
	}

	function setMuted(b:boolean) : void {
		if(originallyMuted) return;
		muted = b;

		if(_media) _media.muted = b;
		else if(ytPlayer?.mute) {
			if(b) ytPlayer.mute();
			else ytPlayer.unMute();
			// This only works correctly after timeout
			setTimeout(() => {if(ytPlayer) muted = ytPlayer.isMuted()}, 50);
		}
		else if(vimeoPlayer) vimeoPlayer.setVolume(b ? 0 : 1);
	}


	function setCurrentTime(v:number) : void {
		seeking = true;
		if(_media) _media.currentTime = v;
		else if(videoTour) { currentTime = videoTour.currentTime = v; seeking = false; }
		else if(ytPlayer?.seekTo) ytPlayer.seekTo(v);
		else if(vimeoPlayer?.setCurrentTime) vimeoPlayer.setCurrentTime(v);
	}
	function getCurrentTime() : void {
		if(videoTour) {
			currentTime = videoTour.currentTime;
			if(videoTour.ended) ended();
		}
		else if(ytPlayer?.getCurrentTime) { currentTime = ytPlayer.getCurrentTime(); }
		sendTimeupdate();
	}

	function sendTimeupdate() : void {
		if(!secondary) events.dispatch('timeupdate', currentTime);
	}

	let _ended:boolean = false;
	function ended() : void {
		if(_ended) return;
		if(videoTour) pause();
		else { paused = true; endTick(); }
		_ended = true;
		events.dispatch('media-ended');
		dispatch('ended');
		stoppedPlaying();
	}

	function startTick() : void {
		if(_tick >= 0) return;
		_tick = <any>setInterval(getCurrentTime, 250) as number; getCurrentTime();
	}
	function endTick() : void {
		clearInterval(_tick);
		_tick = -1;
	}

	async function loadYouTube() : Promise<void> {
		if(ytPlayer) return;
		/** @ts-ignore */
		if(!window['YT']) await loadScript('https://i.micr.io/youtube.js', 'onYouTubeIframeAPIReady');
		/** @ts-ignore */
		if(!window['YT']) {
			// Something went wrong, bring back control to iframe
			hooked = false;
			return;
		}
		seeking = true;
		/** @ts-ignore */
		return new Promise((ok, err) => { ytPlayer = new (window['YT']['Player'] as YouTubePlayer)(_frame, {
			host: ytHost, width: rWidth.toString(), height: rHeight.toString(), playerVars: { controls: 0 }, events: {
				onError: err,
				onReady: () => {
					if(destroyed) err();
					else {
						muted = (ytPlayer as YouTubePlayer).isMuted();
						duration = (ytPlayer as YouTubePlayer).getDuration();
						seeking = false;
						ok();
					}
				},
				onStateChange: e => { switch(e.data) {
					// Loading or autoplay blocked
					case -1: frameAutoplayBlocked = paused = true; endTick(); break;
					// Ended
					case 0: ended();break;
					// Playing
					case 1: startTick(); frameAutoplayBlocked = paused = seeking = false; break;
					// Paused
					case 2: paused = true; endTick();break;
					// Buffering
					case 3: getCurrentTime(); seeking = true; endTick();break;
				}},
			}
		})})
	}

	async function loadVimeo() : Promise<void> {
		if(vimeoPlayer) return;
		/** @ts-ignore */
		if(!window['Vimeo']) await loadScript('https://i.micr.io/vimeo.min.js');
		/** @ts-ignore */
		if(!window['Vimeo']) {
			// Something went wrong, bring back control to iframe
			hooked = false;
			return;
		}
		seeking = true;
		return new Promise((ok, err) => {
			/** @ts-ignore */
			const p = vimeoPlayer = new (window['Vimeo']['Player'] as VimeoPlayer)(_frame, {
				width: rWidth.toString(), height: rHeight.toString(), title: false, autoplay: false
			});
			p.on('error', err);
			p.on('loaded', () => p.getVolume().then(v => {
				if(destroyed) err();
				else { muted = (volume = v) == 0; ok() }
			}));
			p.on('play', () => paused = seeking = false);
			p.on('bufferstart', () => seeking = true);
			p.on('seeked', () => { seeking = false; });
			p.on('pause', () => paused = true);
			p.on('volumechange', d => {if(d) muted = (volume = d.volume) == 0});
			p.on('timeupdate', d => { if(d) {duration = d.duration; currentTime = d.seconds }});
			p.on('ended', ended);
		})
	}

	async function loadPlayer() : Promise<void> {
		// Print cloudflare vid using hls.min.js
		if(isCFVid && !Browser.iOS) return loadScript('https://i.micr.io/hls-1.4.5.min.js', undefined, 'Hls' in window ? {} : undefined).then(() => {
			/** @ts-ignore */
			hlsPlayer = new (window['Hls'] as HlsPlayer)();
			hlsPlayer.loadSource(cfVidSrc);
			if(_media) hlsPlayer.attachMedia(_media);
		})
		else if(type == Type.IFrame) {
			if(frameType == FrameType.YouTube) return loadYouTube();
			if(frameType == FrameType.Vimeo) return loadVimeo();
		}
		else if(_media) hookMedia();
	}

	// Hook <video> or <audio> events
	let pauseAfterSeek:boolean = false;
	function hookMedia(){
		if(!_media) return;

		_media.ontimeupdate = sendTimeupdate;

		// If there is an additional media element (<audio>), keep updating that
		if(videoTour) {
			_media.onpause = () => videoTour.pause();
			_media.onseeked = () => {
				if(!_media || _media.ended) return;
				videoTour.currentTime = _media.currentTime;
				if(pauseAfterSeek) {
					_media.pause();
					pauseAfterSeek = false;
				}
			}
		}

		// Starting time
		if(currentTime > 0) {
			// Already available
			if(_media.duration > 0) _media.currentTime = currentTime;
			else _media.oncanplay = () => {
				if(!_media) return;
				_media.oncanplay = null;
				if(!autoplay) {
					_media.play();
					pauseAfterSeek = true;
				}
				_media.currentTime = startTime;
			}
		}

		const ld = loop && loopDelay !== undefined ? loopDelay : -1;
		if(ld > 0) _media.onended = () => {
			clearTimeout(loopDelayTo);
			loopDelayTo = setTimeout(() => {
				if(!forcePause) _media?.play()
			}, ld * 1000);
		}
	}

	function cto() {
		clearTimeout(loopDelayTo);
	}

	function stoppedPlaying():void{
		if(!wasMuted) mainVolume.set(1);
		if(wasPlaying) wasPlaying();
	}

	// Called when parent element is starting to be destroyed
	let destroyed:boolean = false;

	// When destroying writable, watch this to stop all media
	const unsub = destroying && destroying.subscribe(d => d && preDestroy());

	/** For manual single Audio element for iOS */
	const iOSAudioTimeUpdate = () => currentTime = _media?.currentTime ?? 0;

	function preDestroy(){
		if(destroyed) return;
		destroyed = true;
		if(unsub) unsub();
		if(is360 && image) image.video.set(undefined);
		state.mediaState.delete(uuid);
		endTick();
		pause();
		stoppedPlaying();
		if(srt) subtitle.set(undefined);
		if(_media) {
			_media.onended = null;
			if(singleAudio) {
				_media.onloadedmetadata = _media.onplay = _media.onseeking = _media.onseeked = null;
				_media.removeEventListener('timeupdate', iOSAudioTimeUpdate);
			}
			_media.ontimeupdate = _media.onpause = _media.onseeked = _media.oncanplay = null;
		}
		if(videoTour) videoTour.destroy();
		else if(vimeoPlayer) for(let k of ['error', 'loaded', 'play', 'bufferstart', 'seeked',
			'pause', 'volumechange', 'timeupdate', 'ended']) vimeoPlayer.off(k);
	}

	onMount(() => {
		dispatch('id', uuid);
		if(src && singleAudio) {
			_media = iOSAudio;
			_media.controls = false;
			_media.onloadedmetadata = () => duration = _media?.duration ?? 0;
			_media.src = src;
			_media.oncanplay = canplay;
			_media.onended = ended;
			_media.addEventListener('timeupdate', iOSAudioTimeUpdate);
			_media.onseeking = () => seeking = true;
			_media.onseeked = () => seeking = false;
		}
		startTime = currentTime || 0;
		hooked = frameType == FrameType.YouTube || frameType == FrameType.Vimeo;
		loadPlayer().then(() => { if(autoplay) play() }).catch(() => {});

		// Watch global muted state to mute/unmute this media
		const unsubscribeChangeGlobalMuted = micrio.isMuted.subscribe(b => setMuted(b));

		return () => {
			preDestroy();
			unsubscribeChangeGlobalMuted();
			if(singleAudio) _media = undefined;
			if(hlsPlayer) hlsPlayer.destroy();
			else if(ytPlayer) ytPlayer.destroy();
			else if(vimeoPlayer) vimeoPlayer.destroy();
		}
	});

	// Watch the volume property
	$: if(_media && type == Type.Video && !muted) _media.muted = volume == 0;
	$: { if(forcePause !== undefined) paused = forcePause; }
	$: { if(loop && loopDelay !== undefined) cto(); }

	$: videoTourEvents = videoTour && tour ? 'events' in tour ? tour.events as Models.ImageData.VideoTourView[] : tour.i18n?.[$_lang]?.events ?? undefined : undefined;

	let _cnt:HTMLElement;

	const isVideo = type == Type.Video;
	const scaleFact = info.is360 ? Math.PI/2 : 1;
	/** Cap the iframe width and height because nobody wants <iframe width="10000"> */
	$: relScale = isVideo ? frameScale * scaleFact : type == Type.IFrame ? Math.max(frameScale, Math.min(width / 512, height / 512)) : 1;
	$: rWidth = isVideo ? width : Math.round(width / relScale * scaleFact);
	$: rHeight = isVideo ? height : Math.round(height / relScale * scaleFact);

</script>

{#if !image.$settings.noUI}
<figure bind:this={_cnt} class:paused class:is360 class:media-video={type == Type.IFrame || type == Type.Video}
	class:media-micrio={type == Type.Micrio} class={className} style={scale!=1?`--scale:${1/scale}`:null}>
	<div on:pointerup|self={playPause} class:videotour={!!videoTour}
		style={relScale != 1 && (type == Type.Video || !info.is360) ? `transform:scale(${relScale})`:''}>
		{#if type == Type.IFrame}<iframe {...notypecheck({credentialless:true})} {title} src={realSrc} width={rWidth} height={rHeight} class:hooked={hooked && !frameAutoplayBlocked} bind:this={_frame}
			frameborder="0" allow="fullscreen *;autoplay *;encrypted-media *"></iframe>
		{:else if type == Type.Video}
			<!-- svelte-ignore a11y-media-has-caption -->
			<video controls={false} loop={loop && (loopDelay == undefined || loopDelay <= 0)} playsinline width={rWidth} height={rHeight} bind:this={_media}
				bind:duration bind:muted autoplay={!!autoplay} bind:currentTime bind:seeking bind:paused on:canplay={canplay} on:ended={ended}>{#if realSrc}
				{#if hasTransparentH265 && realSrc.endsWith('.webm')}<source src={realSrc.replace('.webm', '.mp4')} type="video/mp4;codecs=hvc1">{/if}
				<source src={realSrc}>{/if}
			</video>
		{:else if type == Type.Audio && !singleAudio}
			<audio src={realSrc} controls={false} bind:this={_media} bind:duration bind:muted
				bind:currentTime bind:seeking bind:paused on:canplay={() => seeking = false} on:ended={ended} />
		{:else if type == Type.Micrio && mic}
			<micr-io data-logo="false" id={mic[0]} width={mic[1]} height={mic[2]} lang={mic[3]} data-path={info.path}></micr-io>
		{/if}
		{#if videoTourEvents?.length && duration > 0 && !$destroying}<Events events={videoTourEvents} bind:currentTime bind:duration />{/if}
		{#if controls}<aside class:inside={controls=='inside'}><MediaControls subtitles={!!srt} fullscreen={(!is360 && (type == Type.IFrame || type == Type.Video)) ? _cnt : fullscreen}
			bind:paused bind:seeking bind:duration bind:currentTime bind:muted bind:volume bind:ended={_ended}
			on:playpause={playPause} on:mute={() => micrio.isMuted.set(!muted)}
			on:seek={e => setCurrentTime(e.detail)} /></aside>{/if}
	</div>
	{#if figcaption}<figcaption>{@html figcaption}</figcaption>{/if}
</figure>
{#if showPlayButton}<div class="show-play" on:pointerup={play}><Button title={$i18n.play} type="play" /></div>{/if}
{/if}

<style>
	figure {
		display: block;
		margin: 0;
		width: 100%;
	}
	figure div {
		cursor: pointer;
	}
	figure div.videotour {
		display: flex;
	}
	figure:global(:fullscreen) div {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	figure:global(:fullscreen) div > :global(:first-child) {
		flex: 1;
	}
	:global(.marker-popup) > figure > div {
		width: 100%;
	}
	iframe, video {
		display: block;
		max-width: unset;
	}
	figure.is360 {
		position: absolute;
		bottom: 5px;
		width: 360px;
		left: 50%;
		transform: translateX(-50%);
	}
	figure.is360 video {
		display: none;
		width: 200px;
		height: 200px;
	}
	iframe.hooked {
		pointer-events: none;
	}
	figcaption {
		font-style: italic;
		margin: .5em 1em .5em 1em;
		text-align: center;
		font-size: 90%;
		color: var(--micrio-color);
	}
	:global(:not(.micrio-popover)) > figure > figcaption > :global(*) {
		margin: 0;
	}
	:global(.micrio-popover) figure {
		margin: 0;
	}

	/** Controls */
	aside {
		width: 100%;
		display: flex;
	}
	aside.inside {
		position: absolute;
		transform: translateY(-100%);
	}
	:global(figure.paused) > aside.inside {
		display: none;
	}

	div.show-play {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		cursor: pointer;
		background: #0008;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	div.show-play > :global(button.micrio-button) {
		transform: scale(2);
	}

	figure:not(.media-micrio) :global(button.micrio-button) {
		margin: 0;
		border: none;
		border-radius: 0;
		white-space: pre;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}
	figure.media-micrio {
		text-align: var(--micrio-text-align);
	}

</style>
