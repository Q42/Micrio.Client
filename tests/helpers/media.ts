import type { MicrioElement } from '$core/component'
import { createElement } from '$utils/dom'
import { settle, type TourSetup } from './tour'
import { waitFor } from './viewer'

/**
 * Helpers shared by the media and adapter suites.
 *
 * The three external player APIs (`YT`, `Vimeo`, `Hls`) are stubbed at the global
 * they are read from, which also short-circuits `loadExternalAPI`: it only loads a
 * script when the key is missing from `globalThis`, so stubbing first means no
 * third-party CDN is ever contacted.
 */

/** Mounts a `micrio-media` into a viewer so `_inject('micrio')` resolves. */
export async function mountMedia(props: Record<string, unknown>, viewer: TourSetup) {
	const el = createElement('micrio-media', { setProps: props, parent: viewer.el }) as MicrioElement
	await settle(2)
	return el
}

/** Waits until `micrio-media` has rendered its figure. */
export async function waitForRender(el: Element) {
	await waitFor(() => el.querySelector('figure') !== null, 4000, 'media figure')
}

/** The media element inside a mounted `micrio-media`, if it owns one. */
export const mediaOf = (el: Element) => el.querySelector('video, audio')

/**
 * The shared audio element, which `media.ts` appends to the body rather than to the
 * component, so queries have to look outside the element.
 */
export const anyMedia = (el: Element) => document.querySelector('body > audio, body > video') ?? mediaOf(el)
