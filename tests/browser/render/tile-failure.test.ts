import { describe, expect, it } from 'vitest'
import { mountViewer, waitFor } from '../../helpers/viewer'
import { bundleWithFreshId } from '../../fixtures/bundles'
import { FakeTextureWorker } from '../textures'

/**
 * A tile that fails to download must leave the engine in a terminal state, not in a
 * permanent frame loop. `_progress` is only 1 when every queued tile has been counted,
 * so a tile stuck at `_loadState === 1` used to keep `_draw` re-queueing itself forever.
 *
 * One viewer for the whole file: it is the only test here, and a second GL context would
 * only compete for Chromium's budget. The fake worker fails a single non-base request so
 * the console stays quiet and the rest of the image still loads.
 */
describe('Engine tile failures', () => {
	it('stops rendering after a tile fails', async () => {
		FakeTextureWorker.requestCount = 0
		FakeTextureWorker.failRequestAt = 1
		const viewer = mountViewer()
		try {
			const bundle = bundleWithFreshId()
			await viewer.open(bundle)
			await waitFor(() => viewer.el.$current?.id === bundle.id, 6000, 'current image')
			await waitFor(() => viewer.el._engine._progress === 1, 6000, 'tile progress to complete')

			let draws = 0
			viewer.el.addEventListener('draw', () => {
				draws++
			})
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 250)
			})
			const settled = draws
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 300)
			})
			expect(draws - settled).toBeLessThan(5)
		} finally {
			FakeTextureWorker.failRequestAt = -1
			viewer.destroy()
		}
	})
})
