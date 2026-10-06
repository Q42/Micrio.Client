import { describe, expect, it } from 'vitest'
import { mountViewer } from '../helpers/viewer'
import { modernBundle } from '../fixtures/bundles'

describe('browser suite plumbing', () => {
	it('is a real browser with WebGL2', () => {
		const canvas = document.createElement('canvas')
		expect(canvas.getContext('webgl2')).not.toBeNull()
	})

	it('has the <micr-io> element registered by the production entry', () => {
		expect(customElements.get('micr-io')).toBeDefined()
	})

	it('opens an image from a bundle object', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		expect(viewer.el.$current?.id).toBe('rqFkjZz')
		expect(viewer.el.$current?.$info.width).toBe(512)
		viewer.destroy()
	})

	it.skipIf(__MICRIO_LIVE__)('denies un-mocked network access by default', async () => {
		// setup.ts installs the 404 patch in beforeEach; the live suite opts out.
		const response = await fetch('https://example.test/definitely-not-mocked')
		expect(response.status).toBe(404)
	})
})
