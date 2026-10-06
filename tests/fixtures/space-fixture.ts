import type { Models } from '$types/models'
import { get } from '$core/store'
import { spaceBundle } from './bundles'
import { mockJson } from '../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'

/**
 * The space harness shared by the 360 suites.
 *
 * The bundle and space caches in `$utils/dataLoader` are module-level and keyed by id,
 * so every test has to use fresh ids — otherwise it hits a bundle cached by an earlier
 * test and never populates its own space. Remapping has to cover the image ids, the
 * space id, the ids inside the space, *and* the link ids, or the waypoints never match.
 */

/** One end of a space link, as `markers.ts` reads it: `[fromId, toId, settings map]`. */
export type SpaceLink = [string, string, { [key: string]: Models.Spaces.WayPointSettings }?]

export interface FreshSpace {
	images: Models.ImageBundle.BundleImage[]
	spaces: { id: string; data: Models.Spaces.Space }[]
	/** Image ids in fixture order. */
	ids: string[]
	spaceId: string
}

let run = 0

/** Rewrites `spaceBundle()` to a fresh set of ids, including link endpoints. */
export function freshSpace(
	opts: {
		/** Replace the links array (receives the remapped image ids). */
		links?: (ids: string[]) => SpaceLink[]
		/** Per-image rotationY override, keyed by remapped id index. */
		rotationY?: (index: number) => number
	} = {},
): FreshSpace {
	const suffix = (++run).toString().padStart(3, '0')
	const { images, spaces } = spaceBundle()
	const spaceId = `space-${suffix}`
	const idMap = new Map<string, string>()

	for (const [index, image] of images.entries()) {
		const next = `${suffix}img${index}`
		idMap.set(image.id, next)
		image.id = next
		image.info.id = next
	}

	const space = spaces[0]
	if (!space) {
		throw new Error('space fixture missing')
	}
	space.id = spaceId
	for (const image of images) {
		if (image.info.spacesId !== undefined) {
			image.info.spacesId = spaceId
		}
	}

	const remap = (id: string) => idMap.get(id) ?? id
	const ids = space.data.images.map((w) => remap(w.id))
	space.data.images = space.data.images.map((waypoint, index) => ({
		...waypoint,
		id: remap(waypoint.id),
		rotationY: opts.rotationY ? opts.rotationY(index) : waypoint.rotationY,
	}))

	if (opts.links) {
		space.data.links = opts.links(ids)
	} else {
		space.data.links = space.data.links.map(([a, b, settings]) => {
			if (!settings) {
				return [remap(a), remap(b)] as SpaceLink
			}
			const nextSettings: { [key: string]: Models.Spaces.WayPointSettings } = {}
			for (const [key, value] of Object.entries(settings)) {
				nextSettings[remap(key)] = value
			}
			return [remap(a), remap(b), nextSettings] as SpaceLink
		})
	}

	return { images, spaces, ids: images.map((i) => i.id), spaceId }
}

/**
 * A loaded viewer on one image of a fresh linked space.
 *
 * `viewer` is the mounted `Viewer` (so `openSpace(...).viewer.el` works) and `space`
 * carries the fixture's own space data for assertions about it.
 */
export interface OpenSpace {
	viewer: Viewer
	ids: string[]
	spaceId: string
	space: Models.Spaces.Space
}

/**
 * Mounts a viewer and opens one image of a fresh space.
 * `style` matters: the sphere maths depends on the element's aspect ratio.
 */
export async function openSpace(
	index = 0,
	opts: {
		links?: (ids: string[]) => SpaceLink[]
		rotationY?: (i: number) => number
		style?: string
		attrs?: Record<string, string>
	} = {},
): Promise<OpenSpace> {
	const { images, spaces, ids, spaceId } = freshSpace({ links: opts.links, rotationY: opts.rotationY })
	mockJson(/bundle\.json/, { images, spaces })

	const viewer = mountViewer(opts.attrs ?? {}, opts.style ?? 'width: 512px; height: 256px; display: block;')
	const id = ids[index] ?? ''
	await viewer.open(id)
	await waitFor(() => viewer.el.$current?.id === id, 4000, `current image ${id}`)
	await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish')

	const space = spaces[0]
	if (!space) {
		throw new Error('space fixture missing')
	}
	return { viewer, ids, spaceId, space: space.data }
}

/**
 * Opens a fresh space *and* waits until the image is on screen.
 *
 * The markers layer (and therefore every `<micrio-waypoint>`) only exists for images
 * that are in `_visible`, which happens once the first frame has been drawn.
 */
export async function openVisibleSpace(index = 0, opts: Parameters<typeof openSpace>[1] = {}): Promise<OpenSpace> {
	const space = await openSpace(index, opts)
	await waitFor(() => get(space.viewer.el._visible).length > 0, 8000, 'image visible')
	return space
}

/** Builds a bidirectional link pair with optional per-end settings. */
export function linkPair(
	a: string,
	b: string,
	settingsA?: Models.Spaces.WayPointSettings,
	settingsB?: Models.Spaces.WayPointSettings,
): SpaceLink[] {
	return [
		[a, b, settingsA ? { [a]: settingsA } : undefined],
		[b, a, settingsB ? { [b]: settingsB } : undefined],
	]
}
