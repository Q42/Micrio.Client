import type { HTMLMicrioElement } from '../../src/core/element'
import type { Models } from '../../src/types/models'

/** A mounted `<micr-io>` plus the teardown that removes it again. */
export interface Viewer {
	el: HTMLMicrioElement
	/** Waits until the given bundle id is the current image, or rejects on timeout. */
	open(bundle: Models.ImageBundle.BundleImage, opts?: Parameters<HTMLMicrioElement['open']>[1]): Promise<void>
	destroy(): void
}

/** Mounts a visible, sized `<micr-io>` element into the document body. */
export function mountViewer(
	attrs: Record<string, string> = {},
	style = 'width: 800px; height: 600px; display: block;',
): Viewer {
	const el = document.createElement('micr-io') as HTMLMicrioElement
	el.setAttribute('style', style)
	for (const [key, value] of Object.entries(attrs)) {
		el.setAttribute(key, value)
	}
	document.body.append(el)

	return {
		el,
		async open(bundle, opts) {
			await el.open(bundle, opts)
		},
		destroy() {
			el.destroy()
			el.remove()
		},
	}
}

/** Resolves once `predicate` is true, polling on animation frames; rejects after `timeout` ms. */
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

/** Collects dispatched custom events of the given types on the viewer. */
export function collectEvents(el: HTMLMicrioElement, types: string[]): { types: string[]; stop: () => void } {
	const seen: string[] = []
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
