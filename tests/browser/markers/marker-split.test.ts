import { describe, expect, it, vi } from 'vitest'
import { getSplitSecondary, hasSplit, isSplitSecondary, parseSplitLink } from '$core/split'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, type MarkerFixture } from '../../fixtures/markers'
import { mockJson } from '../../helpers/network'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * A marker whose `data.micrioSplitLink` is set (`"micrioId,markerId,follows"`) splits the
 * screen when it opens: the linked image becomes a passive-or-following secondary canvas.
 * The link lives on the marker, so switching or closing the marker is what tears the split
 * down again — `markers.ts`/`marker.ts` own that lifecycle.
 */

/** A split link string for a fixture's image and one of its markers. */
const link = (fixture: MarkerFixture, shortMarker: string, follows?: boolean) =>
	`${fixture.id},${fixture.mid(shortMarker)}${follows === undefined ? '' : `,${String(follows)}`}`

/** The secondary image of the open primary, once it exists. */
const secondaryOf = (opened: Awaited<ReturnType<typeof openMarkers>>) => getSplitSecondary(opened.image())

/** Serves one or more fixture bundles from the network, as `openSplit` resolves them by id. */
const serve = (...fixtures: MarkerFixture[]): void => {
	mockJson(/bundle\.json/, { images: fixtures.map((f) => f.bundle) })
}

describe('parseSplitLink', () => {
	it('parses the id, marker and follows flag', () => {
		expect(parseSplitLink('abc123')).toEqual({ micrioId: 'abc123', markerId: undefined, follows: false })
		expect(parseSplitLink('abc123,m1')).toEqual({ micrioId: 'abc123', markerId: 'm1', follows: false })
		expect(parseSplitLink(' abc123 , m1 , true ')).toEqual({ micrioId: 'abc123', markerId: 'm1', follows: true })
	})

	it('treats the literal false as no follow', () => {
		expect(parseSplitLink('abc123,m1,false')).toEqual({ micrioId: 'abc123', markerId: 'm1', follows: false })
	})

	it('rejects an empty link', () => {
		expect(parseSplitLink()).toBeUndefined()
		expect(parseSplitLink('')).toBeUndefined()
		expect(parseSplitLink(',,')).toBeUndefined()
	})
})

describe('marker split screen', () => {
	it('opens the linked image as a secondary canvas', async () => {
		const target = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [marker('m1', { data: { micrioSplitLink: link(target, 's1') } })],
		})
		serve(target)

		const opened = await openMarkers(main)
		const events: string[] = []
		opened.viewer.el.addEventListener('splitscreen-start', () => events.push('splitscreen-start'))

		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')

		expect(secondaryOf(opened)?.id).toBe(target.id)
		expect(events).toContain('splitscreen-start')
		opened.viewer.destroy()
	})

	it('closes the split when the marker closes', async () => {
		const target = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [marker('m1', { data: { micrioSplitLink: link(target, 's1') } })],
		})
		serve(target)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')

		const events: string[] = []
		opened.viewer.el.addEventListener('splitscreen-stop', () => events.push('splitscreen-stop'))
		await opened.closeMarker()
		await waitFor(() => !hasSplit(opened.image()), 6000, 'the split to close')

		expect(events).toContain('splitscreen-stop')
		opened.viewer.destroy()
	})

	it('closes the split when another marker without a link opens', async () => {
		const target = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [marker('m1', { data: { micrioSplitLink: link(target, 's1') } }), marker('m2')],
		})
		serve(target)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')

		await opened.openMarker('m2')
		await waitFor(() => !hasSplit(opened.image()), 6000, 'the split to close')
		opened.viewer.destroy()
	})

	it('keeps the split open and moves the secondary camera to the linked marker', async () => {
		// The first marker is `alwaysOpen`, so opening the second does not run its
		// close path and the existing split is reused (the same-target branch).
		const target = markerBundle({
			markers: [marker('s1'), marker('s2', { view: [0.25, 0.25, 0.5, 0.5] })],
		})
		const main = markerBundle({
			markers: [
				marker('m1', { data: { alwaysOpen: true, micrioSplitLink: link(target, 's1') } }),
				marker('m2', { data: { micrioSplitLink: link(target, 's2') } }),
			],
		})
		serve(target)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')

		const secondary = secondaryOf(opened)
		if (!secondary) {
			throw new Error('no secondary image')
		}
		const spy = vi.spyOn(secondary.camera, 'flyToView').mockImplementation(() => Promise.resolve())

		await opened.openMarker('m2')
		await settle(2)

		// The same target keeps the split; only the secondary camera moves
		expect(secondaryOf(opened)).toBe(secondary)
		expect(spy).toHaveBeenCalledWith([0.25, 0.25, 0.5, 0.5], { isJump: true })
		spy.mockRestore()
		opened.viewer.destroy()
	})

	it('replaces the split when the link points at another image', async () => {
		const first = markerBundle({ markers: [marker('s1')] })
		const second = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [
				marker('m1', { data: { micrioSplitLink: link(first, 's1') } }),
				marker('m2', { data: { micrioSplitLink: link(second, 's1') } }),
			],
		})
		serve(first, second)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => secondaryOf(opened)?.id === first.id, 6000, 'the first split')

		await opened.openMarker('m2')
		await waitFor(() => secondaryOf(opened)?.id === second.id, 8000, 'the replacement split')
		opened.viewer.destroy()
	})

	it('marks the secondary as following the primary camera when the link asks for it', async () => {
		const target = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [marker('m1', { data: { micrioSplitLink: link(target, 's1', true) } })],
		})
		serve(target)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')

		expect(secondaryOf(opened)?._isPassiveSecondary).toBe(true)
		opened.viewer.destroy()
	})

	it('leaves the secondary interactive without the follows flag', async () => {
		const target = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [marker('m1', { data: { micrioSplitLink: link(target, 's1', false) } })],
		})
		serve(target)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')

		expect(secondaryOf(opened)?._isPassiveSecondary).toBeUndefined()
		opened.viewer.destroy()
	})

	it('does nothing for an unparseable link', async () => {
		const main = markerBundle({ markers: [marker('m1', { data: { micrioSplitLink: ',,' } })] })
		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await settle(3)

		expect(getSplitSecondary(opened.image())).toBeUndefined()
		expect(isSplitSecondary(opened.image())).toBe(false)
		opened.viewer.destroy()
	})

	it('keeps the split when switching to another marker on the same image', async () => {
		// The state passes through the marker *id string* first; the close path resolves
		// it, so a switch between two markers linking to the same image keeps the split.
		const target = markerBundle({ markers: [marker('s1')] })
		const main = markerBundle({
			markers: [
				marker('m1', { data: { micrioSplitLink: link(target, 's1') } }),
				marker('m2', { data: { micrioSplitLink: link(target, 's1') } }),
			],
		})
		serve(target)

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => hasSplit(opened.image()), 6000, 'the split to open')
		const secondary = secondaryOf(opened)
		const canvases = opened.viewer.el._canvases.length

		await opened.openMarker('m2')
		await settle(2)
		expect(secondaryOf(opened)).toBe(secondary)
		expect(opened.viewer.el._canvases.length).toBe(canvases)
		opened.viewer.destroy()
	})
})
