// Media

export interface YouTubePlayer {
	playVideo: () => void;
	pauseVideo: () => void;
	stopVideo: () => void;
	getDuration: () => number;
	getCurrentTime: () => number;
	getPlayerState: () => number;
	isMuted: () => boolean;
	mute: () => void;
	unMute: () => void;
	seekTo: (a:number) => void;
	destroy: () => void;
}

export interface VimeoPlayer {
	on: (a:string, b: (d?: {
		duration: number;
		seconds: number;
		volume: number;
	}) => void) => void;
	off: (a:string) => void;
	play: () => void;
	pause: () => void;
	getDuration: () => Promise<number>;
	getCurrentTime: () => Promise<number>;
	setCurrentTime: (s:number) => void;
	getPaused: () => Promise<boolean>;
	getVolume: () => Promise<number>;
	setVolume: (s:number) => void;
	destroy: () => void;
}

export interface HlsPlayer {
	loadSource: (a:string) => void;
	attachMedia: (a:HTMLMediaElement) => void;
	destroy: () => void;
}

/** The global `Hls` constructor exposed by the HLS.js script tag. */
export interface HlsPlayerConstructor {
	new(config?: Record<string, unknown>) : HlsPlayer;
}

/** The global `YT` namespace exposed by the YouTube IFrame Player API script. */
export interface YouTubeIframeApi {
	Player: new (frame: HTMLIFrameElement, options: Record<string, unknown>) => YouTubePlayer;
}

/** The global `Vimeo` namespace exposed by the Vimeo Player API script. */
export interface VimeoPlayerApi {
	Player: new (frame: HTMLIFrameElement, options: Record<string, unknown>) => VimeoPlayer;
}

/** Externals loaded on demand by `loadExternalAPI`, so both are absent until then.
 *  Declared both on `Window` and as global variables, since the adapters read them
 *  off `globalThis` (`unicorn/prefer-global-this`). */
declare global {
	interface Window {
		YT?: YouTubeIframeApi;
		Vimeo?: VimeoPlayerApi;
	}

	var YT: YouTubeIframeApi | undefined;
	var Vimeo: VimeoPlayerApi | undefined;
}
