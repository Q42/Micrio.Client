/**
 * Media player adapters module.
 * Provides unified interfaces for different media player types.
 * @author Marcel Duin <marcel@micr.io>
 */

export type { MediaPlayerAdapter, PlayerEventCallbacks, PlayerConfig } from './types';
export { HTML5PlayerAdapter } from './html5-adapter';
export { YouTubePlayerAdapter } from './youtube-adapter';
export { VimeoPlayerAdapter } from './vimeo-adapter';
export { HLSPlayerAdapter } from './hls-adapter';
