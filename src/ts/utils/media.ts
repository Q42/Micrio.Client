/**
 * Media detection utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Checks if the browser natively supports HLS video playback via the `<video>` element.
 * @internal
 * @param video Optional HTMLVideoElement to check (defaults to creating a temporary one).
 * @returns True if native HLS support is detected.
 */
export const hasNativeHLS = (video?: HTMLMediaElement): boolean => {
	const vid = video ?? document.createElement('video');
	return !!(vid.canPlayType('application/vnd.apple.mpegurl') || vid.canPlayType('application/x-mpegURL'));
};

