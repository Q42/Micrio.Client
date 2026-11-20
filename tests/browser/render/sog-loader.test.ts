import { afterEach, describe, expect, it, vi } from 'vitest'

import { SogRenderer } from '$render/sog'
import { binaryResponse, installViewerFactory, makeSogScene, stubFetch } from './sog-harness'

/**
 * The fallback that keeps `data-prefer-sog` working on a page that did not include the
 * published PlayCanvas bundle itself.
 *
 * `getCreateMicrioSogViewer` caches its promise module-wide, so this lives in its own
 * file: the error path resets that cache, and the load path must run after it. Sharing
 * the file with the main SOG suite would make the order of those two cases load-bearing.
 */

const scriptInHead = (): HTMLScriptElement | null =>
	document.head.querySelector<HTMLScriptElement>('script[src*="micrio-pc-sog"]')

afterEach(() => {
	globalThis.createMicrioSogViewer = undefined
	scriptInHead()?.remove()
	vi.restoreAllMocks()
})

describe('SOG viewer bootstrap', () => {
	it('injects the published bundle and reports a failed load', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const renderer = new SogRenderer(scene.micrio)

		const started = renderer.start(scene.image)
		const script = scriptInHead()
		expect(script).not.toBeNull()
		expect(script?.src).toContain('micrio-pc-sog-0.1.1.min.js')

		script?.dispatchEvent(new Event('error'))
		await started

		expect(script?.isConnected).toBe(false)
		expect(error).toHaveBeenCalledWith(
			'[Micrio] Could not load the SOG viewer:',
			expect.stringContaining('micrio-pc-sog-0.1.1.min.js'),
		)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('SOG viewer is not available'))
	})

	it('uses the factory registered when the bundle loads', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => binaryResponse())
		const renderer = new SogRenderer(scene.micrio)

		const started = renderer.start(scene.image)
		const script = scriptInHead()
		if (!script) {
			throw new Error('no bootstrap script')
		}
		const { calls } = installViewerFactory()
		script.dispatchEvent(new Event('load'))
		await started

		expect(script.isConnected).toBe(false)
		expect(calls).toHaveLength(1)
		expect(calls[0]?.filename).toBe('abc123/l-1000.sog')
	})
})
