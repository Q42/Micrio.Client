import { describe, expect, it, vi } from 'vitest'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers } from '../../fixtures/markers'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * Clustering is a second pass in the layer: `updateOverlapped` measures markers in screen
 * space, groups any pair closer than `_markers.clusterMarkerRadius` (default 24 px), marks
 * every member `overlapped` and prints one synthetic `<micrio-marker class="cluster">` per
 * group whose `data-marker-id` is the joined member *indices* (`"0,1"`).
 *
 * The synthetic marker carries the member count in the legacy top-level `title`, which the
 * current element never reads — see the pinned gap below.
 */

/** The cluster elements in the layer. */
const clustersOf = (opened: Awaited<ReturnType<typeof openMarkers>>) => [
	...opened.viewer.el.querySelectorAll<HTMLElement>('micrio-marker.cluster'),
]

/** Two markers at the same spot, which always overlaps. */
const overlapping = () =>
	markerBundle({
		markers: [marker('m1', { x: 0.5, y: 0.5 }), marker('m2', { x: 0.5, y: 0.5 })],
		settings: { clusterMarkers: true },
	})

describe('marker clustering', () => {
	it('clusters overlapping markers and flags their elements', async () => {
		const opened = await openMarkers(overlapping())
		await waitFor(() => clustersOf(opened).length === 1, 6000, 'the cluster marker')

		expect(opened.markerEl('m1')?.classList.contains('overlapped')).toBe(true)
		expect(opened.markerEl('m2')?.classList.contains('overlapped')).toBe(true)
		expect(clustersOf(opened)[0]?.dataset.markerId).toBe('0,1')
		opened.viewer.destroy()
	})

	it('KNOWN GAP: the cluster prints no visible member count', async () => {
		// `markers.ts` sets the count on the legacy top-level `title`; `marker.ts` only
		// reads `i18n`, so the synthetic marker renders as an empty dot.
		const opened = await openMarkers(overlapping())
		await waitFor(() => clustersOf(opened).length === 1, 6000, 'the cluster marker')
		const cluster = clustersOf(opened)[0]

		expect(cluster?.querySelector('label')).toBeNull()
		// A cluster gets no tooltip either, so the count has no surface at all
		expect(cluster?.querySelector('button')?.getAttribute('title')).toBeNull()
		opened.viewer.destroy()
	})

	it('only clusters markers within the configured radius', async () => {
		// Far apart in screen space, but a huge radius still groups them
		const wide = await openMarkers(
			markerBundle({
				markers: [marker('m1', { x: 0.1, y: 0.1 }), marker('m2', { x: 0.9, y: 0.9 })],
				settings: { clusterMarkers: true, clusterMarkerRadius: 10_000 },
			}),
		)
		await waitFor(() => clustersOf(wide).length === 1, 6000, 'the wide cluster')
		wide.viewer.destroy()

		// Close together, but the default radius ignores them because a radius of 0
		// turns every pair off
		const narrow = await openMarkers(
			markerBundle({
				markers: [marker('m1', { x: 0.5, y: 0.5 }), marker('m2', { x: 0.5, y: 0.5 })],
				settings: { clusterMarkers: true, clusterMarkerRadius: 0 },
			}),
		)
		await settle(2)
		expect(clustersOf(narrow)).toHaveLength(0)
		expect(narrow.markerEl('m1')?.classList.contains('overlapped')).toBe(false)
		narrow.viewer.destroy()
	})

	it('does nothing without the cluster setting', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { x: 0.5, y: 0.5 }), marker('m2', { x: 0.5, y: 0.5 })],
			}),
		)
		await settle(2)
		expect(clustersOf(opened)).toHaveLength(0)
		expect(opened.markerEl('m1')?.classList.contains('overlapped')).toBe(false)
		opened.viewer.destroy()
	})

	it('KNOWN GAP: the no-cluster tag is only checked on the later pair member', async () => {
		// The pair loop skips on `markers[j]`, so the tag has no effect when it sits on
		// the lower index. When the check becomes symmetric, this test changes.
		const taggedFirst = await openMarkers(
			markerBundle({
				markers: [marker('m1', { x: 0.5, y: 0.5, tags: ['no-cluster'] }), marker('m2', { x: 0.5, y: 0.5 })],
				settings: { clusterMarkers: true },
			}),
		)
		await settle(2)
		expect(clustersOf(taggedFirst)).toHaveLength(1)
		taggedFirst.viewer.destroy()

		const taggedSecond = await openMarkers(
			markerBundle({
				markers: [marker('m1', { x: 0.5, y: 0.5 }), marker('m2', { x: 0.5, y: 0.5, tags: ['no-cluster'] })],
				settings: { clusterMarkers: true },
			}),
		)
		await settle(2)
		expect(clustersOf(taggedSecond)).toHaveLength(0)
		taggedSecond.viewer.destroy()
	})

	it('removes the cluster when a member disappears', async () => {
		const opened = await openMarkers(overlapping())
		await waitFor(() => clustersOf(opened).length === 1, 6000, 'the cluster marker')

		const data = opened.image().$data
		opened.image().data.set({ ...data, markers: data?.markers?.slice(0, 1) ?? [] })
		await waitFor(() => clustersOf(opened).length === 0, 6000, 'the cluster removed')

		expect(opened.markerEl('m1')?.classList.contains('overlapped')).toBe(false)
		expect(opened.markerEl('m2')).toBeNull()
		opened.viewer.destroy()
	})

	it('flies to the group view when the cluster is clicked', async () => {
		const opened = await openMarkers(overlapping())
		await waitFor(() => clustersOf(opened).length === 1, 6000, 'the cluster marker')
		const spy = vi.spyOn(opened.image().camera, 'flyToView').mockImplementation(() => Promise.resolve())

		clustersOf(opened)[0]?.querySelector<HTMLButtonElement>('button')?.click()
		await settle(2)

		expect(spy).toHaveBeenCalledTimes(1)
		const [view, opts] = spy.mock.calls[0] ?? []
		expect(view).toHaveLength(4)
		// The view is centred on the group and at least 0.1 wide
		expect(view?.[0]).toBeCloseTo(0.45, 5)
		expect(view?.[1]).toBeCloseTo(0.45, 5)
		expect(view?.[2]).toBeCloseTo(0.1, 5)
		expect(opts).toEqual({ limitZoom: true })
		// A cluster does not open a marker popup
		expect(opened.image().state.$marker).toBeUndefined()
		spy.mockRestore()
		opened.viewer.destroy()
	})
})
