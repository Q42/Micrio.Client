import type { Unsubscriber } from '$core/store';
import type { HlsPlayer } from '$types/externals';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import type { Engine } from '$render/engine';

import { Browser } from '$utils/browser';
import { createElement, loadExternalAPI } from '$utils/dom';
import { tick } from '$core/store';
import { HLS_SCRIPT_URL, HLS_PLAYER_CONFIG, mediaSourceSupported, cloudflareStreamUrl, getHlsConstructor } from './hls-adapter';

/**
 * Manages the loading, playback, and WebGL integration of embedded videos
 * that are rendered directly onto the Micrio canvas texture (not as HTML elements).
 * Used internally when `printGL` is true.
 * Handles HLS playback via hls.js if necessary.
 * @internal
 */
export class GLEmbedVideo {
	/** Is the video source an HLS stream (.m3u8)? @internal */
	#ism3u = false;
	/** HLS.js player instance, if used. @internal */
	#hlsPlayer: HlsPlayer|undefined = undefined;
	/** Store unsubscriber for the image visibility store. @internal */
	#usVid:Unsubscriber|undefined = undefined;
	/** Timeout ID for delayed video looping. @internal */
	#vidRepeatTo: ReturnType<typeof setTimeout> | undefined = undefined;
	/** Timeout ID for delaying video loading/playback on visibility change. @internal */
	#placeTo: ReturnType<typeof setTimeout> | undefined = undefined;
	/** Tracks whether the video was temporarily appended to the DOM for WebGL first-frame capture. */
	#tmpDomAttached = false;
	/** Should the video autoplay when visible? @internal */
	#autoplay = true;

	/** The underlying HTMLVideoElement used for decoding. @internal */
	_vid:HTMLVideoElement|undefined = undefined;

	/** Flag indicating if the parent Embed component is still mounted. @internal */
	#isMounted = true;

	/**
	 * Creates a GLEmbedVideo instance.
	 * @param engine The Engine controller instance.
	 * @param image The parent MicrioImage instance where the video is embedded.
	 * @param embed The embed data object.
	 * @param paused Initial paused state (e.g., due to pause-on-zoom).
	 * @param moved Callback function to notify when position/state changes (triggers Engine render).
	 */
	#engine: Engine;
	#image: MicrioImage;
	#embed: Models.ImageData.Embed;
	#paused: boolean;
	#moved: () => void;

	constructor(
		engine:Engine,
		image:MicrioImage,
		embed:Models.ImageData.Embed,
		paused:boolean, // Initial paused state
		moved:() => void // Callback to trigger Engine render after state change
	) {
		this.#engine = engine;
		this.#image = image;
		this.#embed = embed;
		this.#paused = paused;
		this.#moved = moved;
		// Determine if HLS is needed (stream ID present and not transparent video)
		this.#ism3u = Boolean(embed.video?.streamId) && !embed.video?.transparent;
		// Get existing video element if already created (e.g., by previous instance)
		this._vid = image._video;
		// Set autoplay flag from embed data
		this.#autoplay = embed.video?.autoplay ?? true;

		let first = true; // Flag for initial visibility check
		// Subscribe to image visibility changes
		this.#usVid = this.#image.visible.subscribe(v =>  {
			clearTimeout(this.#placeTo); // Clear any pending timeout
			if(v) { // If image becomes visible
				// Schedule loading/playback after a short delay (or immediately first time)
				this.#placeTo = setTimeout(() => {
					if(!this.#isMounted) {return;} // Exit if component unmounted
					if(!this._vid) {this.#load();} // Load video if not already loaded
					else { // If already loaded
						this.#hook(); // Ensure event listeners are attached
						if(this.#autoplay && !this.#paused) {this._vid.play().catch(e => console.warn("WebGL Embed video play() failed", e));}
					}
				}, first ? 0 : 100); // No delay on first visibility
			} else { // If image becomes hidden
				// Pause video immediately
				this.#placeTo = setTimeout(() => this._vid?.pause(), 0);
			}
			first = false;
		});
	}

	/** Cancels any pending visibility timeout (e.g. pause scheduled on invisible). @internal */
	_cancelTimeout(): void {
		clearTimeout(this.#placeTo);
	}

	/** Cleans up resources when the parent Embed component is unmounted. @internal */
	_unmount() : void {
		this.#isMounted = false;
		clearTimeout(this.#placeTo);
		clearTimeout(this.#vidRepeatTo);
		this._vid?.pause();
		this.#unhook();
		this.#usVid?.();
		this.#hlsPlayer?.destroy();
		this.#hlsPlayer = undefined;
		this.#removeTmpDom();
	}

	/**
	 * Updates the internal paused state and related attributes/Engine state.
	 * @internal
	 * @param playing True if the video is now playing, false if paused.
	 */
	#setPlaying(playing:boolean) : void {
		if(!this._vid) {return;}
		this.#paused = !playing; // Update internal state
		// Set data attribute for potential external use/styling
		if (playing) {this._vid.dataset.playing = '1';}
		else {delete this._vid.dataset.playing;}
		// Notify Engine about the playback state change
		this.#engine._setImageVideoPlaying(this.#image, playing);
		// Handle fade-out/fade-in if hideWhenPaused is enabled
		if(this.#embed.hideWhenPaused) {this.#engine._fadeImage(this.#image, playing ? 1 : 0);}
		// Trigger Engine render if playing (to update texture)
		if(playing) {this.#engine.render();}
	}

	/** Loads the video source and sets up the HTMLVideoElement. @internal */
	#load() : void {
		const { video } = this.#embed;
		if(!video || this._vid) {return;} // Exit if no video data or already loaded

		// Determine video source URL (Cloudflare stream or direct src)
		// Note: Cloudflare stream doesn't support alpha transparency, fallback to src if needed.
		const src = this.#ism3u && video.streamId ? cloudflareStreamUrl(video.streamId) : video.src;
		if (!src) {
			console.error("[Micrio GL Embed] No video source found for embed:", this.#embed.id);
			return;
		}

		// Create video element
		this._vid = createElement('video', {
			props: {
				crossOrigin: 'anonymous', // Needed for WebGL texture usage
				playsInline: true, // Important for mobile playback
				width: this.#embed.width ?? 0,
				height: this.#embed.height ?? 0,
				muted: video.muted, // Apply muted setting
			},
		});

		this.#hook(); // Attach event listeners

		if(!this.#ism3u || !mediaSourceSupported()) {
			this._vid.src = src;
		} else {
			loadExternalAPI('Hls', HLS_SCRIPT_URL).then(() => {
				this.#hlsPlayer = new (getHlsConstructor())(HLS_PLAYER_CONFIG);
				this.#hlsPlayer.loadSource(src); // Load HLS manifest
				if(this._vid) {this.#hlsPlayer.attachMedia(this._vid);} // Attach to video element
			}).catch(e => console.error("[Micrio GL Embed] Failed to load HLS.js:", e));
		}
	}

	/** Event listener callbacks. @internal */
	#events = {
		play: () => this.#setPlaying(true),
		pause: () => this.#setPlaying(false),
		// Delayed looping (only attached when `loopAfter` is set): pause on end,
		// then restart after the configured delay.
		loopEnded: () => {
			this.#setPlaying(false); // Set state to paused
			const v = this._vid;
			const loopAfter = this.#embed.video?.loopAfter ?? 0;
			// Schedule restart after delay
			this.#vidRepeatTo = setTimeout(() => v?.play().catch(e => console.warn("WebGL Embed video loop play() failed:", e)), loopAfter * 1000);
		},
		loopPlay: () => this.#setPlaying(true),
		// Set the video element on the parent MicrioImage once a real frame is available for WebGL texture upload
		playing: () => {
			if(!this.#image._video && this._vid) {
				if('requestVideoFrameCallback' in this._vid) {
					this._vid.requestVideoFrameCallback(() => {
						if(this._vid && this.#isMounted) {
							this.#image.video.set(this._vid);
							this.#engine.render();
						}
					});
				} else {
					this.#image.video.set(this._vid);
				}
			}
		},
		// Use 'loadedmetadata' on iOS as 'canplay' might not fire reliably
		canplayEvt: Browser.iOS ? 'loadedmetadata' : 'canplay',
		// Handle 'canplay' or 'loadedmetadata' event
		canplay:() => {
			if(!this._vid || !this.#isMounted) {return;}
			if(this.#autoplay && !this.#paused) {
				this._vid.play().catch(e => console.warn("WebGL Embed video play() failed on canplay:", e));
				this.#moved();
			}
			else if(!this.#embed.hideWhenPaused) {
				this.#setPlaying(true);
				void tick().then(() => {
					this.#setPlaying(false);
					this.#removeTmpDom();
				});
			}
		}
	}

	/** Removes the video from the DOM if it was temporarily attached for WebGL first-frame capture. */
	#removeTmpDom(): void {
		if (this.#tmpDomAttached && this._vid?.parentNode) {
			this._vid.remove();
			this.#tmpDomAttached = false;
		}
	}

	/** Attaches event listeners to the video element. @internal */
	#hook() {
		if(!this.#embed.video || !this._vid) {return;}
		const {loopAfter} = this.#embed.video; // Delay before looping (seconds)
		const v = this._vid;
		// Handle looping with delay
		if(this.#embed.video.loop && loopAfter) {
			v.loop = false; // Disable native loop
			v.addEventListener('ended', this.#events.loopEnded); // When video ends
			// Ensure playing state is set correctly when play starts after loop delay
			v.addEventListener('play', this.#events.loopPlay);
		}
		// Handle simple looping
		else {
			v.loop = this.#embed.video.loop;
			// Remove potential previous loop listeners
			v.removeEventListener('ended', this.#events.loopEnded);
			v.removeEventListener('play', this.#events.loopPlay);
		}

		// Workaround: If no autoplay and not HLS, temporarily add video to DOM
		// to ensure the first frame becomes visible/available for the texture.
		if(!v.parentNode && !this.#autoplay && !this.#ism3u) {
			v.setAttribute('style','opacity:0;position:absolute;top:0;left:0;transform-origin:left top;transform:scale(0.1);pointer-events:none;');
			document.body.append(v);
			this.#tmpDomAttached = true;
		}

		// Add core event listeners
		v.addEventListener('play', this.#events.play);
		v.addEventListener('pause', this.#events.pause);
		v.addEventListener('playing', this.#events.playing, {once:true}); // Only need first 'playing' event
		v.addEventListener(this.#events.canplayEvt, this.#events.canplay, {once: true}); // Listen for 'canplay' or 'loadedmetadata' once
	}

	/** Removes event listeners from the video element. @internal */
	#unhook() : void {
		const v = this._vid;
		if(!v) {return;}
		// Remove core event listeners
		v.removeEventListener('play', this.#events.play);
		v.removeEventListener('pause', this.#events.pause);
		v.removeEventListener('playing', this.#events.playing);
		v.removeEventListener(this.#events.canplayEvt, this.#events.canplay);
		// Remove potential loop listeners
		v.removeEventListener('ended', this.#events.loopEnded);
		v.removeEventListener('play', this.#events.loopPlay);
	}

}
