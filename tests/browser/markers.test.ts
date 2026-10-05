import { describe, expect, it } from 'vitest'
import { get } from '../../src/core/store'
import { mountViewer, waitFor } from '../helpers/viewer'
import { modernBundle } from '../fixtures/bundles'

async function openWithMarkers() {
	const viewer = mountViewer()
	await viewer.open(modernBundle())
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	// Markers are placed a frame after the image reports loaded
	await waitFor(() => viewer.el.querySelectorAll('micrio-marker').length > 0, 4000, 'marker elements')
	return viewer
}

describe('markers', () => {
	it('renders one element per marker in the bundle data', async () => {
		const viewer = await openWithMarkers()
		expect(viewer.el.querySelectorAll('micrio-marker')).toHaveLength(2)
		expect(viewer.el.$current?.$data?.markers).toHaveLength(2)
		viewer.destroy()
	})

	it('opens a marker through the image state and reports it globally', async () => {
		const viewer = await openWithMarkers()
		const seen: string[] = []
		for (const type of ['marker-open', 'marker-opened', 'marker-closed']) {
			viewer.el.addEventListener(type, () => seen.push(type))
		}

		const first = viewer.el.$current?.$data?.markers?.[0]
		viewer.el.$current?.state.marker.set(first?.id ?? '')
		await waitFor(() => (viewer.el.state.$marker?.id ?? '') === (first?.id ?? ''), 4000, 'marker state')

		expect(viewer.el.$current?.state.$marker?.id).toBe(first?.id)
		expect(viewer.el.state.$marker?.i18n?.en?.title).toBeDefined()
		expect(seen).toContain('marker-open')
		viewer.destroy()
	})

	it('clears the marker state when the marker is closed', async () => {
		const viewer = await openWithMarkers()
		const first = viewer.el.$current?.$data?.markers?.[0]
		const image = viewer.el.$current
		image?.state.marker.set(first?.id ?? '')
		await waitFor(() => viewer.el.$current?.state.$marker !== undefined, 4000, 'marker open')

		image?.state.marker.set(undefined)
		await waitFor(() => viewer.el.$current?.state.$marker === undefined, 4000, 'marker closed')
		expect(viewer.el.state.$marker).toBeUndefined()
		viewer.destroy()
	})

	it('keeps marker identity stable across a re-render', async () => {
		const viewer = await openWithMarkers()
		const before = viewer.el.querySelectorAll('micrio-marker').length
		// Force a resize, which makes the marker layer lay out again
		viewer.el.style.width = '400px'
		globalThis.dispatchEvent(new Event('resize'))
		await waitFor(() => true, 200, 'settle')
		expect(viewer.el.querySelectorAll('micrio-marker').length).toBe(before)
		viewer.destroy()
	})

	it('exposes the marker tour data for a later tour session', async () => {
		const viewer = await openWithMarkers()
		const tours = viewer.el.$current?.$data?.markerTours ?? []
		expect(tours).toHaveLength(1)
		expect(tours[0]?.steps).toEqual(['m1', 'm2'])
		expect(tours[0]?.stepInfo?.map((s) => s.markerId)).toEqual(['m1', 'm2'])
		expect(tours[0]?.duration).toBe(8)
		viewer.destroy()
	})

	it('exposes the video tour timeline for a later tour session', async () => {
		const viewer = await openWithMarkers()
		const tours = viewer.el.$current?.$data?.tours ?? []
		expect(tours).toHaveLength(1)
		const timeline = tours[0]?.i18n?.en?.timeline ?? []
		expect(timeline.map((v) => [v.start, v.end])).toEqual([
			[0, 4],
			[4, 10],
		])
		viewer.destroy()
	})
})
