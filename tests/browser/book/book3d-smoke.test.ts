import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { mountViewer, waitFor } from '../../helpers/viewer'
import { modernBundle } from '../../fixtures/bundles'
import { mockJson } from '../../helpers/network'

/**
 * Deliberately minimal coverage of the 3D book viewer, per the agreed session
 * scope: the module must load, and a book3d album must not break the viewer.
 * Geometry, physics, lighting and page flipping are a later session's job.
 */
describe('book3d (smoke only)', () => {
	it('imports and exposes the BookViewer without throwing', async () => {
		const book = await import('$book/main')
		expect(book.BookViewer).toBeTypeOf('function')
	})

	it('opens a book3d album bundle without breaking the element', async () => {
		const bundle = modernBundle()
		bundle.id = 'book001'
		bundle.info.id = 'book001'
		bundle.info.albumId = 'album-book'
		mockJson(/bundle\.json/, {
			images: [bundle],
			album: { id: 'album-book', type: 'book3d', settings: {} },
		})

		const viewer = mountViewer()
		await viewer.open('book001')
		await waitFor(() => !get(viewer.el._loading), 6000, 'loading to finish')

		// The element survives and still reports a current image with its data
		expect(viewer.el.$current?.id).toBe('book001')
		expect(viewer.el.$current?.$data?.markers).toHaveLength(2)
		expect(viewer.el.querySelector('canvas')).not.toBeNull()
		viewer.destroy()
	})
})
