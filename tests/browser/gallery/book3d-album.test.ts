import { afterEach, describe, expect, it } from 'vitest'
import { restoreArchiveXhr } from '../../fixtures/grid'
import { bookAlbum, bookMarkers, openBook, scrubberTicks } from '../../fixtures/book'
import { waitFor } from '../../helpers/viewer'

afterEach(() => {
	// `#print()` is fire-and-forget, so an album can still be resolving when the
	// test moves on; a stub removed per test would send it to the real network
	restoreArchiveXhr()
})

describe('book3d album — taking over the viewer', () => {
	it('builds a book gallery from the archive', async () => {
		const book = await openBook({ count: 4 })
		expect(book.viewer.el.gallery?._config.type).toBe('book3d')
		expect(book.viewer.el._engine._book3d).toBe(true)
		// The album's images come from the archive index, not the bundle's list
		expect(book.viewer.el.gallery?._images.map((i) => i.id)).toEqual(book.ids)
		book.viewer.destroy()
	})

	it('renders one scrubber tick per gallery page', async () => {
		const book = await openBook({ count: 4 })
		const ticks = scrubberTicks(book.viewer.el)
		expect(ticks).toHaveLength(book.viewer.el.$current?.album?.numPages ?? -1)
		book.viewer.destroy()
	})

	it('reports the gallery page count as cover-then-spreads', async () => {
		const book = await openBook({ count: 4 })
		expect(bookAlbum(book.viewer.el)?.numPages).toBe(3)
		expect(scrubberTicks(book.viewer.el)).toHaveLength(3)
		book.viewer.destroy()
	})

	it('hands the drawn page off to the marker layer', async () => {
		const book = await openBook({ count: 4 })
		await waitFor(() => book.viewer.el.$current?._placed === true, 5000, 'the book spread')
		// The fixture puts a marker on the first image only; it exists because the
		// book's `_onDraw` made that page visible, and it was positioned in pixels
		await waitFor(() => bookMarkers(book.viewer.el).length > 0, 5000, 'the page marker')
		const marker = bookMarkers(book.viewer.el)[0]
		expect(marker?.dataset.markerId).toBe('bm1')
		const style = (marker as HTMLElement).getAttribute('style') ?? ''
		expect(style).toMatch(/--x:\s*-?\d+(\.\d+)?px/)
		expect(style).toMatch(/--y:\s*-?\d+(\.\d+)?px/)
		book.viewer.destroy()
	})
})

describe('book3d album — navigation', () => {
	it('turns the page through the album API', async () => {
		const book = await openBook({ count: 4 })
		const shown: string[][] = []
		book.viewer.el.addEventListener('gallery-show', (e) => {
			if (e instanceof CustomEvent) {
				shown.push(e.detail as string[])
			}
		})
		const target = book.viewer.el.$current
		expect(bookAlbum(book.viewer.el)?.currentIndex).toBe(0)

		target?.album?.next()
		await waitFor(() => bookAlbum(book.viewer.el)?.currentIndex === 1, 5000, 'the next page')
		expect(bookAlbum(book.viewer.el)?.currentIndex).toBe(1)
		expect(shown.length).toBeGreaterThan(0)
		expect(shown.at(-1)?.length).toBeGreaterThan(0)

		target?.album?.prev()
		await waitFor(() => bookAlbum(book.viewer.el)?.currentIndex === 0, 5000, 'the previous page')
		book.viewer.destroy()
	})

	it('moves the marker as the spread changes', async () => {
		const book = await openBook({ count: 4 })
		await waitFor(() => bookMarkers(book.viewer.el).length > 0, 5000, 'the page marker')
		const before = bookMarkers(book.viewer.el)[0]?.getAttribute('style')

		book.viewer.el.$current?.album?.next()
		await waitFor(() => bookAlbum(book.viewer.el)?.currentIndex === 1, 5000, 'the next page')
		// The book repositions the marker every frame it draws the page
		await waitFor(() => bookMarkers(book.viewer.el)[0]?.getAttribute('style') !== before, 5000, 'the marker to move')
		book.viewer.destroy()
	})
})

describe('book3d album — album settings', () => {
	it('offers the rotate buttons when rotation is allowed', async () => {
		const book = await openBook({ count: 4 })
		expect(book.viewer.el.querySelector('micrio-button.rotateLeft')).not.toBeNull()
		expect(book.viewer.el.querySelector('micrio-button.rotateRight')).not.toBeNull()
		book.viewer.destroy()
	})

	it('hides the rotate buttons when the album disables rotation', async () => {
		const book = await openBook({ count: 4, settings: { allowRotation: false } })
		expect(book.viewer.el.querySelector('micrio-button.rotateLeft')).toBeNull()
		expect(book.viewer.el.querySelector('micrio-button.rotateRight')).toBeNull()
		book.viewer.destroy()
	})

	it('opens an odd image count as a cover plus spreads', async () => {
		// 3 images: the gallery makes [0], [1, 2]; the book makes 2 pages
		const book = await openBook({ count: 3 })
		expect(bookAlbum(book.viewer.el)?.numPages).toBe(2)
		expect(book.viewer.el.gallery?._images).toHaveLength(3)
		book.viewer.destroy()
	})
})
