import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import type { OmniUI } from '$gallery/omni'
import { archive } from '$utils/archive'
import { baseInfo } from './bundles'
import { gridImageId, makeMdp, stubArchiveXhr } from './grid'
import { mockJson } from '../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'

/**
 * The omni (3D rotatable object) harness.
 *
 * Two things shape it:
 *
 * - `OmniUI.setup` reads the bundle back out of `DataLoader._getBundleImageSync`,
 *   a cache only the `bundle.json` fetch fills. Opening a bundle *object* leaves
 *   it empty and omni setup returns early, so the fixture mounts by the element's
 *   **id attribute** and never calls `open(bundle)`.
 * - `setup` also awaits `archive.load(<id>/base)` on a v5+ bundle. That goes over
 *   `XMLHttpRequest`, which the suite's `fetch` interception does not reach, so
 *   the fixture installs the shared archive XHR stub with an empty MDP body. The
 *   actual frame thumbnails come from the texture-worker fake.
 *
 * Image ids must be unique per fixture (`DataLoader`'s bundle cache and
 * `archive`'s loaded-body map are module-level and keyed by id). The per-call
 * base-36 tag does that, and the leading `AN` makes `decodeV5Id` read the id as
 * a plain, non-360 WebP raster.
 */

/** A unique 3-character fixture tag, so no two fixtures share an id. */
const TAG_RANGE = 36 * 36 * 36
let fixtureTag = Math.floor(Math.random() * TAG_RANGE)
const nextTag = (): string => {
	const tag = fixtureTag
	fixtureTag = (fixtureTag + 1) % TAG_RANGE
	return tag.toString(36).padStart(3, '0')
}

export interface OmniOptions {
	/** Frame count around the object. Defaults to 36. */
	frames?: number
	/** Number of textured layers (shells). Defaults to 1. */
	layers?: number
	/** Which layer to show first. */
	layerStartIndex?: number
	/** Camera distance from the object centre. */
	distance?: number
	/** Camera field of view in radians. */
	fieldOfView?: number
	/** Camera vertical angle in radians. */
	verticalAngle?: number
	/** Centre X offset. */
	offsetX?: number
	/** Put the labels on the side of the object. */
	sideLabels?: boolean
	/** Extra settings merged last (for the settings that are not wired up yet). */
	omni?: Partial<Models.ImageInfo.OmniSettings>
	/** Bundle version; below `5` `setup` skips the archive load entirely. */
	version?: string
	/** The image's markers. */
	markers?: Models.ImageData.Marker[]
	/** Marker tours, attached to the image's data. */
	markerTours?: Models.ImageData.MarkerTour[]
	/** Video tours, attached to the image's data. */
	tours?: Models.ImageData.VideoTour[]
	/** Extra image settings, merged under `omni`. */
	settings?: Partial<Models.ImageInfo.Settings>
}

export interface OmniFixture {
	/** The `bundle.json` body: a one-image response (`DataLoader` only caches `images[]`). */
	bundle: Models.ImageBundle.BundleResponse
	/** The single image entry, for the object-open path a test may exercise. */
	image: Models.ImageBundle.BundleImage
	id: string
	/** The archive id as `setup` loads it (`<id>/base`). */
	archiveId: string
	mdp: ArrayBuffer
}

/** Builds one omni image bundle plus the (empty) archive body its setup wants. */
export function omniFixture(opts: OmniOptions = {}): OmniFixture {
	const tag = nextTag()
	const id = gridImageId(0, tag)
	const numLayers = Math.max(1, opts.layers ?? 1)

	const omni: Models.ImageInfo.OmniSettings = {
		frames: opts.frames ?? 36,
		startIndex: 0,
		fieldOfView: opts.fieldOfView ?? 0,
		verticalAngle: opts.verticalAngle ?? 0,
		distance: opts.distance ?? 0,
		offsetX: opts.offsetX ?? 0,
		...(opts.sideLabels === undefined ? {} : { sideLabels: opts.sideLabels }),
		...(numLayers > 1
			? { layers: Array.from({ length: numLayers }, (_, i) => ({ i18n: { en: `Layer ${i + 1}` } })) }
			: {}),
		...(opts.layerStartIndex === undefined ? {} : { layerStartIndex: opts.layerStartIndex }),
		...opts.omni,
	}

	const image: Models.ImageBundle.BundleImage = {
		id,
		info: baseInfo(id, { title: 'Omni object', version: opts.version ?? '6.1.11' }),
		settings: { ...opts.settings, omni },
		data: {
			...(opts.markers === undefined ? {} : { markers: opts.markers }),
			...(opts.markerTours === undefined ? {} : { markerTours: opts.markerTours }),
			...(opts.tours === undefined ? {} : { tours: opts.tours }),
		},
	}

	return { bundle: { images: [image] }, image, id, archiveId: `${id}/base`, mdp: makeMdp([]) }
}

export interface OpenOmni {
	viewer: Viewer
	image: NonNullable<HTMLMicrioElement['$current']>
	omni: OmniUI
	/** The rotation dial the omni UI printed. */
	dial: HTMLElement | null
	fixture: OmniFixture
}

/** Every viewer `openOmni` created, so a suite can destroy them all in `afterEach`. */
const mountedViewers: Viewer[] = []

/** Destroys every viewer the omni fixture mounted. Call from the suite's `afterEach`. */
export function destroyOmni(): void {
	for (const viewer of mountedViewers.splice(0)) {
		viewer.destroy()
	}
}

/**
 * Opens an omni image by id and waits for its UI.
 *
 * The gate is `image.omni`, which `setup` assigns last; the dial element alone
 * would be a weaker signal because `setup` is fire-and-forget.
 */
export async function openOmni(opts: OmniOptions = {}): Promise<OpenOmni> {
	const fixture = omniFixture(opts)
	archive.db.clear()
	mockJson(/bundle\.json/, fixture.bundle)
	stubArchiveXhr(fixture.mdp)

	const viewer = mountViewer({ id: fixture.id }, 'width: 800px; height: 600px; display: block;')
	mountedViewers.push(viewer)

	await waitFor(() => viewer.el.$current?.omni !== undefined, 6000, 'the omni UI')
	const image = viewer.el.$current
	if (!image?.omni) {
		throw new Error(`omni setup never finished for ${fixture.id}`)
	}
	return { viewer, image, omni: image.omni, dial: viewer.el.querySelector<HTMLElement>('micrio-dial'), fixture }
}

/** The `<micrio-marker>` elements the omni image renders. */
export function omniMarkers(el: Element): HTMLElement[] {
	return [...el.querySelectorAll<HTMLElement>('micrio-marker')]
}

/** Waits until the omni image has rendered its markers. */
export async function waitForOmniMarkers(el: Element, timeout = 6000): Promise<HTMLElement[]> {
	await waitFor(() => omniMarkers(el).length > 0, timeout, 'the omni markers')
	return omniMarkers(el)
}
