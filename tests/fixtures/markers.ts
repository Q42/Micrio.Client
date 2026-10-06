import type { Models } from '$types/models'
import { get } from '$core/store'
import { baseInfo, marker } from './bundles'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'

/**
 * The marker fixture and harness shared by the marker suites.
 *
 * Two module-level caches shape it:
 *
 * - `MicrioElement._markerImages` maps a marker id to the `MicrioImage` it was mounted
 *   on, and is **never cleared**. `src/markers/marker-content.ts` and `marker-popup.ts`
 *   resolve their image through it, so a reused marker id would hand a later test the
 *   image of a viewer that was destroyed long ago. Every fixture therefore prefixes its
 *   marker ids per call; `mid()` maps a short id (`m1`) back to the real one.
 * - The bundle/`jsonCache` caches are keyed by image id, so the image id is fresh too.
 *
 * The bundle is opened as an **object**, not by id, so `DataLoader`'s bundle cache is
 * untouched. The suites that need it (split screen, a link to another image) serve their
 * own `bundle.json` through `helpers/network.ts`.
 */

let run = 0
/** A unique suffix per fixture call. */
const suffix = () => `${(++run).toString().padStart(2, '0')}${Math.random().toString(36).slice(2, 5)}`

export interface MarkerBundleOptions {
	/** Marker definitions; ids are prefixed per call unless `prefix` is false. */
	markers?: Models.ImageData.Marker[]
	/** Image settings — the `_markers` options live here. */
	settings?: Partial<Models.ImageInfo.Settings>
	/** Marker tours; their `steps`/`stepInfo.markerId` are remapped with the markers. */
	markerTours?: Models.ImageData.MarkerTour[]
	/** Video tours. */
	tours?: Models.ImageData.VideoTour[]
	/** Languages the image itself is localised in. */
	langs?: string[]
	/** Extra info fields (e.g. `is360`, a `micrio.dev` path). */
	info?: Partial<Models.ImageInfo.ImageInfo>
	/** Opt out of id remapping, for a fixture whose data names marker ids literally. */
	prefix?: boolean
}

export interface MarkerFixture {
	bundle: Models.ImageBundle.BundleImage
	id: string
	/** The real marker ids, in fixture order. */
	markerIds: string[]
	/** The real id of a short marker id like `m1`. */
	mid: (short: string) => string
}

/** Builds a fresh single-image bundle whose markers (and marker tours) carry unique ids. */
export function markerBundle(opts: MarkerBundleOptions = {}): MarkerFixture {
	const tag = suffix()
	const id = `mk${tag}`
	const prefix = opts.prefix === false ? '' : `${tag}-`
	const mid = (short: string) => `${prefix}${short}`

	const markers: Models.ImageData.Marker[] = []
	for (const m of opts.markers ?? [marker('m1'), marker('m2')]) {
		markers.push(Object.assign({}, m, { id: mid(m.id) }))
	}

	let markerTours: Models.ImageData.MarkerTour[] | undefined
	if (opts.markerTours) {
		markerTours = []
		for (const t of opts.markerTours) {
			const next = Object.assign({}, t) as Models.ImageData.MarkerTour
			if (t.steps) {
				next.steps = t.steps.map((s) => mid(s))
			}
			if (t.stepInfo) {
				next.stepInfo = t.stepInfo.map((si) => Object.assign({}, si, { markerId: mid(si.markerId) }))
			}
			markerTours.push(next)
		}
	}

	const i18n: Record<string, { title: string }> = {}
	for (const lang of opts.langs ?? ['en']) {
		i18n[lang] = { title: 'Marker image' }
	}

	return {
		id,
		markerIds: markers.map((m) => m.id),
		mid,
		bundle: {
			id,
			info: baseInfo(id, { title: 'Marker image', ...opts.info }),
			settings: opts.settings ?? {},
			data: {
				i18n,
				markers,
				...(markerTours ? { markerTours } : {}),
				...(opts.tours ? { tours: opts.tours } : {}),
			},
		},
	}
}

export interface OpenMarkers extends MarkerFixture {
	viewer: Viewer
	/** The image the viewer opened. */
	image: () => NonNullable<Viewer['el']['$current']>
	/** The `<micrio-markers>` layer of the open image. */
	layer: () => HTMLElement | null
	/** Every marker element currently in the layer, clusters included. */
	markerEls: () => HTMLElement[]
	/** One marker element by its short id. */
	markerEl: (short: string) => HTMLElement | null
	/** The marker's `<button>`, when it builds one. */
	button: (short: string) => HTMLButtonElement | null
	/** Opens a marker through the image state and waits until the state carries the object. */
	openMarker: (short: string) => Promise<void>
	/** Clears the open marker and waits for the state to settle. */
	closeMarker: () => Promise<void>
}

/**
 * Mounts a viewer, opens the fixture and waits for the marker layer.
 *
 * Waiting for the *layer* rather than for marker elements is deliberate: a fixture whose
 * markers are all filtered out by the active language still mounts the layer and has no
 * marker elements, and waiting for them would only time out.
 */
export async function openMarkers(
	fixture: MarkerFixture,
	opts: { attrs?: Record<string, string>; style?: string } = {},
): Promise<OpenMarkers> {
	const viewer = mountViewer(opts.attrs ?? {}, opts.style)
	await viewer.open(fixture.bundle)
	await waitFor(() => !get(viewer.el._loading), 8000, 'the marker image to load')
	await waitFor(() => viewer.el.querySelector('micrio-markers') !== null, 8000, 'the marker layer')

	const image = () => {
		const current = viewer.el.$current
		if (!current) {
			throw new Error('the marker image never became current')
		}
		return current
	}
	const find = (short: string, selector = 'micrio-marker') =>
		viewer.el.querySelector<HTMLElement>(`${selector}[data-marker-id="${CSS.escape(fixture.mid(short))}"]`)

	return {
		...fixture,
		viewer,
		image,
		layer: () => viewer.el.querySelector('micrio-markers'),
		markerEls: () => [...viewer.el.querySelectorAll<HTMLElement>('micrio-marker')],
		markerEl: (short) => find(short),
		button: (short) => find(short)?.querySelector<HTMLButtonElement>('button') ?? null,
		async openMarker(short) {
			const target = fixture.mid(short)
			image().state.marker.set(target)
			await waitFor(() => image().state.$marker?.id === target, 6000, `marker ${short} open`)
		},
		async closeMarker() {
			image().state.marker.set(undefined)
			await waitFor(() => image().state.$marker === undefined, 6000, 'marker closed')
		},
	}
}

/** Waits until a marker element with the short id is in the document (for data set after mount). */
export function waitForMarker(el: Element, shortId: string, timeout = 6000): Promise<void> {
	return waitFor(
		() => el.querySelector(`micrio-marker[data-marker-id="${CSS.escape(shortId)}"]`) !== null,
		timeout,
		`marker ${shortId}`,
	)
}

/** Waits until the layout has mounted the marker popup. */
export function waitForPopup(el: Element, timeout = 6000): Promise<void> {
	return waitFor(() => el.querySelector('micrio-marker-popup') !== null, timeout, 'the marker popup')
}
