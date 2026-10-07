import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { MicrioImage } from '$core/image'
import { collectEvents, mountViewer, waitFor } from '../../helpers/viewer'
import { legacyBundle, modernBundle } from '../../fixtures/bundles'
import { mockJson, requested, restoreNetwork } from '../../helpers/network'

/**
 * The bundle cache in `$_utils/dataLoader` is module-level and keyed by id, so
 * each network-path test uses its own id to stay independent.
 */
let ids = 0
const freshBundle = () => {
	const b = modernBundle()
	const id = `test${String(++ids).padStart(3, '0')}`
	return { ...b, id, info: { ...b.info, id } }
}

/** Waits until the viewer reports a current image and has stopped loading. */
async function waitForLoaded(viewer: ReturnType<typeof mountViewer>, id: string) {
	await waitFor(() => viewer.el.$current?.id === id, 4000, `current image ${id}`)
	await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish')
}

describe('<micr-io> open()', () => {
	it('opens a bundle object without any network access', async () => {
		// Any fetch at all would 500 here, so a pass proves the object path is offline
		mockJson(/.*/, { error: 'no network expected' }, 500)
		const viewer = mountViewer()

		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')

		expect(viewer.el.$current?.$info.title).toBe('Modern image')
		expect(viewer.el.$current?.$data?.markers).toHaveLength(2)
		expect(requested).toEqual([])
		viewer.destroy()
	})

	it('actually renders: tiles decode, frames draw and loading reports complete', async () => {
		const viewer = mountViewer()
		let draws = 0
		viewer.el.addEventListener('draw', () => {
			draws++
		})

		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		await waitFor(() => draws > 0, 4000, 'a frame to be drawn')

		// The fake texture worker resolves every requested tile to a real image, so
		// the engine has tiles on screen and reports progress without any network.
		// Progress is recomputed per frame and can read 0 while tiles are still in
		// flight, so wait for it rather than asserting the first sample.
		expect(viewer.el._engine._numTiles).toBeGreaterThan(0)
		await waitFor(() => viewer.el._engine._progress > 0, 4000, 'render progress')
		expect(draws).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('dispatches print, pre-info and load in order', async () => {
		const viewer = mountViewer()
		const events = collectEvents(viewer.el, ['print', 'pre-info', 'load', 'show'])
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		events.stop()

		expect(events.types.slice(0, 3)).toEqual(['print', 'pre-info', 'load'])
		expect(events.types).toContain('show')
		viewer.destroy()
	})

	it('exposes the opened image through the current store and $current', async () => {
		const viewer = mountViewer()
		const seen: (MicrioImage | undefined)[] = []
		const unsub = viewer.el.current.subscribe((img) => seen.push(img))
		await viewer.open(modernBundle())
		unsub()
		expect(seen.at(-1)).toBe(viewer.el.$current)
		expect(seen[0]).toBeUndefined()
		viewer.destroy()
	})

	it('survives being disconnected and reconnected', async () => {
		// Reconnecting re-runs `_onMount` while `_loading` is already false; the load
		// subscription used to reference its own (not yet assigned) unsubscriber and throw.
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')

		delete viewer.el.dataset.loaded
		viewer.el.remove()
		expect(() => {
			document.body.append(viewer.el)
		}).not.toThrow()

		// The mount ran again and re-marked the loaded state, with the image intact
		expect(viewer.el.dataset.loaded).toBe('')
		expect(viewer.el.$current?.id).toBe('rqFkjZz')
		viewer.destroy()
	})

	it('re-opens the same image without a second fetch', async () => {
		const bundle = freshBundle()
		mockJson(/bundle\.json/, { images: [bundle] })
		const viewer = mountViewer()

		await viewer.open(bundle.id)
		await waitForLoaded(viewer, bundle.id)
		const first = viewer.el.$current
		const fetchesAfterFirst = requested.length

		await viewer.open(bundle.id)
		await waitForLoaded(viewer, bundle.id)
		expect(viewer.el.$current).toBe(first)
		expect(requested.length).toBe(fetchesAfterFirst)
		viewer.destroy()
	})

	it('fetches bundle.json from the viewer API with the client version query', async () => {
		const bundle = freshBundle()
		mockJson(/bundle\.json/, { images: [bundle] })
		const viewer = mountViewer()

		await viewer.open(bundle.id)
		await waitForLoaded(viewer, bundle.id)

		expect(requested).toHaveLength(1)
		expect(requested[0]).toMatch(
			new RegExp(`^https://viewer\\.micr\\.io/${bundle.id}/bundle\\.json\\?v=\\d+\\.\\d+\\.\\d+$`),
		)
		viewer.destroy()
	})

	it('keeps independent images per element', async () => {
		const a = mountViewer()
		const b = mountViewer()
		await a.open(modernBundle())
		await b.open(legacyBundle())
		await waitForLoaded(a, 'rqFkjZz')
		await waitForLoaded(b, 'dzzLm')
		expect(a.el.$current?.id).toBe('rqFkjZz')
		expect(b.el.$current?.id).toBe('dzzLm')
		a.destroy()
		b.destroy()
	})

	it('destroy() tears the viewer down without leaving frames scheduled', async () => {
		const viewer = mountViewer()
		await viewer.open(modernBundle())
		await waitForLoaded(viewer, 'rqFkjZz')
		expect(() => {
			viewer.destroy()
		}).not.toThrow()
		expect(document.body.querySelector('micr-io')).toBeNull()
		restoreNetwork()
	})
})

describe('<micr-io> close()', () => {
	it('releases the canvas and lets the same image be opened again', async () => {
		const bundle = freshBundle()
		const viewer = mountViewer()
		await viewer.open(bundle)
		await waitForLoaded(viewer, bundle.id)

		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		const engine = viewer.el._engine
		await waitFor(() => engine._getCanvas(image) !== undefined, 4000, 'the placed canvas')

		viewer.el.close(image)
		expect(image._placed).toBe(false)
		expect(engine._getCanvas(image)).toBeUndefined()

		// The image stays in the element's list, so opening it again re-places its canvas
		// rather than leaving the viewer blank.
		await viewer.open(bundle)
		await waitFor(() => engine._getCanvas(image) !== undefined, 4000, 'the re-placed canvas')
		expect(image._placed).toBe(true)
		viewer.destroy()
	})

	it('is a no-op for an image that was never placed', async () => {
		const viewer = mountViewer()
		await viewer.open(freshBundle())

		// A fresh instance of the same class, as `canvas.test.ts` builds one for the
		// engine's own "not placed yet" case
		const image = viewer.el.$current as MicrioImage
		const unplaced = Object.create(Object.getPrototypeOf(image)) as MicrioImage
		unplaced._placed = false

		expect(() => {
			viewer.el.close(unplaced)
		}).not.toThrow()
		viewer.destroy()
	})
})
