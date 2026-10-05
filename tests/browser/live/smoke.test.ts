import { describe, expect, it } from 'vitest'
import { get } from '../../../src/core/store'
import { mountViewer, waitFor } from '../../helpers/viewer'

const live = __MICRIO_LIVE__

describe('live CDN smoke', () => {
	it('loads and renders a modern (v5+) image', async () => {
		if (!live) {
			return
		}
		const viewer = mountViewer()
		await viewer.open('rqFkjZz')
		await waitFor(() => viewer.el.$current?.id === 'rqFkjZz', 15000, 'image to open')
		await waitFor(() => get(viewer.el._loading) === false, 20000, 'tiles to load')
		expect(viewer.el.$current?.$info.width).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('loads a legacy (v3.2) image with its markers', async () => {
		if (!live) {
			return
		}
		const viewer = mountViewer()
		await viewer.open('dzzLm')
		await waitFor(() => viewer.el.$current?.id === 'dzzLm', 15000, 'image to open')
		await waitFor(() => (viewer.el.$current?.$data?.markers?.length ?? 0) > 0, 20000, 'markers')
		expect(viewer.el.$current?.$data?.markers?.length).toBeGreaterThan(0)
		viewer.destroy()
	})
})
