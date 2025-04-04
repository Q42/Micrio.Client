<script lang="ts" module>
	/**
	 * Module script for Media.svelte
	 *
	 * Creates a single, shared Audio element instance, primarily as a workaround
	 * for iOS audio playback restrictions where user interaction is often required
	 * to initiate audio playback per element. Using a single element can help.
	 */
	const iOSAudio = new Audio;
</script>

<script lang="ts">
	/**
	 * Media.svelte - Versatile component for rendering various media types.
	 *
	 * Handles playback and controls for:
	 * - Standard HTML5 <audio> and <video>
	 * - YouTube and Vimeo embeds (via their respective JS APIs)
	 * - HLS video streams (using hls.js if needed)
	 * - Cloudflare video streams
	 * - Micrio video tours (synchronizing camera movement with audio/video)
	 * - Embedded Micrio instances
	 *
	 * It manages playback state (play/pause/seek/volume/mute), displays controls,
	 * handles autoplay logic (including browser restrictions), and integrates with
	 * the global volume and subtitle systems.
	 */

	import type { Models } from '../../types/models';
	import type { VimeoPlayer, YouTubePlayer, HlsPlayer } from '../../types/externals';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import { get, type Writable } from 'svelte/store';

	import { onMount, getContext } from 'svelte';

	// Micrio TS imports
	import { i18n } from '../../ts/i18n';
	import { loadScript, Browser, notypecheck, hasNativeHLS } from '../../ts/utils';
	import { VideoTourInstance } from '../../ts/videotour';
    import { FrameType, MediaType } from '../../types/internal';

	// UI sub-component imports
	import MediaControls from './MediaControls.svelte';
	import Events from '../virtual/Events.svelte'; // For handling timed events within video tours
	import Button from '../ui/Button.svelte';

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');

	// --- Props ---

	interface Props {
		/** The source URL (video, audio, YouTube, Vimeo, Micrio embed ID, Cloudflare ID). */
		src?: string|undefined;
		/** Current volume level (0-1). */
		volume?: number;
		/** Intrinsic width of the media (used for aspect ratio). */
		width?: number;
		/** Intrinsic height of the media. */
		height?: number;
		/** Scale factor for iframe embeds (?). */
		frameScale?: number;
		/** Should the media attempt to autoplay? */
		autoplay?: boolean;
		/** Should the media loop? */
		loop?: boolean;
		/** Delay in seconds before looping (if `loop` is true). */
		loopDelay?: number|undefined;
		/** Show native controls (`true`), Micrio controls (`'inside'` or `false`), or no controls (`'none'`). */
		controls?: string|boolean;
		/** Title attribute for iframe embeds. */
		title?: string|undefined;
		/** Caption text to display below the media. */
		figcaption?: string|null;
		/** Current paused state (bindable). */
		paused?: boolean;
		/** Force the media into a paused state externally. */
		forcePause?: boolean|undefined;
		/** Current seeking state (bindable). */
		seeking?: boolean;
		/** Media duration in seconds (bindable). -1 if unknown. */
		duration?: number;
		/** Current playback time in seconds (bindable). */
		currentTime?: number;
		/** Current muted state (bindable). */
		muted?: boolean;
		/** Is this the main 360 video background? */
		is360?: boolean;
		/** Optional video tour data object to synchronize playback with. */
		tour?: Models.ImageData.VideoTour|null;
		/** Is this media secondary (e.g., hidden audio track for a video tour embed)? */
		secondary?: boolean;
		/** Optional target element for fullscreen requests. */
		fullscreen?: HTMLElement|undefined;
		/** Optional additional CSS class name for the figure element. */
		className?: string|null;
		/** Does the video source have a separate H.265 version for Safari transparency? */
		hasTransparentH265?: boolean;
		/** If true, don't show the large play button overlay when autoplay is blocked. */
		noPlayOverlay?: boolean;
		/** Unique identifier for this media instance (used for state persistence). */
		uuid?: string;
		/** The MicrioImage instance this media belongs to (usually the current image). */
		image?: MicrioImage;
		_media?: HTMLMediaElement|undefined; // Reference to the audio/video element
		onended?: Function;
		onblocked?: Function;
		onplay?: Function;
		onid?: (id:string) => void;
	}

	let {
		src = $bindable(undefined),
		volume = $bindable(1),
		width = 640,
		height = 380,
		frameScale = 1,
		autoplay = $bindable(false),
		loop = false,
		loopDelay = undefined,
		controls = $bindable(false),
		title = undefined,
		figcaption = null,
		paused = $bindable(true),
		forcePause = undefined,
		seeking = $bindable(true),
		duration = $bindable(-1),
		currentTime = $bindable(),
		muted = $bindable(volume == 0),
		is360 = false,
		tour = null,
		secondary = false,
		fullscreen = undefined,
		className = null,
		hasTransparentH265 = false,
		noPlayOverlay = false,
		uuid = $bindable(''),
		image = get(micrio.current) as MicrioImage,
		_media = $bindable(undefined),
		onended,
		onblocked,
		onplay,
		onid
	}: Props = $props();

	/** Initial muted state before component logic. */
	const originallyMuted = muted;
	uuid += (src ?? tour?.id); // Append src or tour ID for uniqueness

	// --- Context & Global State ---

	const info = image.$info as Models.ImageInfo.ImageInfo;

	/** Get relevant stores/properties from the Micrio instance. */
	const {events, state: micrioState, _lang } = micrio;
	/** Reference to the global volume store. */
	const mainVolume:Writable<number> = getContext('volume');
	/** Was the global volume muted when this component mounted? */
	const wasMuted = $mainVolume == 0;
	/** Reference to the global subtitle store. */
	const subtitle = getContext<Writable<string|undefined>>('srt');

	// --- Internal State & Setup ---

	/** Stores the initial start time (used if resuming from saved state). */
	let startTime:number;

	// Check for existing media state (e.g., from previous session via micrioState.set)
	const existing = micrioState.mediaState.get(uuid);
	if(existing) {
		currentTime = existing.currentTime;
		autoplay = !(paused = existing.paused); // Override autoplay based on saved paused state
	}
	// Register this media instance with the global state manager
	micrioState.mediaState.set(uuid, {
		get currentTime(){return currentTime??0},
		set currentTime(v:number){setCurrentTime(v)},
		get paused(){return paused},
		set paused(b:boolean){if(b)pause(); else play()}
	});

	// --- Source URL Processing ---

	// Sanitize iframe src attributes
	if(src && /<iframe /.test(src)) src = src.replace(/^.* src="([^"]+)".*$/,'$1');
	// Sanitize custom video protocol
	if(src?.startsWith('video://')) src = src.replace('video:','https:');

	/** YouTube url regex */
	const ytUrl = /((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be|youtube-nocookie\.com))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?/;

	/** Use YT nocookies */
	const ytHost = 'https://www.youtube-nocookie.com';

	/** Vimeo url regex */
	const vimeo = /vimeo\.com/;

	/** The corrected/final source URL for iframes or video elements. */
	let realSrc: string|undefined = $state(src);
	/** Is the source a Cloudflare Stream video ID? */
	const isCFVid = src && src.startsWith('cfvid://');

	// Determine the media type based on src or tour prop
	const srcL = src && src.toLowerCase();
	const type: MediaType = srcL ? (
			srcL.endsWith('mp3') ? MediaType.Audio
			: srcL.endsWith('.mp4') || srcL.endsWith('.webm') || isCFVid ? MediaType.Video
			: srcL.startsWith('micrio://') ? MediaType.Micrio
			: srcL.startsWith('http') ? MediaType.IFrame // Assume iframe if http(s) and not audio/video
			: MediaType.None
		) : tour ? MediaType.VideoTour // If no src but tour exists, it's a video tour (audio only)
		: MediaType.None;

	// --- Specific Player Setup ---

	/** Parsed data for Micrio embeds [id, width?, height?, lang?]. */
	const mic = type == MediaType.Micrio ? src?.slice(9).split(',') : null;
	if(mic) paused = false; // Micrio embeds don't have a paused state here

	/** Type of iframe player (YouTube or Vimeo). */
	let frameType: FrameType|undefined;
	/** YouTube Player API instance. */
	let ytPlayer: YouTubePlayer|undefined;
	/** Vimeo Player API instance. */
	let vimeoPlayer: VimeoPlayer|undefined;
	/** HLS.js player instance. */
	let hlsPlayer: HlsPlayer|undefined;

	/** Interval timer for manual time updates (for API players). */
	let _tick: number = -1;
	/** Flag to prevent pointer events on iframe while interacting with player API. */
	let hooked:boolean = $state(false);
	/** Use the shared iOS audio element workaround? */
	const singleAudio:boolean = type == MediaType.Audio && Browser.iOS;

	/** Calculated scale factor (unused?). */
	let scale:number = 1;

	// --- DOM Element References ---
	let _frame:HTMLIFrameElement|undefined = $state(); // Reference to the iframe element


	/** Option to disable JS player APIs and use native iframe controls. */
	const noJSPlayers = micrio.hasAttribute('data-native-frame');

	// --- YouTube Setup ---
	const ytMatch = src && ytUrl.exec(src); // Regex match for YouTube URLs
	const timeRegExp = /^.*t=(\d+).*$/; // Regex to extract start time from URL
	if(src && !noJSPlayers && ytMatch && ytMatch[5]) { // If it's a valid YT URL and JS API is enabled
		if(ytMatch[5] == 'playlist') { // Handle playlist URLs
			const listId = /list=([^&]+)/.exec(src);
			if(listId?.[1]) realSrc = `${ytHost}/embed/videoseries?list=${listId[1]}`;
		} else { // Handle single video URLs
			frameType = FrameType.YouTube;
			// Extract start time from URL or use component's currentTime
			const startingTime = Math.round((timeRegExp.test(src) ? Number(src.replace(timeRegExp,'$1')) : currentTime) ?? 0);
			// Construct embed URL with API enabled and controls disabled
			realSrc = `${ytHost}/embed/${ytMatch[5]}?autoplay=0&enablejsapi=1&controls=0&start=${startingTime}`;
			hooked = true; // Disable pointer events on iframe initially
		}
	}

	// --- Vimeo Setup ---
	if(!noJSPlayers && src && vimeo.test(src)) { // If it's a Vimeo URL and JS API is enabled
		const id = src.match(/\/(\d+)/); // Extract video ID
		if(id && id[1]) {
			// Extract hash token if present
			const token = src.slice(src.indexOf(id[1])+id[1].length+1).replace(/\?.*$/,'');
			frameType = FrameType.Vimeo;
			// Construct embed URL with API enabled, controls disabled, and start time
			realSrc = `https://player.vimeo.com/video/${id[1]}?${token ? `h=${token}&` : ''}title=0&portrait=0&sidedock=0&byline=0&controls=0#t=`+Math.round(currentTime??0)+'s';
			hooked = true; // Disable pointer events
		}
	}

	// --- Cloudflare Stream / HLS Setup ---
	let cfVidSrc:string; // Stores the M3U8 URL
	if(isCFVid && src) {
		// IOS can straight up play vid IDs
		cfVidSrc = `https://videodelivery.net/${src.slice(8)}/manifest/video.m3u8`;
		realSrc = undefined; // Clear realSrc as we'll use the <video> tag directly
	}

	// --- Video Tour Setup ---
	let videoTour:VideoTourInstance|undefined = $state();
	if(tour) {
		const newTour = new VideoTourInstance(image, tour); // Create tour instance
		if(currentTime != undefined && currentTime > 0) newTour.currentTime = currentTime; // Set initial time if provided
		if(type == MediaType.VideoTour) { // If it's audio-only tour
			duration = 'duration' in tour ? Number(tour.duration) : tour.i18n?.[$_lang]?.duration ?? 0;
			volume = NaN; // Indicate no volume control needed
		}
		videoTour = newTour;
	}

	// Disable controls for Micrio embeds or non-API iframes
	if(type == MediaType.Micrio || (type == MediaType.IFrame && !frameType)) controls=false;

	// --- Subtitle Setup ---
	/** SRT subtitle file src */
	const sub:Models.Assets.Subtitle|undefined = tour && !('steps' in tour) ? ('subtitle' in tour ? tour['subtitle'] as Models.Assets.Subtitle : tour.i18n?.[micrio.lang]?.subtitle) : undefined;
	const srt = sub && ('fileUrl' in sub ? sub['fileUrl'] as string : sub.src);

	// --- Media Element Event Handlers ---

	/** Called when the media element can play (or has loaded metadata for iOS). */
	function canplay() : void {
		seeking = false; // Mark seeking as complete
		// If it's a 360 video, set the video element on the parent MicrioImage
		if(is360 && image && !image._video) image.video.set(_media as HTMLVideoElement);
	}

	/** Flag to show the manual play button overlay if autoplay is blocked. */
	let showPlayButton: boolean = $state(false);

	/** Called when HTML5 media starts playing. */
	function mediaPlaying(){
		showPlayButton = false; // Hide play overlay
		paused = false; // Update paused state
		// Synchronize video tour playback if applicable
		if(videoTour && _media) {
			videoTour.duration = _media.duration; // Update tour duration from media
			videoTour.currentTime = _media.currentTime; // Sync time
			videoTour.play(); // Start tour playback
		}
	}

	/** Toggles play/pause micrioState. */
	function playPause(e?:PointerEvent|CustomEvent) : void {
		// Ignore right-clicks etc.
		if(e && 'button' in e && e.button != 0) return;
		if(paused) play();
		else pause();
	}

	/** Checks if the media is currently paused (handles different player types). */
	const isPaused = async () : Promise<boolean> => _media ? _media.paused // HTMLMediaElement
		: videoTour ? paused // VideoTourInstance (uses local `paused` state)
		// YouTube Player API states: -1 (unstarted), 0 (ended), 2 (paused)
		: ytPlayer ? [-1,0,2].indexOf(ytPlayer.getPlayerState()) >= 0
		// Fallback for unloaded YouTube player
		: frameType == FrameType.YouTube ? paused
		// Vimeo Player API
		: vimeoPlayer ? await vimeoPlayer.getPaused()
		: false; // Default to not paused if no player identified

	/** Flag indicating if iframe autoplay was blocked by the browser. */
	let frameAutoplayBlocked:boolean = $state(false);
	/** Flag indicating if the component has initialized playback attempt. */
	let hasInited:boolean = false;

	/** Reference to the global media paused state store. */
	const mediaPaused = getContext<Writable<boolean>>('mediaPaused');

	/** Timeout ID for delayed looping. */
	let loopDelayTo:any;

	/** Initiates playback for the current media type. */
	async function play(e?:PointerEvent) : Promise<void> {
		// Ignore right-clicks etc.
		if(e && e instanceof PointerEvent && e.button != 0) return;
		// Don't play if already playing
		if(hasInited && !(await isPaused())) return;
		_ended = false; // Reset ended flag

		// If ended previously, reset time to 0
		if(duration > 0 && currentTime != undefined && currentTime >= duration) currentTime = 0;

		// Show subtitles if applicable
		if(!secondary && srt) subtitle.set(srt);

		// --- Trigger Playback Based on Type ---
		switch(type) {
			case MediaType.VideoTour:
				paused = seeking = false;
				videoTour?.play();
				startTick(); // Start manual time update interval
			break;
			case MediaType.Audio: case MediaType.Video:
				// Add listener for 'play' event (fired when playback actually starts)
				_media?.addEventListener('play', mediaPlaying, {once: true});
				// Attempt to play, catching potential autoplay errors
				_media?.play().catch((e) => {
					if(noPlayOverlay) paused = true; // If overlay disabled, just stay paused
					else if(!/pause\(\)/.test(e.toString())) { // Ignore errors caused by calling pause() immediately after play()
						showPlayButton = true; // Show manual play button overlay
						micrio.events.dispatch('media-blocked'); // Dispatch blocked event
						onblocked?.();
					}
				});
			break;
			case MediaType.IFrame: {
				switch(frameType) {
					case FrameType.YouTube:
						if(ytPlayer) ytPlayer.playVideo();
					break;
					case FrameType.Vimeo:
						if(vimeoPlayer) vimeoPlayer.play();
					break;
				}
			} break;
			default: return; // No valid type
		}

		hasInited = true; // Mark as initialized
		events.dispatch('media-play'); // Dispatch global event
		mediaPaused.set(false); // Update global paused state
		onplay?.(); // Dispatch local event

		// Mute main volume if this media isn't muted and isn't a silent video tour
		if(!is360 && !wasMuted && !(videoTour && !_media)) mainVolume.set(image.$settings.mutedVolume||0);
	}

	/** Pauses playback for the current media type. */
	function pause() : void {
		events.dispatch('media-pause'); // Dispatch global event
		mediaPaused.set(true); // Update global state
		if(_media) {
			_media.pause();
			if(singleAudio) paused = true; // Update local state for shared iOS audio
		}
		else if(videoTour) { videoTour.pause(); paused = true; endTick(); } // Pause tour and stop ticker
		else if(ytPlayer?.pauseVideo && !destroyed) ytPlayer.pauseVideo(); // Use YouTube API
		else if(vimeoPlayer?.pause) vimeoPlayer.pause(); // Use Vimeo API
	}

	/** Sets the muted state for the current media type. */
	function setMuted(b:boolean) : void {
		if(originallyMuted) return; // Don't override if initially muted by prop
		muted = b; // Update local state

		if(_media) _media.muted = b; // HTMLMediaElement
		else if(ytPlayer?.mute) { // YouTube API
			if(b) ytPlayer.mute();
			else ytPlayer.unMute();
			// YT API state update is asynchronous, re-check after delay
			setTimeout(() => {if(ytPlayer) muted = ytPlayer.isMuted()}, 50);
		}
		else if(vimeoPlayer) vimeoPlayer.setVolume(b ? 0 : 1); // Vimeo API (uses volume)
	}

	/** Sets the current playback time. */
	function setCurrentTime(v:number) : void {
		seeking = true; // Set seeking flag
		if(_media) _media.currentTime = v; // HTMLMediaElement
		else if(videoTour) { currentTime = videoTour.currentTime = v; seeking = false; } // VideoTourInstance
		else if(ytPlayer?.seekTo) ytPlayer.seekTo(v); // YouTube API
		else if(vimeoPlayer?.setCurrentTime) vimeoPlayer.setCurrentTime(v); // Vimeo API
	}

	/** Manually updates the `currentTime` variable (used by interval timer). */
	function getCurrentTime() : void {
		if(videoTour) {
			currentTime = videoTour.currentTime;
			if(videoTour.ended) ended(); // Check if tour ended
		}
		else if(ytPlayer?.getCurrentTime) { currentTime = ytPlayer.getCurrentTime(); }
		sendTimeupdate(); // Dispatch timeupdate event
	}

	/** Dispatches the 'timeupdate' event if not secondary media. */
	function sendTimeupdate() : void {
		if(!secondary) events.dispatch('timeupdate', currentTime);
	}

	/** Flag indicating if the media has ended. */
	let _ended:boolean = $state(false);
	/** Called when media playback ends. */
	function ended() : void {
		if(_ended) return; // Prevent multiple calls
		if(videoTour) pause(); // Pause video tour explicitly
		else { paused = true; endTick(); } // Set paused state and stop ticker
		_ended = true;
		events.dispatch('media-ended'); // Dispatch global event
		onended?.(); // Dispatch local event
		stoppedPlaying(); // Restore main volume if needed
	}

	/** Starts the interval timer for manual time updates. */
	function startTick() : void {
		if(_tick >= 0) return; // Already ticking
		_tick = <any>setInterval(getCurrentTime, 250) as number; getCurrentTime(); // Start timer, immediate first call
	}
	/** Stops the interval timer. */
	function endTick() : void {
		clearInterval(_tick);
		_tick = -1;
	}

	/** Loads the YouTube IFrame Player API and initializes the player. */
	async function loadYouTube() : Promise<void> {
		if(ytPlayer) return; // Already loaded
		/** @ts-ignore Check if YT API object exists */
		if(!window['YT']) await loadScript('https://i.micr.io/youtube.js', 'onYouTubeIframeAPIReady'); // Load API script if needed
		/** @ts-ignore */
		if(!window['YT']) { // If loading failed
			hooked = false; // Re-enable pointer events on iframe
			return;
		}
		seeking = true; // Set seeking state
		/** @ts-ignore */
		return new Promise((ok, err) => { ytPlayer = new (window['YT']['Player'] as YouTubePlayer)(_frame, { // Create player instance
			host: ytHost, // Use nocookie host
			width: rWidth.toString(), height: rHeight.toString(),
			playerVars: { controls: 0 }, // Disable native controls
			events: {
				onError: err, // Reject promise on error
				onReady: () => { // When player is ready
					if(destroyed) err(); // Check if component was destroyed during load
					else {
						muted = (ytPlayer as YouTubePlayer).isMuted(); // Get initial muted state
						duration = (ytPlayer as YouTubePlayer).getDuration(); // Get duration
						seeking = false; // Clear seeking state
						ok(); // Resolve promise
					}
				},
				onStateChange: e => { switch(e.data) { // Handle player state changes
					case -1: frameAutoplayBlocked = paused = true; endTick(); break; // -1: unstarted (autoplay blocked?)
					case 0: ended();break; // 0: ended
					case 1: startTick(); frameAutoplayBlocked = paused = seeking = false; break; // 1: playing
					case 2: paused = true; endTick();break; // 2: paused
					case 3: getCurrentTime(); seeking = true; endTick();break; // 3: buffering
				}},
			}
		})});
	}

	/** Loads the Vimeo Player API and initializes the player. */
	async function loadVimeo() : Promise<void> {
		if(vimeoPlayer) return; // Already loaded
		/** @ts-ignore */
		if(!window['Vimeo']) await loadScript('https://i.micr.io/vimeo.min.js'); // Load API script if needed
		/** @ts-ignore */
		if(!window['Vimeo']) { // If loading failed
			hooked = false; // Re-enable pointer events
			return;
		}
		seeking = true; // Set seeking state
		return new Promise((ok, err) => {
			/** @ts-ignore */
			const p = vimeoPlayer = new (window['Vimeo']['Player'] as VimeoPlayer)(_frame, { // Create player instance
				width: rWidth.toString(), height: rHeight.toString(), title: false, autoplay: false
			});
			// Setup event listeners
			p.on('error', err);
			p.on('loaded', () => p.getVolume().then(v => { // When loaded, get initial volume
				if(destroyed) err();
				else { muted = (volume = v) == 0; ok() } // Update muted state and resolve
			}));
			p.on('play', () => paused = seeking = false); // Update state on play
			p.on('bufferstart', () => seeking = true); // Set seeking on buffer start
			p.on('seeked', () => { seeking = false; }); // Clear seeking on seeked
			p.on('pause', () => paused = true); // Update state on pause
			p.on('volumechange', d => {if(d) muted = (volume = d.volume) == 0}); // Update muted state on volume change
			p.on('timeupdate', d => { if(d) {duration = d.duration; currentTime = d.seconds }}); // Update time/duration
			p.on('ended', ended); // Handle ended event
		});
	}

	/** Loads the appropriate player based on the media type. */
	async function loadPlayer() : Promise<void> {
		// Load HLS player if needed (Cloudflare video without native HLS support)
		if(isCFVid && !hasNativeHLS(_media)) return loadScript('https://i.micr.io/hls-1.5.17.min.js', undefined, 'Hls' in window ? {} : undefined).then(() => {
			/** @ts-ignore */
			hlsPlayer = new (window['Hls'] as HlsPlayer)();
			hlsPlayer.loadSource(cfVidSrc);
			if(_media) hlsPlayer.attachMedia(_media);
		});
		// Load iframe players
		else if(type == MediaType.IFrame) {
			if(frameType == FrameType.YouTube) return loadYouTube();
			if(frameType == FrameType.Vimeo) return loadVimeo();
		}
		// Hook events for HTML5 media
		else if(_media) {
			if(isCFVid) realSrc = cfVidSrc; // Set src for Cloudflare video if using native HLS
			hookMedia();
		}
	}

	/** Hooks necessary events for HTML5 media elements. */
	let pauseAfterSeek:boolean = false; // Flag to pause after seeking (used for initial time set)
	function hookMedia(){
		if(!_media) return;

		// Update time continuously
		_media.ontimeupdate = sendTimeupdate;

		// If synchronized with a video tour
		if(videoTour) {
			// Pause tour when media pauses
			_media.onpause = () => videoTour.pause();
			// Sync tour time when media seeks
			_media.onseeked = () => {
				if(!_media || _media.ended) return;
				videoTour.currentTime = _media.currentTime;
				// If seek was triggered to set initial time without autoplay, pause now
				if(pauseAfterSeek) {
					_media.pause();
					pauseAfterSeek = false;
				}
			}
		}

		// Set initial time if needed
		if(currentTime != undefined && currentTime > 0) {
			// If duration is known, set time directly
			if(_media.duration > 0) _media.currentTime = currentTime;
			// Otherwise, wait for 'canplay' event
			else _media.oncanplay = () => {
				if(!_media) return;
				_media.oncanplay = null; // Remove listener
				// If not set to autoplay, play briefly then pause to load the frame at the start time
				if(!autoplay) {
					_media.play();
					pauseAfterSeek = true;
				}
				_media.currentTime = startTime; // Set the actual start time
			}
		}

		// Handle looping with delay
		const ld = loop && loopDelay !== undefined ? loopDelay : -1;
		if(ld >= 0) { // Use >= 0 to allow 0 delay
			_media.onended = () => {
				clearTimeout(loopDelayTo); // Clear previous timeout
				loopDelayTo = setTimeout(() => {
					if(!forcePause) _media?.play() // Play again after delay, unless forced pause
				}, ld * 1000);
			}
		} else {
			// Standard ended event handler if no delay
			_media.onended = ended;
		}
	}

	/** Clears the loop delay timeout. */
	function cto() {
		clearTimeout(loopDelayTo);
	}

	/** Restores main volume when media stops/pauses. */
	function stoppedPlaying():void{
		if(!wasMuted) mainVolume.set(1); // Restore volume only if it wasn't originally muted
	}

	/** Flag indicating if the component is destroyed (for cleanup). */
	let destroyed:boolean = $state(false);

	/** Handler for iOS shared audio element time updates. */
	const iOSAudioTimeUpdate = () => currentTime = _media?.currentTime ?? 0;

	/** Performs cleanup when the component is about to be destroyed or media changes. */
	function preDestroy(){
		if(destroyed) return;
		destroyed = true;
		// Clear video element reference on parent image if this was the 360 video
		if(is360 && image) image.video.set(undefined);
		// Remove media state entry
		micrioState.mediaState.delete(uuid);
		// Stop time update interval
		endTick();
		// Pause media
		pause();
		// Restore main volume
		stoppedPlaying();
		// Clear subtitles
		if(srt) subtitle.set(undefined);
		// Remove event listeners from HTMLMediaElement
		if(_media) {
			_media.onended = null;
			if(singleAudio) { // Special cleanup for shared iOS audio element
				_media.onloadedmetadata = _media.onplay = _media.onseeking = _media.onseeked = null;
				_media.removeEventListener('timeupdate', iOSAudioTimeUpdate);
			}
			_media.ontimeupdate = _media.onpause = _media.onseeked = _media.oncanplay = null;
		}
		// Destroy players/instances
		if(videoTour) videoTour.destroy();
		else if(vimeoPlayer) for(let k of ['error', 'loaded', 'play', 'bufferstart', 'seeked',
			'pause', 'volumechange', 'timeupdate', 'ended']) vimeoPlayer.off(k); // Remove Vimeo listeners
		// Note: YouTube player doesn't have explicit listener removal, rely on destroy
		if(hlsPlayer) hlsPlayer.destroy();
		else if(ytPlayer) ytPlayer.destroy();
		else if(vimeoPlayer) vimeoPlayer.destroy();
	}

	/** Is the media type a standard video element? */
	const isVideo = type == MediaType.Video;

	// Workaround for iOS video rendering glitch on first frame for embeds
	let hideUntilPlaying = $state(isVideo && isCFVid && frameScale != 1 && Browser.iOS);

	// --- Lifecycle (onMount) ---
	onMount(() => {
		onid?.(uuid); // Dispatch unique ID
		// Handle shared iOS audio element setup
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
		startTime = currentTime || 0; // Store initial time
		// Determine if iframe events need hooking
		hooked = frameType == FrameType.YouTube || frameType == FrameType.Vimeo;
		// Load the appropriate player and attempt autoplay if configured
		loadPlayer().then(() => { if(autoplay) play() }).catch(() => {});

		// Add listener to unhide iOS video once playing starts
		if(hideUntilPlaying) _media?.addEventListener('playing', () => hideUntilPlaying = false, {once: true});

		// Subscribe to global mute state changes
		const unsubscribeChangeGlobalMuted = micrio.isMuted.subscribe(b => setMuted(b));

		// Cleanup function
		return () => {
			preDestroy(); // Perform cleanup
			unsubscribeChangeGlobalMuted(); // Unsubscribe from global mute state
			if(singleAudio) _media = undefined; // Clear reference for shared iOS audio
			// Destroy player instances if they exist
			if(hlsPlayer) hlsPlayer.destroy();
			else if(ytPlayer) ytPlayer.destroy();
			else if(vimeoPlayer) vimeoPlayer.destroy();
		}
	});

	// --- Reactive Effects ---

	// Update media element muted state when volume or muted props change
	$effect(() => {
		if(_media && type == MediaType.Video && !muted) _media.muted = volume == 0;
	});
	// Update local paused state if forcePause prop changes
	$effect(() => { if(forcePause !== undefined) paused = forcePause; });
	// Clear loop delay timeout if loop/delay props change
	$effect(() => { if(loop && loopDelay !== undefined) cto(); });

	/** Reactive variable holding timed events for video tours. */
	let videoTourEvents = $derived(videoTour && tour ? 'events' in tour ? tour.events as Models.ImageData.VideoTourView[] : tour.i18n?.[$_lang]?.events ?? undefined : undefined);

	/** Reference to the main figure container element. */
	let _cnt:HTMLElement|undefined = $state();
	/** The media container element */
	let _container:HTMLElement|undefined = $state();

	/** Scale factor for 360 embeds. */
	const scaleFact = info.is360 ? Math.PI/2 : 1;
	/** Calculated relative scale for the media element. */
	let relScale = $derived(isVideo ? frameScale * scaleFact : type == MediaType.IFrame ? Math.max(frameScale, Math.min(width / 512, height / 512)) : 1);
	/** Calculated render width. */
	let rWidth = $derived(isVideo ? width : Math.round(width / relScale * scaleFact));
	/** Calculated render height. */
	let rHeight = $derived(isVideo ? height : Math.round(height / relScale * scaleFact));

</script>

{#if !image.$settings.noUI} <!-- Check global UI setting -->
	<figure bind:this={_cnt} class:paused class:is360 class:media-video={type == MediaType.IFrame || type == MediaType.Video}
		class:media-micrio={type == MediaType.Micrio} class={className} style={scale!=1?`--scale:${1/scale}`:null}>
		<div onpointerup={e => {if(e.target == _container) playPause(e)}} class:videotour={!!videoTour} bind:this={_container}
			style={relScale != 1 && (type == MediaType.Video || !info.is360) ? `transform:scale(${relScale})`:''}>
			{#if type == MediaType.IFrame}
				<iframe {...notypecheck({credentialless:true})} {title} src={realSrc} width={rWidth} height={rHeight} class:hooked={hooked && !frameAutoplayBlocked} bind:this={_frame}
					frameborder="0" allow="fullscreen *;autoplay *;encrypted-media *"></iframe>
			{:else if type == MediaType.Video}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video controls={false} loop={loop && (loopDelay == undefined || loopDelay <= 0)} playsinline {width} {height} bind:this={_media} style={hideUntilPlaying ? 'opacity: 0' : undefined}
					bind:duration bind:muted autoplay={!!autoplay} bind:currentTime bind:seeking bind:paused oncanplay={canplay} onended={ended}>
					{#if realSrc}
						{#if hasTransparentH265 && realSrc.endsWith('.webm')}
							<source src={realSrc.replace('.webm', '.mp4')} type="video/mp4;codecs=hvc1"> <!-- Safari H.265 with alpha -->
						{/if}
						<source src={realSrc} type={isCFVid ? 'application/x-mpegURL' : undefined}> <!-- Main source -->
					{/if}
				</video>
			{:else if type == MediaType.Audio && !singleAudio}
				<!-- Standard audio element (not used on iOS) -->
				<audio src={realSrc} controls={false} bind:this={_media} bind:duration bind:muted
					bind:currentTime bind:seeking bind:paused oncanplay={() => seeking = false} onended={ended}></audio>
			{:else if type == MediaType.Micrio && mic}
				<!-- Embedded Micrio instance -->
				<micr-io data-logo="false" id={mic[0]} width={mic[1]} height={mic[2]} lang={mic[3]} data-path={info.path}></micr-io>
			{/if}
			<!-- Render timed events for video tours -->
			{#if videoTourEvents?.length && duration > 0 && !destroyed}<Events events={videoTourEvents} bind:currentTime bind:duration />{/if}
			<!-- Render media controls if enabled -->
			{#if controls}
				<aside class:inside={controls=='inside'}>
					<MediaControls
						subtitles={!!srt}
						fullscreen={(!is360 && (type == MediaType.IFrame || type == MediaType.Video)) ? _cnt : fullscreen}
						bind:paused bind:seeking bind:duration bind:currentTime bind:muted bind:volume bind:ended={_ended}
						onplaypause={playPause}
						onmute={() => micrio.isMuted.set(!muted)}
						onseek={t => setCurrentTime(t)}
					/>
				</aside>
			{/if}
		</div>
		<!-- Render caption if provided -->
		{#if figcaption}<figcaption>{@html figcaption}</figcaption>{/if}
	</figure>
	<!-- Render play button overlay if autoplay was blocked -->
	{#if showPlayButton}<div class="show-play" onpointerup={play}><Button title={$i18n.play} type="play" /></div>{/if}
{/if}

<style>
	figure {
		display: block;
		margin: 0;
		width: 100%;
		position: relative; /* Needed for absolute positioning of controls/overlay */
		overflow: hidden; /* Hide controls overflow if needed */
	}
	figure div { /* Inner container for media element */
		cursor: pointer; /* Indicate click-to-play/pause */
	}
	figure div.videotour {
		/* Special display for audio-only video tours? */
		display: flex;
	}
	/* Fullscreen styling */
	figure:global(:fullscreen) div {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	figure:global(:fullscreen) div > :global(:first-child) {
		flex: 1; /* Make media element fill space */
	}
	/* Ensure media element fills container within marker popup */
	:global(.marker-popup) > figure > div {
		width: 100%;
	}
	iframe, video {
		display: block; /* Remove extra space below element */
		max-width: unset; /* Override potential external styles */
	}
	/* Special positioning for 360 background video (likely unused/legacy) */
	figure.is360 {
		position: absolute;
		bottom: 5px;
		width: 360px;
		left: 50%;
		transform: translateX(-50%);
	}
	figure.is360 video {
		display: none; /* Hidden by default? */
		width: 200px;
		height: 200px;
	}
	/* Disable pointer events on iframe when JS API is active */
	iframe.hooked {
		pointer-events: none;
	}
	/* Caption styling */
	figcaption {
		font-style: italic;
		margin: .5em 1em .5em 1em;
		text-align: center;
		font-size: 90%;
		color: var(--micrio-color);
	}
	/* Remove margins from elements inside caption within popover */
	:global(:not(.micrio-popover)) > figure > figcaption > :global(*) {
		margin: 0;
	}
	/* Remove margins from figure inside popover */
	:global(.micrio-popover) figure {
		margin: 0;
	}

	/** Controls styling */
	aside {
		width: 100%;
		display: flex;
	}
	/* Controls positioned inside the media area */
	aside.inside {
		position: absolute;
		transform: translateY(-100%);
	}

	/* Play button overlay styling */
	div.show-play {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		cursor: pointer;
		background: #0008; /* Semi-transparent black */
		display: flex;
		align-items: center;
		justify-content: center;
	}
	div.show-play > :global(button.micrio-button) {
		transform: scale(2); /* Make play button larger */
	}

	/* Reset button styles within the figure */
	figure:not(.media-micrio) :global(button.micrio-button) {
		margin: 0;
		border: none;
		border-radius: 0;
		white-space: pre;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}
	/* Text alignment for Micrio embed captions */
	figure.media-micrio {
		text-align: var(--micrio-text-align);
	}

</style>
