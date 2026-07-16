/**
 * Media player type definitions and interfaces.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Common interface for all media player adapters.
 * Abstracts the differences between HTML5, YouTube, Vimeo, and HLS players.
 */
export interface MediaPlayerAdapter {
	/** Play the media */
	play(): Promise<void>;

	/** Pause the media */
	pause(): void;

	/** Get current playback time in seconds */
	getCurrentTime(): Promise<number>;

	/** Set current playback time in seconds */
	setCurrentTime(time: number): void;

	/** Get total duration in seconds */
	getDuration(): Promise<number>;

	/** Check if media is currently paused */
	isPaused(): Promise<boolean>;

	/** Set muted state */
	setMuted(muted: boolean): void;

	/** Set volume (0-1) */
	setVolume(volume: number): void;

	/** Clean up resources */
	destroy(): void;

	/** Whether this adapter requires manual time updates via interval */
	readonly requiresTimeTick: boolean;
}

/**
 * Event callbacks for player state changes.
 */
export interface PlayerEventCallbacks {
	onPlay?: () => void;
	onPause?: () => void;
	onEnded?: () => void;
	onSeeking?: () => void;
	onSeeked?: () => void;
	onTimeUpdate?: (time: number) => void;
	onDurationChange?: (duration: number) => void;
	onError?: (error: Error) => void;
	onBuffering?: () => void;
	onReady?: () => void;
	onBlocked?: () => void;
}

/**
 * Configuration for creating a player adapter.
 */
export interface PlayerConfig {
	width: number;
	height: number;
	autoplay?: boolean;
	loop?: boolean;
	muted?: boolean;
	volume?: number;
	startTime?: number;
}
