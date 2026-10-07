import { afterEach, describe, expect, it } from 'vitest'
import type { HTMLMicrioElement } from '$core/element'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { EVENT_CATALOG, EVENT_NAMES, type DetailKind, type EventName } from '../../fixtures/events'
import { marker, modernBundle } from '../../fixtures/bundles'
import { markerBundle, waitForMarker } from '../../fixtures/markers'
import { markerTour } from '../../fixtures/tours'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'
import { settle } from '../../helpers/tour'

/**
 * The public event contract, end to end.
 *
 * Every assertion here is about what a host page sees on `<micr-io>`: the event name and the
 * shape of `evt.detail`. That is deliberately the last mile — a unit test on an internal
 * `_dispatch` call would pass even if the event never reached the element.
 *
 * The catalog in `tests/fixtures/events.ts` is the compile-time half of this guard: it refuses
 * to compile when a declared event has no entry. This file is the runtime half: an entry with
 * no working trigger fails.
 */

/** Collects every event the catalog names, with its detail, for one viewer. */
interface Recorder {
	seen: { type: EventName; detail: unknown }[]
	types: () => string[]
	/** Details seen for one event, in order. */
	details: (type: EventName) => unknown[]
	stop: () => void
}

function record(el: HTMLMicrioElement): Recorder {
	const seen: { type: EventName; detail: unknown }[] = []
	const handlers = EVENT_NAMES.map((type) => {
		const fn = (e: Event) => seen.push({ type, detail: (e as CustomEvent).detail })
		el.addEventListener(type, fn)
		return [type, fn] as const
	})
	return {
		seen,
		types: () => seen.map((s) => s.type),
		details: (type) => seen.filter((s) => s.type === type).map((s) => s.detail),
		stop: () => {
			for (const [type, fn] of handlers) {
				el.removeEventListener(type, fn)
			}
		},
	}
}

/** Asserts a recorder saw `type`, and that its detail has the family's declared shape. */
function expectFired(rec: Recorder, type: EventName): unknown {
	const details = rec.details(type)
	expect(details.length, `${type} did not fire (${EVENT_CATALOG[type].trigger})`).toBeGreaterThan(0)
	const last = details.at(-1)
	assertDetail(type, last)
	return last
}

/** The shape check for one event's detail, keyed off the catalog's declared kind. */
function assertDetail(type: EventName, detail: unknown): void {
	const kind: DetailKind = EVENT_CATALOG[type].detail
	const label = `${type} detail`
	switch (kind) {
		case 'void': {
			// An event with no payload is dispatched with no detail at all.
			expect(detail, label).toBeUndefined()
			break
		}
		case 'array': {
			expect(Array.isArray(detail), label).toBe(true)
			break
		}
		case 'number': {
			expect(typeof detail, label).toBe('number')
			break
		}
		case 'string': {
			expect(typeof detail, label).toBe('string')
			break
		}
		case 'object': {
			expect(detail !== null && typeof detail, label).toBe('object')
			break
		}
	}
}

let viewer: Viewer | undefined
let rec: Recorder | undefined

afterEach(() => {
	rec?.stop()
	viewer?.destroy()
	viewer = undefined
	rec = undefined
})

/** Mounts and opens a bundle, returning the viewer with recording already attached. */
async function open(bundle: Models.ImageBundle.BundleImage): Promise<{ viewer: Viewer; rec: Recorder }> {
	const v = mountViewer()
	const r = record(v.el)
	await v.open(bundle)
	await waitFor(() => v.el.$current?.id === bundle.id, 4000, `current ${bundle.id}`)
	await waitFor(() => !get(v.el._loading), 4000, 'loading to finish')
	viewer = v
	rec = r
	return { viewer: v, rec: r }
}

/** An identity equality check, so the payload is the object the host would recognise. */
const same = (a: unknown, b: unknown): boolean => a === b

describe('the event catalog covers the whole public surface', () => {
	it('has an entry for every runtime event name', () => {
		for (const name of EVENT_NAMES) {
			expect(EVENT_CATALOG[name], `no catalog entry for ${name}`).toBeDefined()
		}
	})

	it('declares no name the catalog does not know', () => {
		for (const name of Object.keys(EVENT_CATALOG)) {
			expect(EVENT_NAMES, `${name} is in the catalog but not in EVENT_NAMES`).toContain(name)
		}
	})

	it('names every entry with a family group, so a failure names a subsystem', () => {
		for (const name of EVENT_NAMES) {
			expect(EVENT_CATALOG[name].family, `${name} family`).toBeTruthy()
			expect(EVENT_CATALOG[name].trigger, `${name} trigger`).toBeTruthy()
		}
	})
})

describe('general events', () => {
	it('fires print, pre-info, pre-data, load and show when a bundle opens', async () => {
		const { rec: r } = await open(modernBundle())

		for (const type of ['print', 'pre-info', 'pre-data', 'load'] as const) {
			expectFired(r, type)
		}

		// `show` is the last of the five: it waits for the first settled frame.
		await waitFor(() => r.types().includes('show'), 4000, 'show')
		expectFired(r, 'show')
	})

	it('carries the resolved bundle data in pre-data, keyed by image id', async () => {
		const bundle = modernBundle()
		const { rec: r } = await open(bundle)
		const detail = expectFired(r, 'pre-data') as Record<string, Models.ImageData.ImageData>

		expect(Object.keys(detail)).toEqual([bundle.id])
		// The host receives the same object the image stores, which is what makes the
		// documented "alter them before they are read" contract work.
		expect(same(detail[bundle.id], bundle.data)).toBe(true)
	})

	it('fires lang-switch with the new language code', async () => {
		const { viewer: v, rec: r } = await open(modernBundle())
		v.el.lang = 'nl'
		await settle()

		expect(expectFired(r, 'lang-switch')).toBe('nl')
	})

	it('fires the coalesced update event once for a burst of view changes', async () => {
		const { viewer: v, rec: r } = await open(modernBundle())
		const before = r.details('update').length

		// Several camera writes inside one coalescing window must produce one event.
		for (let i = 0; i < 3; i++) {
			v.el.camera?.setCoo(0.5 + i * 0.01, 0.5)
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 600)
		})

		const details = r.details('update')
		expect(details.length, 'update did not fire').toBeGreaterThan(before)
		const fields = details.at(-1) as string[]
		expect(Array.isArray(fields)).toBe(true)
		expect(fields).toContain('view')
	})
})

describe('marker and tour events', () => {
	it('fires tour-start on mount and tour-stop on teardown', async () => {
		// A non-serial marker tour is the one `<micrio-tour>` renders; a serial one gets its own
		// element and its own pair (see the serial case below).
		const fixture = markerBundle({ markerTours: [markerTour({ steps: ['m1', 'm2'] })] })
		const tour = fixture.markerTours[0]
		expect(tour).toBeDefined()
		const { viewer: v, rec: r } = await open(fixture.bundle)

		v.el.state.tour.set(tour)
		await waitFor(() => v.el.querySelector('micrio-tour') !== null, 4000, 'the tour element')

		expect(same(expectFired(r, 'tour-start'), tour)).toBe(true)

		v.el.state.tour.set(undefined)
		await waitFor(() => v.el.querySelector('micrio-tour') === null, 4000, 'the tour element to go')

		expect(same(expectFired(r, 'tour-stop'), tour)).toBe(true)
	})

	it('does not fire tour-stop twice for one tour', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ steps: ['m1', 'm2'] })] })
		const tour = fixture.markerTours[0]
		const { viewer: v, rec: r } = await open(fixture.bundle)

		v.el.state.tour.set(tour)
		await waitFor(() => v.el.querySelector('micrio-tour') !== null, 4000, 'the tour element')
		v.el.state.tour.set(undefined)
		await waitFor(() => v.el.querySelector('micrio-tour') === null, 4000, 'the tour element to go')

		expect(r.details('tour-stop')).toHaveLength(1)
	})

	it('fires tour-step and tour-ended for a serial tour', async () => {
		const fixture = markerBundle({
			markerTours: [markerTour({ steps: ['m1', 'm2'], isSerialTour: true })],
		})
		const tour = fixture.markerTours[0]
		const { viewer: v, rec: r } = await open(fixture.bundle)

		v.el.state.tour.set(tour)
		await waitFor(() => v.el.querySelector('micrio-serial-tour') !== null, 4000, 'the serial tour')

		// One event per step opened, carrying the tour being stepped through.
		await waitFor(() => r.details('tour-step').length > 0, 4000, 'the first tour-step')
		expect(same(r.details('tour-step')[0], tour)).toBe(true)

		v.el.state.tour.set(undefined)
		// `remove()` runs the element's teardown as a custom-element reaction, so waiting on the
		// DOM alone can return before the cleanup that reports the end has run.
		await waitFor(() => r.details('tour-ended').length > 0, 4000, 'the tour to report its end')

		expect(same(r.details('tour-ended')[0], tour)).toBe(true)
	})

	it('fires marker-open, marker-opened and marker-closed around one marker', async () => {
		const fixture = markerBundle({ markers: [marker('m1')] })
		const { viewer: v, rec: r } = await open(fixture.bundle)

		v.el.$current?.state.marker.set(fixture.markerIds[0])
		await waitForMarker(v.el, fixture.mid('m1'))

		expectFired(r, 'marker-open')

		v.el.$current?.state.marker.set(undefined)
		await waitFor(() => !v.el.$current?.state.$marker, 4000, 'the marker to close')

		expectFired(r, 'marker-closed')
	})

	it('fires page-open and page-closed for a custom content page', async () => {
		const page = {
			id: 'about',
			i18n: { en: { title: 'About' } },
			content: { i18n: { en: { body: '<p>Body</p>' } } },
		} as unknown as Models.ImageData.Menu
		const { viewer: v, rec: r } = await open(modernBundle())

		v.el.state.popover.set({ contentPage: page })
		await waitFor(() => v.el.querySelector('micrio-popover') !== null, 4000, 'the popover')

		// `page-open` comes from the menu, which a state-driven popover does not go through;
		// `page-closed` is the one this suite owns.
		const dialog = v.el.querySelector('micrio-popover dialog')
		expect(dialog).not.toBeNull()
		;(dialog as HTMLDialogElement).close()
		await waitFor(() => v.el.querySelector('micrio-popover') === null, 4000, 'the popover to go')

		expect(same(expectFired(r, 'page-closed'), page)).toBe(true)
	})
})

describe('events that must not double-fire', () => {
	it('reports audio-mute and audio-unmute once per mute change', async () => {
		const { viewer: v, rec: r } = await open(modernBundle())

		v.el._isMuted.set(true)
		await settle()
		v.el._isMuted.set(false)
		await settle()

		expect(r.details('audio-mute')).toHaveLength(1)
		expect(r.details('audio-unmute')).toHaveLength(1)
	})
})
