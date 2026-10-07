import { afterEach, describe, expect, it } from 'vitest'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { icons } from '$ui/icons'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers } from '../../fixtures/markers'
import { openVisibleSpace } from '../../fixtures/space-fixture'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * The `<micrio-marker>` element itself: which classes and icon it prints, the label and
 * tooltip it derives from the marker's culture data, the hover state it reports, and the
 * screen position it writes.
 *
 * `<micrio-icon>` keeps its name private and renders an SVG, so icon assertions compare
 * the rendered `<path d>` against the icon table rather than reading a prop.
 */

/** A minimal `Assets.Image`, for the custom-icon settings. */
const asset = (src: string) => ({ title: src, src, size: 1, uploaded: 0, width: 64, height: 64 }) as Models.Assets.Image

/** The `d` of the icon inside a `<micrio-icon>` child of `root`. */
const iconPath = (root: Element | null | undefined): string =>
	root?.querySelector('micrio-icon svg path')?.getAttribute('d') ?? ''

afterEach(() => {
	// The no-tooltips test parks a query string on the page URL
	if (location.search) {
		history.replaceState(null, '', location.pathname)
	}
})

describe('marker icons', () => {
	it('draws the link icon for a link marker', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { type: 'link' })] }))
		const el = opened.markerEl('m1')
		expect(iconPath(el)).toBe(icons.link[2])
		expect(el?.classList.contains('has-icon')).toBe(true)
		// An icon also makes the marker a default (dot) marker
		expect(el?.classList.contains('default')).toBe(true)
		opened.viewer.destroy()
	})

	it('draws the play icon for a media marker', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { type: 'media' })] }))
		expect(iconPath(opened.markerEl('m1'))).toBe(icons.play[2])
		opened.viewer.destroy()
	})

	it('prints no icon and no default class for an image marker', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { type: 'image' })] }))
		const el = opened.markerEl('m1')
		expect(el?.querySelector('micrio-icon')).toBeNull()
		expect(el?.querySelector('img')).toBeNull()
		expect(el?.classList.contains('default')).toBe(false)
		expect(el?.classList.contains('has-icon')).toBe(false)
		opened.viewer.destroy()
	})

	it('uses the image-wide custom icon', async () => {
		const opened = await openMarkers(
			markerBundle({ settings: { _markers: { markerIcon: asset('https://example.test/wide.png') } } }),
		)
		const el = opened.markerEl('m1')
		expect(el?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/wide.png')
		expect(el?.classList.contains('has-custom-icon')).toBe(true)
		opened.viewer.destroy()
	})

	it('prefers a marker-specific icon over the image-wide one', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { data: { icon: asset('https://example.test/marker.png') } })],
				settings: { _markers: { markerIcon: asset('https://example.test/wide.png') } },
			}),
		)
		expect(opened.markerEl('m1')?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/marker.png')
		opened.viewer.destroy()
	})

	it('resolves a custom icon index against the image settings', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { data: { customIconIdx: 1 } })],
				settings: {
					_markers: {
						customIcons: [asset('https://example.test/zero.png'), asset('https://example.test/one.png')],
					},
				},
			}),
		)
		expect(opened.markerEl('m1')?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/one.png')
		opened.viewer.destroy()
	})

	it('falls back to the marker icon for an out-of-range custom icon index', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { data: { customIconIdx: 7, icon: asset('https://example.test/fallback.png') } })],
				settings: { _markers: { customIcons: [asset('https://example.test/zero.png')] } },
			}),
		)
		const el = opened.markerEl('m1')
		expect(el?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/fallback.png')
		expect(el?.classList.contains('has-custom-icon')).toBe(true)
		opened.viewer.destroy()
	})

	it('falls back to the image-wide icon for a bad index with no marker icon', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { data: { customIconIdx: 7 } })],
				settings: {
					_markers: {
						customIcons: [asset('https://example.test/zero.png')],
						markerIcon: asset('https://example.test/wide.png'),
					},
				},
			}),
		)
		expect(opened.markerEl('m1')?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/wide.png')
		opened.viewer.destroy()
	})
})

describe('marker labels and tooltips', () => {
	it('prefers the label over the title and wires it to the button', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { i18n: { en: { title: 'The title', label: 'The label' } } })] }),
		)
		const el = opened.markerEl('m1')
		const label = el?.querySelector('label')
		expect(label?.textContent).toBe('The label')
		expect(label?.getAttribute('for')).toBe(opened.mid('m1'))
		expect(opened.button('m1')?.title).toBe('The label')
		opened.viewer.destroy()
	})

	it('falls back to the title when there is no label', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { i18n: { en: { title: 'Only title' } } })] }),
		)
		expect(opened.markerEl('m1')?.querySelector('label')?.textContent).toBe('Only title')
		opened.viewer.destroy()
	})

	it('hides the label when the marker asks for no title', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { data: { showTitle: false } })] }))
		const el = opened.markerEl('m1')
		expect(el?.querySelector('label')).toBeNull()
		// The tooltip is gated separately, so it survives
		expect(opened.button('m1')?.title).toBe('Marker m1')
		opened.viewer.destroy()
	})

	it('hides every label when the image asks for no titles', async () => {
		const opened = await openMarkers(markerBundle({ settings: { _markers: { noTitles: true } } }))
		expect(opened.markerEl('m1')?.querySelector('label')).toBeNull()
		opened.viewer.destroy()
	})

	it('renders no label and no tooltip without culture data', async () => {
		const bare: Models.ImageData.Marker = { id: 'm1', x: 0.5, y: 0.5, type: 'default', popupType: 'popup' }
		const opened = await openMarkers(markerBundle({ markers: [bare] }))
		expect(opened.markerEl('m1')).not.toBeNull()
		expect(opened.markerEl('m1')?.querySelector('label')).toBeNull()
		expect(opened.button('m1')?.title).toBe('')
		opened.viewer.destroy()
	})

	it('re-applies the label on a language switch', async () => {
		const fixture = markerBundle({
			markers: [
				marker('m1', {
					i18n: { en: { title: 'English label' }, nl: { title: 'Nederlands label' } },
				}),
			],
			langs: ['en', 'nl'],
		})
		const opened = await openMarkers(fixture)
		expect(opened.markerEl('m1')?.querySelector('label')?.textContent).toBe('English label')

		opened.viewer.el.setAttribute('lang', 'nl')
		await waitFor(
			() => opened.markerEl('m1')?.querySelector('label')?.textContent === 'Nederlands label',
			4000,
			'the translated label',
		)
		opened.viewer.destroy()
	})

	it('drops the tooltip when the URL asks for no tooltips', async () => {
		history.replaceState(null, '', '?micrioNoTooltips')
		const opened = await openMarkers(markerBundle())
		expect(opened.button('m1')?.title).toBe('')
		// The label itself is unaffected
		expect(opened.markerEl('m1')?.querySelector('label')).not.toBeNull()
		opened.viewer.destroy()
	})
})

describe('marker hover state', () => {
	it('reports the hovered marker through the global state', async () => {
		const fixture = markerBundle()
		const opened = await openMarkers(fixture)
		const btn = opened.button('m1')

		btn?.dispatchEvent(new MouseEvent('mouseenter'))
		expect(get(opened.viewer.el.state.markerHoverId)).toBe(fixture.mid('m1'))

		btn?.dispatchEvent(new MouseEvent('mouseleave'))
		expect(get(opened.viewer.el.state.markerHoverId)).toBeUndefined()
		opened.viewer.destroy()
	})
})

describe('marker positioning', () => {
	it('positions the element from the camera coordinates', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { x: 0.25, y: 0.75 })] }), {
			style: 'width: 800px; height: 600px; display: block;',
		})
		const image = opened.image()
		const m = image.$data?.markers?.[0]
		if (!m) {
			throw new Error('no marker')
		}
		const [cx, cy] = image.camera._getXYDirect(m.x, m.y, { radius: m.radius, rotation: m.rotation })
		const el = opened.markerEl('m1')
		expect(Number.parseFloat(el?.style.getPropertyValue('--x') ?? '')).toBeCloseTo(cx, 2)
		expect(Number.parseFloat(el?.style.getPropertyValue('--y') ?? '')).toBeCloseTo(cy, 2)
		opened.viewer.destroy()
	})

	it('writes no scale by default', async () => {
		const opened = await openMarkers(markerBundle())
		expect(opened.markerEl('m1')?.style.getPropertyValue('--scale')).toBe('')
		opened.viewer.destroy()
	})

	it('scales a marker that asks for it', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { data: { scales: true } })] }))
		const scale = Number.parseFloat(opened.markerEl('m1')?.style.getPropertyValue('--scale') ?? '')
		expect(Number.isFinite(scale)).toBe(true)
		expect(scale).toBeGreaterThan(0)
		opened.viewer.destroy()
	})

	it('scales every marker when the image asks for it', async () => {
		const opened = await openMarkers(markerBundle({ settings: { markersScale: true } }))
		expect(opened.image().$settings.markersScale).toBe(true)
		expect(Number.parseFloat(opened.markerEl('m1')?.style.getPropertyValue('--scale') ?? '')).toBeGreaterThan(0)
		opened.viewer.destroy()
	})
})

/** The on-screen position the marker's own coordinates map to. */
const markerPoint = (opened: Awaited<ReturnType<typeof openMarkers>>, x: number, y: number): [number, number] => {
	const { camera } = opened.image()
	const [px, py] = camera.getXY(x, y)
	return [px, py]
}

describe('marker viewport sizing', () => {
	it('keeps a marker with a view at its own coordinates and CSS size', async () => {
		// The dashboard-era `_markers.viewportIsMarker` is not read: the marker neither moves
		// to its view's centre nor takes its size
		const view: Models.Camera.View = [0.25, 0.25, 0.5, 0.5]
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { x: 0.2, y: 0.3, view })] }))
		const [px, py] = markerPoint(opened, 0.2, 0.3)
		const el = opened.markerEl('m1')

		expect(Number.parseFloat(el?.style.getPropertyValue('--x') ?? '')).toBeCloseTo(px, 1)
		expect(Number.parseFloat(el?.style.getPropertyValue('--y') ?? '')).toBeCloseTo(py, 1)
		expect(el?.style.getPropertyValue('--micrio-marker-size')).toBe('')
		opened.viewer.destroy()
	})
})

describe('marker positioning in a 360 space', () => {
	it('uses a matrix transform for scaled 360 markers', async () => {
		const { viewer } = await openVisibleSpace(0, {
			markers: [marker('sp-scale', { x: 0.5, y: 0.5 })],
			settings: { markersScale: true },
		})
		await waitFor(() => viewer.el.querySelector('micrio-marker') !== null, 8000, 'the marker')
		const el = viewer.el.querySelector<HTMLElement>('micrio-marker')
		// In 360 the marker follows the sphere through a matrix, not screen coordinates
		expect(el?.classList.contains('mat3d')).toBe(true)
		expect(el?.style.getPropertyValue('--mat').startsWith('matrix3d(')).toBe(true)
		viewer.destroy()
	})

	it('hides a marker behind the camera and shows one in front', async () => {
		const { viewer } = await openVisibleSpace(0, {
			markers: [marker('sp-front', { x: 0.5, y: 0.5 }), marker('sp-back', { x: 0, y: 0.5 })],
		})
		await waitFor(() => viewer.el.querySelectorAll('micrio-marker').length === 2, 8000, 'both markers')
		await settle(2)

		// The camera looks at the view centre, so the marker opposite it is behind
		expect(viewer.el.querySelector('[data-marker-id="sp-front"]')?.classList.contains('behind')).toBe(false)
		expect(viewer.el.querySelector('[data-marker-id="sp-back"]')?.classList.contains('behind')).toBe(true)
		viewer.destroy()
	})
})
