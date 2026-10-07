import type { Models } from '$types/models'
import { baseInfo } from './bundles'

/**
 * Embed fixtures for the `src/embed` suites.
 *
 * An embed (`Models.ImageData.Embed`) is a rectangle inside an image that
 * renders one of: a plain `<img>` (`src`), an `<iframe>` (`frameSrc`), a
 * `<video>` (`video`), a tiled Micrio sub-image (`micrioId`, rendered inside
 * WebGL), or an empty clickable `<button>` (a Spaces hotspot).
 *
 * Two rules the builders exist to enforce:
 *
 * - **Fresh bundle ids per call.** `DataLoader`'s bundle cache and `fetchJson`'s
 *   response cache are module-level (see TESTING.md), so every `embedBundle()`
 *   invents a new id — otherwise the second test opening a bundle gets the
 *   first test's data.
 * - **Hermetic asset URLs.** An `<iframe src>` and an `<img src>` are not
 *   intercepted by the `fetch` patch in `helpers/network.ts`, so fixtures use
 *   `about:blank` / `data:` URLs and tests that only care about attributes
 *   never touch the network.
 */

/** The video asset fields an embed can carry, including the pause-on-zoom thresholds. */
export type VideoExtra = Partial<NonNullable<Models.ImageData.Embed['video']>>

/** A video asset with sensible defaults; override what a test needs. */
export const videoAsset = (extra: VideoExtra = {}): Models.Assets.Video => ({
	title: 'Embed video',
	src: 'https://example.test/embed.webm',
	size: 1024,
	uploaded: 0,
	width: 640,
	height: 360,
	duration: 10,
	muted: false,
	loop: false,
	autoplay: false,
	controls: false,
	transparent: false,
	...extra,
})

/**
 * One embed definition. `area` is `[x, y, width, height]` in image coordinates
 * (0-1), defaulting to a quarter-size patch in the middle-left.
 */
export const embed = (extra: Partial<Models.ImageData.Embed> = {}): Models.ImageData.Embed => ({
	area: [0.25, 0.25, 0.25, 0.25],
	...extra,
})

/** An `<img>` embed (HTML in every mode — a `src`-only embed is never tiled). */
export const imageEmbed = (extra: Partial<Models.ImageData.Embed> = {}): Models.ImageData.Embed =>
	embed({ src: 'about:blank', ...extra })

/** An iframe embed, which always has an HTML layer so it stays interactive. */
export const frameEmbed = (extra: Partial<Models.ImageData.Embed> = {}): Models.ImageData.Embed =>
	embed({ frameSrc: 'about:blank', ...extra })

/** A `<video>` embed, controls off by default (so it is a WebGL embed by default). */
export const videoEmbed = (extra: Partial<Models.ImageData.Embed> = {}, video: VideoExtra = {}) =>
	embed({ video: videoAsset(video), ...extra })

/** A tiled Micrio sub-image embed (`micrioId`), large enough to prefer WebGL. */
export const glEmbed = (extra: Partial<Models.ImageData.Embed> = {}): Models.ImageData.Embed =>
	embed({ micrioId: 'subimg1', width: 2048, height: 1536, ...extra })

let run = 0

/** A fresh image id per call, so the module-level bundle/data caches never collide. */
export const embedImageId = (): string => `embed${(++run).toString(36).padStart(3, '0')}`

/**
 * A 2D image bundle whose `data.embeds` holds the given embeds. Fresh id per
 * call, so the layout's `<micrio-image-embeds>` layer mounts cleanly for each
 * test that opens it.
 */
export const embedBundle = (
	embeds: Models.ImageData.Embed[] = [glEmbed()],
	extra: Partial<Models.ImageBundle.BundleImage> = {},
): Models.ImageBundle.BundleImage => {
	const id = embedImageId()
	return {
		id,
		info: baseInfo(id, { title: 'Embed image' }),
		settings: {},
		data: { embeds },
		...extra,
	}
}
