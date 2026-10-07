/**
 * The audio level rules an image's settings describe.
 *
 * `startVolume` and `mutedVolume` are parsed for every image, and the same three places
 * need to agree on them: the `volume` store the layout provides, the Web Audio master
 * gain, and the playlist's own element volume.
 *
 * @author Marcel Duin <marcel@micr.io>
 */

import type { MicrioImage } from '$core/image'

/** Clamps a configured volume into the valid `[0, 1]` range. @internal */
function clampVolume(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

/** The level to play at when muted, from `_settings.mutedVolume` (default `0`). @internal */
export function mutedVolume(image: MicrioImage): number {
	return clampVolume(image.$settings.mutedVolume, 0)
}

/** The level to play at when unmuted, from `_settings.startVolume` (default `1`). @internal */
export function startVolume(image: MicrioImage): number {
	return clampVolume(image.$settings.startVolume, 1)
}

/**
 * The volume for a mute state: `startVolume` when playing, `mutedVolume` when muted —
 * which is silent by default, but configurable, so muting need not mean volume 0.
 * @internal
 */
export function volumeFor(image: MicrioImage, muted: boolean): number {
	return muted ? mutedVolume(image) : startVolume(image)
}

/**
 * Whether this image has anything the audio layer can play: a music playlist or a
 * marker with positional audio.
 * @internal
 */
export function imageHasAudio(image: MicrioImage): boolean {
	const data = image.$data
	if (data?.music?.items.length) {
		return true
	}
	return Boolean(data?.markers?.some((m) => m.positionalAudio))
}
