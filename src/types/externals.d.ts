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
