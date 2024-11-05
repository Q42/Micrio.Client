// Media

export type YouTubePlayer = {
	new(frame: HTMLIFrameElement, options:{
		host: string;
		width: string;
		height: string;
		playerVars: {
			controls: number
		},
		events: {
			onReady: () => void;
			onStateChange: (a: {data: number}) => void;
			onError: () => void;
		}
	}) : YouTubePlayer;

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

export type VimeoPlayer = {
	new(frame: HTMLIFrameElement, options:{
		title: boolean;
		width: string;
		height: string;
		autoplay: boolean;
	}) : VimeoPlayer;

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

export type HlsPlayer = {
	new() : HlsPlayer;
	loadSource: (a:string) => void;
	attachMedia: (a:HTMLMediaElement) => void;
	destroy: () => void;
}
