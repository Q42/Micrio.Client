import { vi } from 'vitest'
import type { MicrioElement } from '../../src/core/component'
import { createElement } from '../../src/utils/dom'
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

/** A scriptable stand-in for one of the external player instances. */
export interface FakePlayer {
	/** Records every method call, so delegation can be asserted. */
	readonly calls: string[]
	/** Clears the recorded calls. */
	clearCalls: () => void
}

/**
 * Installs a fake constructor for `YT`, `Vimeo` or `Hls`.
 *
 * The returned handle exposes the instances built from it, so tests can drive player
 * events. Restoring is the caller's job via the returned `restore`.
 */
export function stubPlayerApi<T extends FakePlayer>(name: 'YT' | 'Vimeo' | 'Hls', create: () => T) {
	const instances: T[] = []
	const frames: HTMLIFrameElement[] = []
	const configs: unknown[] = []

	// A function constructor rather than a class: the fake only exists to capture the
	// arguments and hand out an instance, which an empty class cannot do without
	// tripping the linter's extraneous-class rule.
	function StubPlayerApi(frame?: unknown, config?: unknown) {
		if (frame instanceof HTMLIFrameElement) {
			frames.push(frame)
		}
		configs.push(config)
		instances.push(create())
	}

	const original: unknown = (globalThis as Record<string, unknown>)[name]
	// `loadExternalAPI` calls `new YT['Player'](...)`, so the property has to be a class
	;(globalThis as Record<string, unknown>)[name] = { Player: StubPlayerApi }

	return {
		instances,
		frames,
		configs,
		/** The most recently constructed fake player. */
		instance: (): T | undefined => instances.at(-1),
		/** The options object the last construction received. */
		config: (): unknown => configs.at(-1),
		restore: () => {
			if (original === undefined) {
				delete (globalThis as Record<string, unknown>)[name]
			} else {
				;(globalThis as Record<string, unknown>)[name] = original
			}
			vi.restoreAllMocks()
		},
	}
}

/** Makes `loadExternalAPI`'s `Hls` lookup resolve to a fake that records its wiring. */
export function stubHls() {
	const calls: { loadSource?: string; attachMedia?: HTMLMediaElement; config?: unknown; destroyed: number } = {
		destroyed: 0,
	}
	class FakeHls {
		constructor(config?: unknown) {
			calls.config = config
		}
		loadSource(src: string) {
			calls.loadSource = src
		}
		attachMedia(el: HTMLMediaElement) {
			calls.attachMedia = el
		}
		destroy() {
			calls.destroyed++
		}
	}
	const original: unknown = (globalThis as Record<string, unknown>).Hls
	;(globalThis as Record<string, unknown>).Hls = FakeHls
	return {
		calls,
		restore: () => {
			if (original === undefined) {
				delete (globalThis as Record<string, unknown>).Hls
			} else {
				;(globalThis as Record<string, unknown>).Hls = original
			}
		},
	}
}
