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
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { MediaPlayerAdapter } from '../../ts/media';
	import { get, type Writable } from 'svelte/store';

	import { onMount, getContext } from 'svelte';

	// Micrio TS imports
	import { i18n } from '../../ts/i18n';
	import { Browser, notypecheck, parseMediaSource, getIOSAudioElement, hasNativeHLS } from '../../ts/utils';
	import { VideoTourInstance } from '../../ts/videotour';
	import { FrameType, MediaType } from '../../types/internal';

	// Player adapters
	import { YouTubePlayerAdapter } from '../../ts/media/youtube-adapter';
	import { VimeoPlayerAdapter } from '../../ts/media/vimeo-adapter';
	import { HLSPlayerAdapter } from '../../ts/media/hls-adapter';

	// UI sub-component imports
	import MediaControls from './MediaControls.svelte';
	import Events from '../virtual/Events.svelte';
	import Button from '../ui/Button.svelte';

	// ============================================================================
	// Context & Props
	// ============================================================================

	const micrio = getContext<HTMLMicrioElement>('micrio');

	interface Props {
		/** The source URL (video, audio, YouTube, Vimeo, Micrio embed ID, Cloudflare ID). */
		src?: string | undefined;
		/** Current volume level (0-1). */
		volume?: number;
		/** Intrinsic width of the media (used for aspect ratio). */
		width?: number;
		/** Intrinsic height of the media. */
		height?: number;
		/** Scale factor for iframe embeds. */
		frameScale?: number;
		/** Should the media attempt to autoplay? */
		autoplay?: boolean;
		/** Should the media loop? */
		loop?: boolean;
		/** Delay in seconds before looping (if `loop` is true). */
		loopDelay?: number | undefined;
		/** Show native controls (`true`), Micrio controls (`'inside'` or `false`), or no controls (`'none'`). */
		controls?: string | boolean;
		/** Title attribute for iframe embeds. */
		title?: string | undefined;
		/** Caption text to display below the media. */
		figcaption?: string | null;
		/** Current paused state (bindable). */
		paused?: boolean;
		/** Force the media into a paused state externally. */
		forcePause?: boolean | undefined;
		/** Current seeking state (bindable). */
		seeking?: boolean;
		/** Media duration in seconds (bindable). -1 if unknown. */
		duration?: number;
		/** Current playback time in seconds (bindable). */
		currentTime?: number;
		/** Is this the main 360 video background? */
		is360?: boolean;
		/** Optional video tour data object to synchronize playback with. */
		tour?: Models.ImageData.VideoTour | null;
		/** Is this media secondary (e.g., hidden audio track for a video tour embed)? */
		secondary?: boolean;
		/** Optional target element for fullscreen requests. */
		fullscreen?: HTMLElement | undefined;
		/** Optional additional CSS class name for the figure element. */
		className?: string | null;
		/** Does the video source have a separate H.265 version for Safari transparency? */
		hasTransparentH265?: boolean;
		/** If true, don't show the large play button overlay when autoplay is blocked. */
		noPlayOverlay?: boolean;
		/** Unique identifier for this media instance (used for state persistence). */
		uuid?: string;
		/** The MicrioImage instance this media belongs to (usually the current image). */
		image?: MicrioImage;
		/** A destroying writable to indicate media should pause */
		destroying?: Writable<boolean>;
		_media?: HTMLMediaElement | undefined;
		onended?: Function;
		onblocked?: Function;
		onplay?: Function;
		onid?: (id: string) => void;
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
		is360 = false,
		tour = null,
		secondary = false,
		fullscreen = undefined,
		className = null,
		hasTransparentH265 = false,
		noPlayOverlay = false,
		uuid = $bindable(''),
		image = get(micrio.current) as MicrioImage,
		destroying = undefined,
		_media = $bindable(undefined),
		onended,
		onblocked,
		onplay,
		onid,
	}: Props = $props();

	// ============================================================================
	// Derived State
	// ============================================================================

	const muted = $derived(volume == 0);

	// Unique ID for state persistence
	uuid += src ?? tour?.id;

	// ============================================================================
	// Context & Global State
	// ============================================================================

	const info = image.$info as Models.ImageInfo.ImageInfo;
	const { events, state: micrioState, _lang } = micrio;
	const mainVolume: Writable<number> = getContext('volume');
	const wasMuted = $mainVolume == 0;
	const subtitle = getContext<Writable<string | undefined>>('srt');
	const mediaPaused = getContext<Writable<boolean>>('mediaPaused');

	// ============================================================================
	// Source Parsing
	// ============================================================================

	const noJSPlayers = micrio.hasAttribute('data-native-frame');
	const parsedSource = parseMediaSource(src, tour, noJSPlayers, currentTime ?? 0);
	const { type, frameType, isCloudflare, micrioEmbed: mic, hlsSrc: cfVidSrc } = parsedSource;

	let realSrc: string | undefined = $state(parsedSource.src ?? src);

	// Micrio embeds don't have a paused state
	if (type == MediaType.Micrio) paused = false;

	// Disable controls for Micrio embeds or non-API iframes
	if (type == MediaType.Micrio || (type == MediaType.IFrame && !frameType)) controls = false;

	// ============================================================================
	// Player State
	// ============================================================================

	/** Player adapter instance for iframe players */
	let playerAdapter: MediaPlayerAdapter | undefined;

	/** Interval timer for manual time updates (for API players). */
	let _tick: number = -1;

	/** Flag to prevent pointer events on iframe while interacting with player API. */
	let hooked: boolean = $state(frameType == FrameType.YouTube || frameType == FrameType.Vimeo);

	/** Use the shared iOS audio element workaround? */
	const singleAudio: boolean = type == MediaType.Audio && Browser.iOS;

	/** Calculated scale factor. */
	let scale: number = 1;

	// DOM Element References
	let _frame: HTMLIFrameElement | undefined = $state();

	// ============================================================================
	// Media State Persistence
	// ============================================================================

	let startTime: number;

	// Check for existing media state
	const existing = micrioState.mediaState.get(uuid);
	if (existing) {
		currentTime = existing.currentTime;
		autoplay = !(paused = existing.paused);
	}

	// Register this media instance with the global state manager
	micrioState.mediaState.set(uuid, {
		get currentTime() {
			return currentTime ?? 0;
		},
		set currentTime(v: number) {
			setCurrentTime(v);
		},
		get paused() {
			return paused;
		},
		set paused(b: boolean) {
			if (b) pause();
			else play();
		},
	});

	// ============================================================================
	// Video Tour Setup
	// ============================================================================

	let videoTour: VideoTourInstance | undefined = $state();
	if (tour) {
		const newTour = new VideoTourInstance(image, tour);
		if (currentTime != undefined && currentTime > 0) newTour.currentTime = currentTime;
		if (type == MediaType.VideoTour) {
			duration = 'duration' in tour ? Number(tour.duration) : (tour.i18n?.[$_lang]?.duration ?? 0);
			volume = NaN; // Indicate no volume control needed
		}
		videoTour = newTour;
	}

	// ============================================================================
	// Subtitle Setup
	// ============================================================================

	const sub: Models.Assets.Subtitle | undefined =
		tour && !('steps' in tour)
			? 'subtitle' in tour
				? (tour['subtitle'] as Models.Assets.Subtitle)
				: tour.i18n?.[micrio.lang]?.subtitle
			: undefined;
	const srt = sub && ('fileUrl' in sub ? (sub['fileUrl'] as string) : sub.src);

	// ============================================================================
	// Playback Control
	// ============================================================================

	let showPlayButton: boolean = $state(false);
	let _ended: boolean = $state(false);
	let hasInited: boolean = false;
	let frameAutoplayBlocked: boolean = $state(false);
	let loopDelayTo: ReturnType<typeof setTimeout>;

	/** Toggles play/pause state. */
	function playPause(e?: PointerEvent | CustomEvent): void {
		if (e && 'button' in e && e.button != 0) return;
		if (paused) play();
		else pause();
	}

	/** Checks if the media is currently paused. */
	async function isPaused(): Promise<boolean> {
		if (_media) return _media.paused;
		if (videoTour) return paused;
		if (playerAdapter) return playerAdapter.isPaused();
		return false;
	}

	/** Initiates playback. */
	async function play(e?: PointerEvent): Promise<void> {
		if (e instanceof PointerEvent && e.button != 0) return;
		if (hasInited && !(await isPaused())) return;
		_ended = false;

		// Reset time if ended
		if (duration > 0 && currentTime != undefined && currentTime >= duration) currentTime = 0;

		// Show subtitles if applicable
		if (!secondary && srt) subtitle.set(srt);

		// Trigger playback based on type
		switch (type) {
			case MediaType.VideoTour:
				paused = seeking = false;
				videoTour?.play();
				startTick();
				break;

			case MediaType.Audio:
			case MediaType.Video:
				_media?.addEventListener(
					'play',
					() => {
						if (!_media) return;
						if (isNaN(_media.duration)) {
							_media.addEventListener('durationchange', mediaPlaying, { once: true });
						} else {
							mediaPlaying();
						}
					},
					{ once: true }
				);
				_media?.play().catch((e) => {
					if (noPlayOverlay) {
						paused = true;
					} else if (!/pause\(\)/.test(e.toString())) {
						showPlayButton = true;
						micrio.events.dispatch('media-blocked');
						onblocked?.();
					}
				});
				break;

			case MediaType.IFrame:
				playerAdapter?.play();
				break;

			default:
				return;
		}

		hasInited = true;
		events.dispatch('media-play');
		mediaPaused.set(false);
		onplay?.();

		// Mute main volume if needed
		if (!is360 && !wasMuted && !(videoTour && !_media)) {
			mainVolume.set(image.$settings.mutedVolume || 0);
		}
	}

	/** Pauses playback. */
	function pause(): void {
		events.dispatch('media-pause');
		mediaPaused.set(true);

		if (_media) {
			_media.pause();
			if (singleAudio) paused = true;
		} else if (videoTour) {
			videoTour.pause();
			paused = true;
			endTick();
		} else if (playerAdapter && !destroyed) {
			playerAdapter.pause();
		}
	}

	/** Called when HTML5 media starts playing. */
	function mediaPlaying(): void {
		showPlayButton = false;
		paused = false;
		if (videoTour && _media) {
			if (_media.duration > videoTour.duration) videoTour.duration = _media.duration;
			videoTour.currentTime = _media.currentTime;
			videoTour.play();
		}
	}

	/** Called when media element can play. */
	function canplay(): void {
		seeking = false;
		if (is360 && image && !image._video) image.video.set(_media as HTMLVideoElement);
	}

	/** Called when media playback ends. */
	function ended(): void {
		if (_ended) return;
		if (videoTour) pause();
		else {
			paused = true;
			endTick();
		}
		_ended = true;
		events.dispatch('media-ended');
		onended?.();
		stoppedPlaying();
	}

	// ============================================================================
	// Time & Seeking
	// ============================================================================

	/** Sets muted state. */
	function setMuted(b: boolean): void {
		if (_media) {
			_media.muted = b;
		} else if (playerAdapter) {
			playerAdapter.setMuted(b);
		}
	}

	/** Sets current playback time. */
	function setCurrentTime(v: number): void {
		seeking = true;
		if (_media) {
			_media.currentTime = v;
		} else if (videoTour) {
			currentTime = videoTour.currentTime = v;
			seeking = false;
		} else if (playerAdapter) {
			playerAdapter.setCurrentTime(v);
		}
	}

	/** Gets current time (for interval timer). */
	function getCurrentTime(): void {
		if (videoTour) {
			currentTime = videoTour.currentTime;
			if (videoTour.ended) ended();
		} else if (playerAdapter) {
			playerAdapter.getCurrentTime().then((t) => {
				currentTime = t;
			});
		}
		sendTimeupdate();
	}

	/** Dispatches timeupdate event. */
	function sendTimeupdate(): void {
		if (!secondary) events.dispatch('timeupdate', currentTime);
	}

	// ============================================================================
	// Time Update Ticker
	// ============================================================================

	function startTick(): void {
		if (_tick >= 0) return;
		_tick = setInterval(getCurrentTime, 250) as unknown as number;
		getCurrentTime();
	}

	function endTick(): void {
		clearInterval(_tick);
		_tick = -1;
	}

	// ============================================================================
	// Player Loading
	// ============================================================================

	async function loadPlayer(): Promise<void> {
		// Load HLS player if needed
		if (isCloudflare && cfVidSrc && !hasNativeHLS(_media)) {
			const adapter = new HLSPlayerAdapter(_media as HTMLVideoElement, cfVidSrc, {
				onReady: () => (seeking = false),
				onEnded: ended,
			});
			await adapter.initialize();
			playerAdapter = adapter;
			return;
		}

		// Load iframe players
		if (type == MediaType.IFrame && _frame) {
			if (frameType == FrameType.YouTube) {
				const adapter = new YouTubePlayerAdapter(
					_frame,
					{ width: rWidth, height: rHeight },
					{
						onReady: () => (seeking = false),
						onDurationChange: (d) => (duration = d),
						onPlay: () => {
							startTick();
							frameAutoplayBlocked = paused = seeking = false;
						},
						onPause: () => {
							paused = true;
							endTick();
						},
						onEnded: ended,
						onBlocked: () => {
							frameAutoplayBlocked = paused = true;
							endTick();
						},
						onSeeking: () => {
							getCurrentTime();
							seeking = true;
							endTick();
						},
					}
				);
				seeking = true;
				await adapter.initialize();
				playerAdapter = adapter;
				return;
			}

			if (frameType == FrameType.Vimeo) {
				const adapter = new VimeoPlayerAdapter(
					_frame,
					{ width: rWidth, height: rHeight },
					{
						onReady: () => (seeking = false),
						onPlay: () => (paused = seeking = false),
						onPause: () => (paused = true),
						onSeeking: () => (seeking = true),
						onSeeked: () => (seeking = false),
						onTimeUpdate: (t) => (currentTime = t),
						onDurationChange: (d) => (duration = d),
						onEnded: ended,
					}
				);
				seeking = true;
				await adapter.initialize();
				playerAdapter = adapter;
				return;
			}
		}

		// Hook events for HTML5 media
		if (_media) {
			if (isCloudflare && cfVidSrc) realSrc = cfVidSrc;
			hookMedia();
		}
	}

	// ============================================================================
	// HTML5 Media Event Hooks
	// ============================================================================

	let pauseAfterSeek: boolean = false;
	let mediaWasEnded: boolean = false;

	function hookMedia(): void {
		if (!_media) return;

		_media.ontimeupdate = sendTimeupdate;

		if (videoTour) {
			_media.onpause = () => {
				mediaWasEnded = !!_media?.ended;
				if (!_media?.ended) videoTour.pause();
			};
			_media.onseeked = () => {
				if (!_media || _media.ended || mediaWasEnded) return;
				videoTour.currentTime = _media.currentTime;
				if (pauseAfterSeek) {
					_media.pause();
					pauseAfterSeek = false;
				}
			};
		}

		// Set initial time if needed
		if (currentTime != undefined && currentTime > 0) {
			if (_media.duration > 0) {
				_media.currentTime = currentTime;
			} else {
				_media.oncanplay = () => {
					if (!_media) return;
					_media.oncanplay = null;
					if (!autoplay) {
						_media.play();
						pauseAfterSeek = true;
					}
					_media.currentTime = startTime;
				};
			}
		}

		// Handle looping with delay
		const ld = loop && loopDelay !== undefined ? loopDelay : -1;
		if (ld >= 0) {
			_media.onended = () => {
				clearTimeout(loopDelayTo);
				loopDelayTo = setTimeout(() => {
					if (!forcePause) _media?.play();
				}, ld * 1000);
			};
		} else {
			_media.onended = ended;
		}
	}

	function cto(): void {
		clearTimeout(loopDelayTo);
	}

	function stoppedPlaying(): void {
		if (!wasMuted) mainVolume.set(1);
	}

	// ============================================================================
	// Lifecycle & Cleanup
	// ============================================================================

	let destroyed: boolean = $state(false);

	const unsub =
		destroying &&
		destroying.subscribe((d) => {
			if (d) preDestroy();
		});

	const iOSAudioTimeUpdate = () => (currentTime = _media?.currentTime ?? 0);

	function preDestroy(): void {
		if (destroyed) return;
		destroyed = true;
		if (unsub) unsub();

		if (is360 && image) image.video.set(undefined);
		micrioState.mediaState.delete(uuid);
		endTick();
		pause();
		stoppedPlaying();
		if (srt) subtitle.set(undefined);

		if (_media) {
			_media.onended = null;
			if (singleAudio) {
				_media.onloadedmetadata = _media.onplay = _media.onseeking = _media.onseeked = null;
				_media.removeEventListener('timeupdate', iOSAudioTimeUpdate);
			}
			_media.ontimeupdate = _media.onpause = _media.onseeked = _media.oncanplay = null;
		}

		if (videoTour) {
			videoTour.destroy();
		}

		if (playerAdapter) {
			playerAdapter.destroy();
			playerAdapter = undefined;
		}
	}

	// ============================================================================
	// Rendering State
	// ============================================================================

	const isVideo = type == MediaType.Video;
	let hideUntilPlaying = $state(isVideo && isCloudflare && frameScale != 1 && Browser.iOS);

	// Scale calculations
	const scaleFact = info.is360 ? Math.PI / 2 : 1;
	const relScale = $derived(
		isVideo
			? frameScale * scaleFact
			: type == MediaType.IFrame
				? Math.max(frameScale, Math.min(width / 512, height / 512))
				: 1
	);
	const rWidth = $derived(isVideo ? width : Math.round((width / relScale) * scaleFact));
	const rHeight = $derived(isVideo ? height : Math.round((height / relScale) * scaleFact));

	// DOM element references
	let _cnt: HTMLElement | undefined = $state();
	let _container: HTMLElement | undefined = $state();

	// Video tour events
	const videoTourEvents = $derived(
		videoTour && tour
			? 'events' in tour
				? (tour.events as Models.ImageData.VideoTourView[])
				: (tour.i18n?.[$_lang]?.events ?? undefined)
			: undefined
	);

	// ============================================================================
	// Mount & Effects
	// ============================================================================

	onMount(() => {
		onid?.(uuid);

		// Handle shared iOS audio element setup
		if (src && singleAudio) {
			_media = getIOSAudioElement();
			_media.controls = false;
			_media.onloadedmetadata = () => (duration = _media?.duration ?? 0);
			_media.src = src;
			_media.oncanplay = canplay;
			_media.onended = ended;
			_media.addEventListener('timeupdate', iOSAudioTimeUpdate);
			_media.onseeking = () => (seeking = true);
			_media.onseeked = () => (seeking = false);
		}

		startTime = currentTime || 0;
		hooked = frameType == FrameType.YouTube || frameType == FrameType.Vimeo;

		loadPlayer()
			.then(() => {
				if (autoplay) play();
			})
			.catch(() => {});

		if (hideUntilPlaying) {
			_media?.addEventListener('playing', () => (hideUntilPlaying = false), { once: true });
		}

		const unsubscribeChangeGlobalMuted = micrio.isMuted.subscribe((b) => setMuted(b));

		return () => {
			preDestroy();
			unsubscribeChangeGlobalMuted();
			if (singleAudio) _media = undefined;
			playerAdapter?.destroy();
		};
	});

	// Reactive effects
	$effect(() => {
		if (_media && type == MediaType.Video && !muted) _media.muted = volume == 0;
	});
	$effect(() => {
		if (forcePause !== undefined) paused = forcePause;
	});
	$effect(() => {
		if (loop && loopDelay !== undefined) cto();
	});
</script>

{#if !image.$settings.noUI}
	<figure
		bind:this={_cnt}
		class:paused
		class:is360
		class:media-video={type == MediaType.IFrame || type == MediaType.Video}
		class:media-micrio={type == MediaType.Micrio}
		class={className}
		style={scale != 1 ? `--scale:${1 / scale}` : null}
	>
		<div
			onpointerup={(e) => {
				if (e.target == _container) playPause(e);
			}}
			class:videotour={!!videoTour}
			bind:this={_container}
			style={relScale != 1 && (type == MediaType.Video || !info.is360)
				? `transform:scale(${relScale})`
				: ''}
		>
			{#if type == MediaType.IFrame}
				<iframe
					{...notypecheck({ credentialless: true })}
					{title}
					src={realSrc}
					width={rWidth}
					height={rHeight}
					class:hooked={hooked && !frameAutoplayBlocked}
					bind:this={_frame}
					frameborder="0"
					allow="fullscreen *;autoplay *;encrypted-media *"
				></iframe>
			{:else if type == MediaType.Video}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					controls={false}
					loop={loop && (loopDelay == undefined || loopDelay <= 0)}
					playsinline
					{width}
					{height}
					bind:this={_media}
					style={hideUntilPlaying ? 'opacity: 0' : undefined}
					bind:duration
					{muted}
					autoplay={!!autoplay}
					bind:currentTime
					bind:seeking
					bind:paused
					oncanplay={canplay}
					onended={ended}
				>
					{#if realSrc}
						{#if hasTransparentH265 && realSrc.endsWith('.webm')}
							<source src={realSrc.replace('.webm', '.mp4')} type="video/mp4;codecs=hvc1" />
						{/if}
						<source src={realSrc} type={isCloudflare ? 'application/x-mpegURL' : undefined} />
					{/if}
				</video>
			{:else if type == MediaType.Audio && !singleAudio}
				<audio
					src={realSrc}
					controls={false}
					bind:this={_media}
					bind:duration
					{muted}
					bind:currentTime
					bind:seeking
					bind:paused
					oncanplay={() => (seeking = false)}
					onended={ended}
				></audio>
			{:else if type == MediaType.Micrio && mic}
				<micr-io
					data-logo="false"
					id={mic[0]}
					width={mic[1]}
					height={mic[2]}
					lang={mic[3]}
					data-path={info.path}
				></micr-io>
			{/if}

			{#if videoTourEvents?.length && duration > 0 && !destroyed}
				<Events events={videoTourEvents} bind:currentTime bind:duration />
			{/if}

			{#if controls}
				<aside class:inside={controls == 'inside'}>
					<MediaControls
						subtitles={!!srt}
						fullscreen={!is360 && (type == MediaType.IFrame || type == MediaType.Video)
							? _cnt
							: fullscreen}
						bind:paused
						bind:seeking
						bind:duration
						bind:currentTime
						bind:ended={_ended}
						onplaypause={playPause}
						onmute={() => micrio.isMuted.update((v) => !v)}
						onseek={(t) => setCurrentTime(t)}
					/>
				</aside>
			{/if}
		</div>

		{#if figcaption}
			<figcaption>{@html figcaption}</figcaption>
		{/if}
	</figure>

	{#if showPlayButton}
		<div class="show-play" onpointerup={play}>
			<Button title={$i18n.play} type="play" />
		</div>
	{/if}
{/if}

<style>
	figure {
		display: block;
		margin: 0;
		width: 100%;
		position: relative;
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

	iframe,
	video {
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
		margin: 0.5em 1em 0.5em 1em;
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

	aside {
		width: 100%;
		display: flex;
	}

	aside.inside {
		position: absolute;
		transform: translateY(-100%);
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
