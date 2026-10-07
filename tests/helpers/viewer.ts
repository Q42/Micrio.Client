import type { HTMLMicrioElement } from '$core/element'
import type { Models } from '$types/models'

/** A mounted `<micr-io>` plus the teardown that removes it again. */
export interface Viewer {
	el: HTMLMicrioElement
	/** Opens a bundle object or resolves an image id (which goes through `bundle.json`). */
	open: (
		idOrBundle: Parameters<HTMLMicrioElement['open']>[0],
		opts?: Parameters<HTMLMicrioElement['open']>[1],
	) => Promise<void>
	destroy: () => void
}

/**
 * Mounts a visible, sized `<micr-io>` element into the document body.
 * `attrs` may be a plain attribute map, or a single id string for the common case.
 */
export function mountViewer(
	attrs: Record<string, string> | string = {},
	style = 'width: 800px; height: 600px; display: block;',
): Viewer {
	const el = document.createElement('micr-io') as HTMLMicrioElement
	el.setAttribute('style', style)
	if (typeof attrs === 'string') {
		el.id = attrs
	} else {
		for (const [key, value] of Object.entries(attrs)) {
			el.setAttribute(key, value)
		}
	}
	document.body.append(el)

	return {
		el,
		async open(idOrBundle, opts) {
			await el.open(idOrBundle, opts)
		},
		destroy() {
			el.destroy()
			el.remove()
		},
	}
}

/**
 * Resolves once `predicate` is true, polling on animation frames; rejects after `timeout` ms.
 *
 * The polling is on `requestAnimationFrame`, so a faked clock never advances it: mount and
 * open with real timers, then switch to `vi.useFakeTimers()` (the pattern
 * `tests/browser/media/video-tour.test.ts` documents under `mountWithFakeTime`).
 */
export function waitFor(predicate: () => boolean, timeout = 5000, label = 'condition'): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const start = performance.now()
		const check = () => {
			if (predicate()) {
				resolve()
				return
			}
			if (performance.now() - start > timeout) {
				reject(new Error(`Timed out waiting for ${label}`))
				return
			}
			requestAnimationFrame(check)
		}
		check()
	})
}

/**
 * Collects dispatched custom events of the given types on the viewer.
 *
 * Keyed on the public event map so a typo'd name cannot silently collect nothing.
 */
export function collectEvents<K extends keyof Models.MicrioEventDetails>(
	el: HTMLMicrioElement,
	types: readonly K[],
): { types: K[]; stop: () => void } {
	const seen: K[] = []
	const handlers = types.map((type) => {
		const fn = () => seen.push(type)
		el.addEventListener(type, fn)
		return [type, fn] as const
	})
	return {
		types: seen,
		stop: () => {
			for (const [type, fn] of handlers) {
				el.removeEventListener(type, fn)
			}
		},
	}
}
