import { afterEach, describe, expect, it } from 'vitest'
import { restoreArchiveXhr } from '../../fixtures/grid'
import {
	albumOf,
	awaitAlbum,
	destroyAlbums,
	galleryEl,
	mountAlbum,
	press,
	scrubberHandle,
	scrubberTicks,
	scrubberTrack,
} from '../../fixtures/albums'
import type { OpenAlbum } from '../../fixtures/albums'

/**
 * The scrubber bar: the DOM it prints, the pointer/touch drag that scrubs it,
 * and the hover label.
 *
 * The stylesheet imports are stubbed in this suite, so the gallery has no CSS
 * box at all unless the test gives it one — the scrubber measures itself through
 * `getBoundingClientRect`/`clientWidth` when a drag or a label starts.
 */

afterEach(() => {
	destroyAlbums()
	restoreArchiveXhr()
})

/** Opens a swipe album and gives the gallery a real box (the stylesheet is stubbed). */
async function openScrubber(count: number): Promise<OpenAlbum> {
	const mounted = mountAlbum({ count })
	const album = await awaitAlbum(mounted)
	const gallery = galleryEl(mounted.viewer.el)
	if (gallery) {
		gallery.style.display = 'block'
		gallery.style.width = '800px'
	}
	return album
}

/** The pixel at the centre of the scrubber tick for a page, as the drag mapping reads it. */
function xForPage(track: HTMLElement, page: number, total: number): number {
	const box = track.getBoundingClientRect()
	return box.left + 16 + (page / Math.max(1, total - 1)) * (box.width - 32)
}

describe('scrubber — the printed bar', () => {
	it('prints one tick per page, a slider handle and the page label', async () => {
		const { viewer, ids } = await openScrubber(4)
		const ticks = scrubberTicks(viewer.el)
		expect(ticks).toHaveLength(4)
		expect(ticks[0]?.dataset.active).toBe('')
		expect(ticks[1]?.dataset.active).toBeUndefined()

		const handle = scrubberHandle(viewer.el)
		expect(handle?.getAttribute('role')).toBe('slider')
		expect(handle?.getAttribute('aria-valuemin')).toBe('1')
		expect(handle?.getAttribute('aria-valuemax')).toBe('4')
		expect(handle?.getAttribute('aria-valuenow')).toBe('1')

		// The label span sits right after the handle and shows the 1-based page
		const label = viewer.el.querySelector<HTMLElement>('micrio-gallery ul > button + span')
		expect(label?.textContent).toBe('1')
		expect(albumOf(viewer.el)?.numPages).toBe(ids.length)
	})

	it('prints a single bar, even after navigating', async () => {
		const { viewer } = await openScrubber(4)
		albumOf(viewer.el)?.next()
		await new Promise((resolve) => {
			setTimeout(resolve, 50)
		})
		expect(viewer.el.querySelectorAll('micrio-gallery ul')).toHaveLength(1)
	})

	it('disables the ends and follows the page', async () => {
		const { viewer } = await openScrubber(4)
		const prev = viewer.el.querySelector<HTMLButtonElement>('micrio-gallery micrio-button.prev button')
		const next = viewer.el.querySelector<HTMLButtonElement>('micrio-gallery micrio-button.next button')
		expect(prev?.disabled).toBe(true)
		expect(next?.disabled).toBe(false)

		press('End')
		await new Promise((resolve) => {
			setTimeout(resolve, 50)
		})
		expect(prev?.disabled).toBe(false)
		expect(next?.disabled).toBe(true)
		expect(scrubberHandle(viewer.el)?.getAttribute('aria-valuenow')).toBe('4')
		expect(scrubberTicks(viewer.el)[3]?.dataset.active).toBe('')
		expect(viewer.el.querySelector('micrio-gallery ul > button + span')?.textContent).toBe('4')
	})

	it('marks the track fill as the page advances', async () => {
		const { viewer } = await openScrubber(5)
		const fill = viewer.el.querySelector<HTMLElement>('micrio-gallery ul > :first-child > span')
		expect(fill?.style.width).toBe('0%')

		press('End')
		await new Promise((resolve) => {
			setTimeout(resolve, 50)
		})
		expect(fill?.style.width).toBe('100%')
	})

	it('thins the ticks out and labels the total on a dense album', async () => {
		// Above 24 pages the bar switches to a step, drops ticks in between and
		// appends the total to the label
		const { viewer } = await openScrubber(26)
		const track = scrubberTrack(viewer.el)
		expect(track?.classList.contains('dense')).toBe(true)

		// step 2: every even tick plus the last one
		expect(scrubberTicks(viewer.el)).toHaveLength(14)
		expect(viewer.el.querySelectorAll('micrio-gallery ul > :nth-child(2) > span[data-major]')).toHaveLength(3)
		expect(viewer.el.querySelector('micrio-gallery ul > button + span')?.textContent).toBe('1 / 26')
	})
})

describe('scrubber — pointer drag', () => {
	it('scrubs to the dragged page and clears the dragging state on release', async () => {
		const mounted = await openScrubber(4)
		const { viewer } = mounted
		const track = scrubberTrack(viewer.el)
		const album = albumOf(viewer.el)
		if (!track || !album) {
			throw new Error('no scrubber')
		}

		const x = xForPage(track, 3, 4)
		track.dispatchEvent(
			new PointerEvent('pointerdown', { pointerId: 7, clientX: x, clientY: 10, button: 0, bubbles: true }),
		)

		// The page is set synchronously; the slide animation follows
		expect(galleryEl(mounted.viewer.el)?.dataset.dragging).toBe('')
		expect(viewer.el._keepRendering).toBe(true)
		expect(scrubberHandle(viewer.el)?.classList.contains('dragging')).toBe(true)
		expect(album.currentIndex).toBe(3)

		globalThis.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: x, clientY: 10, bubbles: true }))
		expect(galleryEl(viewer.el)?.dataset.dragging).toBeUndefined()
		expect(viewer.el._keepRendering).toBe(false)
		// Releasing on the page the drag already reached does not run
		// `#frameChanged`, and `#scrubStop` does not update the bar itself — so
		// the handle's class only clears on the next scrubber update
		expect(scrubberHandle(viewer.el)?.classList.contains('dragging')).toBe(true)
		track.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: x, clientY: 10, bubbles: true }))
		expect(scrubberHandle(viewer.el)?.classList.contains('dragging')).toBe(false)
	})

	it('scrubs through intermediate pages while moving', async () => {
		const mounted = await openScrubber(5)
		const { viewer } = mounted
		const track = scrubberTrack(viewer.el)
		const album = albumOf(viewer.el)
		if (!track || !album) {
			throw new Error('no scrubber')
		}

		track.dispatchEvent(
			new PointerEvent('pointerdown', {
				pointerId: 8,
				clientX: xForPage(track, 1, 5),
				clientY: 10,
				button: 0,
				bubbles: true,
			}),
		)
		expect(album.currentIndex).toBe(1)

		globalThis.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 8,
				clientX: xForPage(track, 4, 5),
				clientY: 10,
				bubbles: true,
			}),
		)
		expect(album.currentIndex).toBe(4)

		globalThis.dispatchEvent(
			new PointerEvent('pointerup', { pointerId: 8, clientX: xForPage(track, 4, 5), clientY: 10, bubbles: true }),
		)
		expect(galleryEl(viewer.el)?.dataset.dragging).toBeUndefined()
	})

	it('ignores a non-primary button', async () => {
		const mounted = await openScrubber(4)
		const track = scrubberTrack(mounted.viewer.el)
		if (!track) {
			throw new Error('no scrubber')
		}
		track.dispatchEvent(
			new PointerEvent('pointerdown', { pointerId: 9, clientX: xForPage(track, 3, 4), button: 2, bubbles: true }),
		)
		expect(galleryEl(mounted.viewer.el)?.dataset.dragging).toBeUndefined()
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(0)
	})
})

describe('scrubber — hover', () => {
	it('shows the page label under the cursor and removes it on leave', async () => {
		const mounted = await openScrubber(4)
		const { viewer } = mounted
		const track = scrubberTrack(viewer.el)
		if (!track) {
			throw new Error('no scrubber')
		}

		track.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 10,
				clientX: xForPage(track, 2, 4),
				clientY: 10,
				bubbles: true,
			}),
		)
		const label = viewer.el.querySelector<HTMLElement>('[data-part="hover-label"]')
		expect(label?.textContent).toBe('3')

		track.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 10, bubbles: true }))
		expect(viewer.el.querySelector('[data-part="hover-label"]')).toBeNull()
	})

	it('shows no hover label for the page that is already active', async () => {
		const mounted = await openScrubber(4)
		const track = scrubberTrack(mounted.viewer.el)
		if (!track) {
			throw new Error('no scrubber')
		}

		track.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 11,
				clientX: xForPage(track, 0, 4),
				clientY: 10,
				bubbles: true,
			}),
		)
		expect(mounted.viewer.el.querySelector('[data-part="hover-label"]')).toBeNull()
	})
})

describe('scrubber — touch drag', () => {
	it('scrubs with a touch sequence', async () => {
		const mounted = await openScrubber(4)
		const { viewer } = mounted
		const track = scrubberTrack(viewer.el)
		const album = albumOf(viewer.el)
		if (!track || !album) {
			throw new Error('no scrubber')
		}

		const x = xForPage(track, 2, 4)
		const touch = (clientX: number) => new Touch({ identifier: 1, target: track, clientX, clientY: 10 })
		track.dispatchEvent(
			new TouchEvent('touchstart', { touches: [touch(x)], targetTouches: [touch(x)], bubbles: true, cancelable: true }),
		)
		expect(galleryEl(viewer.el)?.dataset.dragging).toBe('')
		expect(album.currentIndex).toBe(2)

		globalThis.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }))
		expect(galleryEl(viewer.el)?.dataset.dragging).toBeUndefined()
	})
})
