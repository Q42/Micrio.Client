import { describe, expect, it, vi } from 'vitest'
import { get } from '../../src/core/store'
import { mountViewer, waitFor } from '../helpers/viewer'

/** Waits for the error UI to be printed (the error message renders a frame later). */
async function waitForError(viewer: ReturnType<typeof mountViewer>) {
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	await waitFor(() => viewer.el.querySelector('micrio-error') !== null, 4000, 'error element')
}

describe('<micr-io> error handling', () => {
	it('shows a user-facing message when a bundle cannot be loaded', async () => {
		const viewer = mountViewer()
		// The default offline stub answers everything with 404
		await viewer.open('missing1')
		await waitForError(viewer)

		const text = viewer.el.querySelector('micrio-error')?.textContent ?? ''
		expect(text).toContain('missing1')
		expect(text).toContain('not found')
		// The failure must not leave the viewer stuck in its loading state
		expect(get(viewer.el._loading)).toBe(false)
		viewer.destroy()
	})

	it('does not reject the open() promise on a missing bundle', async () => {
		const viewer = mountViewer()
		await expect(viewer.open('alsomissing')).resolves.toBeUndefined()
		viewer.destroy()
	})

	it('reports WebGL support through the element instead of throwing', async () => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
		const viewer = mountViewer()

		// Must not throw out of open(), and the error is rendered in the UI
		await viewer.open({
			id: 'aaaaaaa',
			info: { id: 'aaaaaaa', width: 10, height: 10, path: 'https://r2.micr.io/', version: '6.0.0' },
		})
		await waitFor(() => (viewer.el.textContent ?? '').includes('does not support WebGL'), 4000, 'webgl message')
		expect(viewer.el.textContent).toContain('does not support WebGL')
		viewer.destroy()
		vi.restoreAllMocks()
	})

	it('rejects a zero-size image instead of rendering garbage', async () => {
		const viewer = mountViewer()
		await expect(
			viewer.open({
				id: 'baddims1',
				info: { id: 'baddims1', width: 0, height: 0, path: 'https://r2.micr.io/', version: '6.0.0' },
				data: {},
			}),
		).rejects.toThrow('Invalid Micrio image size')
		viewer.destroy()
	})

	it('accepts a zero-size image that is explicitly imageless', async () => {
		const viewer = mountViewer()
		// `settings.omni` marks the image as imageless, so the size check is skipped
		await viewer.open({
			id: 'noimage1',
			info: { id: 'noimage1', width: 0, height: 0, path: 'https://r2.micr.io/', version: '6.0.0' },
			settings: {
				omni: { frames: 1, startIndex: 0, fieldOfView: 1, verticalAngle: 0, distance: 1, offsetX: 0 },
			},
			data: {},
		})
		expect(viewer.el.$current?.id).toBe('noimage1')
		viewer.destroy()
	})

	it('destroy() after a failed load still cleans up', async () => {
		const viewer = mountViewer()
		await viewer.open('missing2')
		await waitForError(viewer)
		expect(() => {
			viewer.destroy()
		}).not.toThrow()
		expect(document.body.querySelector('micr-io')).toBeNull()
	})
})
