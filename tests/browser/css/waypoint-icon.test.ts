import { describe, expect, it } from 'vitest'
import { freshSpace, type SpaceLink } from '../../fixtures/space-fixture'
import { mockJson } from '../../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'
import { settle } from '../../helpers/tour'
import { get } from '$core/store'
import { styleNumber } from './helpers'

/**
 * A `<micrio-waypoint>` with a custom icon renders an `<img>` (`src/ui/button.ts`),
 * so `src/ui/button.css` has to size it: an SVG asset that declares no `width`/`height`
 * falls back to the 300×150 default object size (≈140×150 for this 14:15 artwork), while
 * one that declares 14×15 renders at 14px. Both are the *same* arrow, so the arrow has
 * to come out at `--micrio-icon-size` (70px, from `waypoint.css`) either way.
 *
 * Computed `width`/`height` is the value under test, not `getBoundingClientRect`: the
 * waypoint's `matrix3d` transform scales the rect but not the resolved box.
 */

/** The Rijksmuseum arrow, in both intrinsic-size variants the space data carries. */
const arrow = (size = ''): string =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" ${size}viewBox="0 0 14 15" fill="none"><path d="M1 6.81 7 1l6 5.81M7 1v14" stroke="#fff" stroke-width="1.25"/></svg>`,
	)}`

/**
 * Opens a fresh linked space on one of its two images.
 *
 * One link entry carries both ends' settings, as a real bundle does: two entries (one per
 * direction) would make the first one's `l[2][image.id]` — undefined for the other end —
 * the settings the waypoint is built with.
 */
async function openIcons(index: number): Promise<{ viewer: Viewer; id: string }> {
	const {
		images,
		spaces,
		ids: imageIds,
	} = freshSpace({
		links: (ids): SpaceLink[] => {
			const [a = '', b = ''] = ids
			return [[a, b, { [a]: { i18n: {}, customIconIdx: 0 }, [b]: { i18n: {}, customIconIdx: 1 } }]]
		},
	})
	const space = spaces[0]
	if (!space) {
		throw new Error('space fixture missing')
	}
	space.data.icons = [
		{ src: arrow('width="14" height="15" '), title: 'small', size: 1, uploaded: 0, width: 14, height: 15 },
		{ src: arrow(), title: 'big', size: 1, uploaded: 0, width: 140, height: 150 },
	]
	mockJson(/bundle\.json/, { images, spaces })

	const id = imageIds[index] ?? ''
	const viewer = mountViewer('', 'width: 512px; height: 256px; display: block;')
	await viewer.open(id)
	await waitFor(() => viewer.el.$current?.id === id, 4000, `current image ${id}`)
	await waitFor(() => get(viewer.el._visible).length > 0, 8000, 'image visible')
	await settle(2)
	return { viewer, id }
}

/** The custom-icon image of the image's first waypoint. */
const icon = (viewer: Viewer): HTMLImageElement | null => viewer.el.querySelector('micrio-waypoint img')

describe('waypoint custom icons', () => {
	it('renders an icon that declares its own 14×15 size at the waypoint icon size', async () => {
		const { viewer } = await openIcons(0)
		const iconEl = icon(viewer)
		if (!iconEl) {
			throw new Error('no waypoint icon on the first image')
		}
		expect(styleNumber(iconEl, 'width')).toBe(70)
		expect(styleNumber(iconEl, 'height')).toBe(70)
		viewer.destroy()
	})

	it('renders an icon that declares no size at the waypoint icon size too', async () => {
		const { viewer } = await openIcons(1)
		const iconEl = icon(viewer)
		if (!iconEl) {
			throw new Error('no waypoint icon on the second image')
		}
		expect(styleNumber(iconEl, 'width')).toBe(70)
		expect(styleNumber(iconEl, 'height')).toBe(70)
		viewer.destroy()
	})
})
