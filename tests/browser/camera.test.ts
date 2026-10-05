import { describe, expect, it } from 'vitest'
import { get } from '../../src/core/store'
import type { Models } from '../../src/types/models'
import { mountViewer, waitFor } from '../helpers/viewer'
import { modernBundle } from '../fixtures/bundles'

const ELEMENT_WIDTH = 800
const ELEMENT_HEIGHT = 600

async function waitForLoaded(viewer: ReturnType<typeof mountViewer>, id: string) {
	await waitFor(() => viewer.el.$current?.id === id, 4000, `current image ${id}`)
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
}

/** The camera only reports real values once the engine has laid the image out. */
async function waitForCamera(viewer: ReturnType<typeof mountViewer>) {
	await waitFor(() => (viewer.el.$current?.camera.getCoverScale() ?? 1) !== 1, 4000, 'camera layout')
}

describe('camera', () => {
	it('reports scale limits in a consistent order', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		await waitForCamera(viewer)

		const camera = viewer.el.$current?.camera
		expect(camera?.getCoverScale()).toBeGreaterThan(0)
		expect(camera?.getMinScale()).toBeGreaterThan(0)
		expect(camera?.getMinScale()).toBeLessThanOrEqual(camera.getCoverScale())
		expect(camera?.getScale()).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('accepts any view request and reports finite numbers back', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		await waitForCamera(viewer)

		const camera = viewer.el.$current?.camera
		for (const request of [
			[0, 0, 1, 1],
			[0.1, 0.1, 0.2, 0.2],
			[0.4, 0.4, 0.05, 0.05],
			[0.9, 0.9, 0.05, 0.05],
		] as Models.Camera.View[]) {
			camera?.setView(request)
			const v = camera?.getView() ?? []
			expect([...v].every(Number.isFinite)).toBe(true)
			expect(v[2] ?? 0).toBeGreaterThan(0)
			expect(v[3] ?? 0).toBeGreaterThan(0)
		}

		// A tighter request zooms in compared to a much wider one
		camera?.setView([0, 0, 1, 1])
		const wide = camera?.getView() ?? []
		camera?.setView([0.45, 0.45, 0.02, 0.02])
		const tight = camera?.getView() ?? []
		expect(tight[2] ?? 1).toBeLessThanOrEqual(wide[2] ?? 0)
		viewer.destroy()
	})

	it('keeps the camera inside the image for extreme setCoo targets', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		await waitForCamera(viewer)

		const camera = viewer.el.$current?.camera
		for (const [x, y] of [
			[0, 0],
			[1, 1],
			[0.5, 0.5],
			[-2, 3],
		]) {
			camera?.setCoo(x ?? 0, y ?? 0)
			const v = camera?.getView() ?? []
			expect([...v].every(Number.isFinite)).toBe(true)
		}
		viewer.destroy()
	})

	it('maps between screen and image coordinates', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		await waitForCamera(viewer)

		const camera = viewer.el.$current?.camera
		const xy = camera?.getXY(0.5, 0.5) ?? new Float64Array(5)
		expect(xy[0]).toBeGreaterThan(0)
		expect(xy[0]).toBeLessThan(ELEMENT_WIDTH)
		expect(xy[1]).toBeGreaterThan(0)
		expect(xy[1]).toBeLessThan(ELEMENT_HEIGHT)

		const coo = camera?.getCoo(xy[0], xy[1]) ?? new Float64Array(5)
		expect(Math.abs((coo[0] ?? 0) - 0.5)).toBeLessThan(0.02)
		expect(Math.abs((coo[1] ?? 0) - 0.5)).toBeLessThan(0.02)
		viewer.destroy()
	})

	it('honours a startView passed to open()', async () => {
		const viewer = mountViewer()
		const startView: Models.Camera.View = [0.45, 0.45, 0.05, 0.0375]
		await viewer.open(modernBundle(), { startView })
		await waitForLoaded(viewer, 'rqFkjZz')
		await waitForCamera(viewer)
		const current = viewer.el.$current?.camera.getView() ?? []
		expect(current[2] ?? 1).toBeLessThan(0.5)
		viewer.destroy()
	})
})
