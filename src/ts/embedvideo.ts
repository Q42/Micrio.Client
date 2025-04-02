import type { Unsubscriber } from 'svelte/motion';
import type { HlsPlayer } from '../types/externals'; // Type definition for HLS.js player
import type { Models } from '../types/models';
import type { MicrioImage } from './image';
import type { Wasm } from './wasm';

import { Browser, hasNativeHLS, loadScript } from './utils'; // Browser utils and HLS detection
import { tick } from 'svelte';

/**
 * Manages the loading, playback, and WebGL integration of embedded videos
 * that are rendered directly onto the Micrio canvas texture (not as HTML elements).
 * Used internally by the `Embed.svelte` component when `printGL` is true.
 * Handles HLS playback via hls.js if necessary.
 */
export class GLEmbedVideo {
	/** Is the video source an HLS stream (.m3u8)? @internal */
	private ism3u:boolean = false;
	/** HLS.js player instance, if used. @internal */
	private hlsPlayer: HlsPlayer|undefined = undefined;
	/** Svelte store unsubscriber for the image visibility store. @internal */
	private usVid:Unsubscriber|undefined = undefined;
	/** Timeout ID for delayed video looping. @internal */
	private vidRepeatTo:any = undefined;
	/** Timeout ID for delaying video loading/playback on visibility change. @internal */
	private placeTo:any = undefined;
	/** Should the video autoplay when visible? @internal */
	private autoplay:boolean = true;

	/** The underlying HTMLVideoElement used for decoding. @internal */
	_vid:HTMLVideoElement|undefined = undefined;

	/** Flag indicating if the parent Embed component is still mounted. @internal */
	isMounted:boolean = true;

	/**
	 * Creates a GLEmbedVideo instance.
	 * @param wasm The Wasm controller instance.
	 * @param image The parent MicrioImage instance where the video is embedded.
	 * @param embed The embed data object.
	 * @param paused Initial paused state (e.g., due to pause-on-zoom).
	 * @param moved Callback function to notify when position/state changes (triggers Wasm render).
	 */
	constructor(
		private wasm:Wasm,
		private image:MicrioImage,
		private embed:Models.ImageData.Embed,
		private paused:boolean, // Initial paused state
		private moved:() => void // Callback to trigger Wasm render after state change
	) {
		// Determine if HLS is needed (stream ID present and not transparent video)
		this.ism3u = !!embed.video?.streamId && !embed.video?.transparent;
		// Get existing video element if already created (e.g., by previous instance)
		this._vid = image._video;
		// Set autoplay flag from embed data
		this.autoplay = embed.video?.autoplay ?? true;

		let first:boolean = true; // Flag for initial visibility check
		// Subscribe to image visibility changes
		this.usVid = this.image.visible.subscribe(v =>  {
			clearTimeout(this.placeTo); // Clear any pending timeout
			if(v) { // If image becomes visible
				// Schedule loading/playback after a short delay (or immediately first time)
				this.placeTo = setTimeout(() => {
					if(!this.isMounted) return; // Exit if component unmounted
					if(!this._vid) this.load(); // Load video if not already loaded
					else { // If already loaded
						this.hook(); // Ensure event listeners are attached
						if(this.autoplay && !this.paused) this._vid.play().catch(e => console.warn("WebGL Embed video play() failed", e)); // Attempt autoplay if enabled and not paused
					}
				}, first ? 0 : 100); // No delay on first visibility
			} else { // If image becomes hidden
				// Pause video immediately
				this.placeTo = setTimeout(() => this._vid?.pause(), 0);
			}
			first = false;
		});
	}

	/** Cleans up resources when the parent Embed component is unmounted. */
	unmount() : void {
		this.isMounted = false; // Mark as unmounted
		// Clear timeouts
		clearTimeout(this.placeTo);
		clearTimeout(this.vidRepeatTo);
		this._vid?.pause(); // Pause video
		this.unhook(); // Remove event listeners
		this.usVid?.(); // Unsubscribe from visibility store
		// TODO: Consider destroying HLS player instance if created (this.hlsPlayer?.destroy())
	}

	/**
	 * Updates the internal paused state and related attributes/Wasm state.
	 * @internal
	 * @param playing True if the video is now playing, false if paused.
	 */
	private setPlaying(playing:boolean) : void {
		if(!this._vid) return;
		this.paused = !playing; // Update internal state
		// Set data attribute for potential external use/styling
		if (playing) this._vid.dataset.playing = '1';
		else delete this._vid.dataset.playing;
		// Notify Wasm about the playback state change
		this.wasm.e._setImageVideoPlaying(this.image.ptr, playing);
		// Handle fade-out/fade-in if hideWhenPaused is enabled
		if(this.embed.hideWhenPaused) this.wasm.fadeImage(this.image.ptr, playing ? 1 : 0);
		// Trigger Wasm render if playing (to update texture)
		if(playing) this.wasm.render();
	}

	/** Loads the video source and sets up the HTMLVideoElement. @internal */
	private load() : void {
		if(!this.embed.video || this._vid) return; // Exit if no video data or already loaded

		// Determine video source URL (Cloudflare stream or direct src)
		// Note: Cloudflare stream doesn't support alpha transparency, fallback to src if needed.
		const src = this.ism3u ? `https://videodelivery.net/${this.embed.video.streamId}/manifest/video.m3u8` : this.embed.video.src;
		if (!src) {
			console.error("[Micrio GL Embed] No video source found for embed:", this.embed.id);
			return;
		}

		// Create video element
		this._vid = document.createElement('video');
		this._vid.crossOrigin = 'anonymous'; // Needed for WebGL texture usage
		this._vid.playsInline = true; // Important for mobile playback
		// Set initial dimensions (can be small, actual rendering uses texture)
		this._vid.width = this.embed.width! * .5;
		this._vid.height = this.embed.height! * .5;
		this._vid.muted = this.embed.video.muted; // Apply muted setting

		this.hook(); // Attach event listeners

		// Load source: Use HLS.js if needed and supported, otherwise set src directly
		if(!this.ism3u || hasNativeHLS(this._vid)) {
			this._vid.src = src;
		} else {
			// Load HLS.js library dynamically if needed
			loadScript('https://i.micr.io/hls-1.5.17.min.js', undefined, 'Hls' in window ? {} : undefined).then(() => {
				/** @ts-ignore Access global Hls constructor */
				this.hlsPlayer = new (window['Hls'] as HlsPlayer)(); // Create HLS player instance
				this.hlsPlayer.loadSource(src); // Load HLS manifest
				if(this._vid) this.hlsPlayer.attachMedia(this._vid); // Attach to video element
			}).catch(e => console.error("[Micrio GL Embed] Failed to load HLS.js:", e));
		}
	}

	/** Event listener callbacks. @internal */
	private events = {
		play: () => this.setPlaying(true),
		pause: () => this.setPlaying(false),
		// Set the video element on the parent MicrioImage once playback starts (first frame rendered)
		playing: () => {if(!this.image._video) this.image.video.set(this._vid) },
		// Use 'loadedmetadata' on iOS as 'canplay' might not fire reliably
		canplayEvt: Browser.iOS ? 'loadedmetadata' : 'canplay',
		// Handle 'canplay' or 'loadedmetadata' event
		canplay:() => {
			if(!this._vid || !this.isMounted) return; // Exit if unmounted or video element lost
			// Attempt autoplay if enabled and not paused by external logic (e.g., zoom)
			if(this.autoplay && !this.paused) {
				this._vid.play().catch(e => console.warn("WebGL Embed video play() failed on canplay:", e));
				this.moved(); // Trigger render after potential state change
			}
			// If autoplay disabled but not hiding when paused, render the first frame
			else if(!this.embed.hideWhenPaused) {
				this.setPlaying(true); // Temporarily set playing to render frame
				tick().then(() => { // After render
					this.setPlaying(false); // Set back to paused
					// Remove temporary DOM element if added for first frame visibility
					// TODO: Check if this removal logic is still necessary/correct.
					setTimeout(() => this._vid?.remove(),50);
				})
			}
		}
	}

	/** Attaches event listeners to the video element. @internal */
	private hook() {
		if(!this.embed.video || !this._vid) return;
		const loopAfter = this.embed.video.loopAfter; // Delay before looping (seconds)
		// Handle looping with delay
		if(this.embed.video.loop && loopAfter) {
			this._vid.loop = false; // Disable native loop
			this._vid.onended = () => { // When video ends
				this.setPlaying(false); // Set state to paused
				// Schedule restart after delay
				this.vidRepeatTo = <any>setTimeout(() => this._vid?.play().catch(e => console.warn("WebGL Embed video loop play() failed:", e)), loopAfter * 1000) as number;
			}
			// Ensure playing state is set correctly when play starts after loop delay
			this._vid.onplay = () => this.setPlaying(true);
		}
		// Handle simple looping
		else {
			this._vid.loop = this.embed.video.loop;
			this._vid.onended = null; // Remove potential previous listener
			this._vid.onplay = null; // Remove potential previous listener
		}

		// Workaround: If no autoplay and not HLS, temporarily add video to DOM
		// to ensure the first frame becomes visible/available for the texture.
		if(!this._vid.parentNode && !this.autoplay && !this.ism3u) {
			this._vid.setAttribute('style','opacity:0;position:absolute;top:0;left:0;transform-origin:left top;transform:scale(0.1);pointer-events:none;');
			document.body.appendChild(this._vid);
			// TODO: Ensure this temporary element is reliably removed later.
		}

		// Add core event listeners
		this._vid.addEventListener('play', this.events.play);
		this._vid.addEventListener('pause', this.events.pause);
		this._vid.addEventListener('playing', this.events.playing, {once:true}); // Only need first 'playing' event
		this._vid.addEventListener(this.events.canplayEvt, this.events.canplay, {once: true}); // Listen for 'canplay' or 'loadedmetadata' once
	}

	/** Removes event listeners from the video element. @internal */
	private unhook() : void {
		if(!this._vid) return;
		// Remove core event listeners
		this._vid.removeEventListener('play', this.events.play);
		this._vid.removeEventListener('pause', this.events.pause);
		this._vid.removeEventListener('playing', this.events.playing);
		this._vid.removeEventListener(this.events.canplayEvt, this.events.canplay);
		// Remove potential loop listeners
		this._vid.onended = null;
		this._vid.onplay = null;
	}

}
