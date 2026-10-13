import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { MicrioImage } from '$core/image'
import { afterFrame } from '$utils/dom'
import type { Models } from '$types/models'
import { baseInfo } from '../../fixtures/bundles'
import { videoAsset } from '../../fixtures/embeds'
import { mockJson } from '../../helpers/network'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'

/**
 * The geometry of a 360 `<micrio-embed>` overlay: where it is hit, and how big it is.
 *
 * The overlay is placed by a `matrix3d` under the viewport-level `perspective`. When
 * the transformed element is not the one carrying the content's box, Chromium's
 * flattened hit test maps far-away screen points into it: the embed becomes clickable
 * in an invisible wedge elsewhere in the viewport (the reported "Kindred Spirits"
 * overlay was clickable at the bottom right as well as on the painting).
 * `src/embed/embed.ts` therefore sizes the overlay to the content, bakes the child's
 * centring into the matrix, and leaves the content itself untransformed.
 *
 * This belongs to the stylesheet suite: the `browser` project stubs every `.css`
 * import, so its embeds have no box at all and no hit region to be wrong. The
 * regressions are asserted on the rendered geometry rather than on a rule, because
 * these are bugs that only exist where layout and hit testing meet.
 */

/** The view and the artwork embed from the reported case. */
const VIEW: Models.Camera.View = [0.2729760416116841, 0.3456651729333172, 0.346893062666947, 0.5]
const AREA: Models.Camera.View = [0.32079650869568793, 0.4296441708410724, 0.028088982608624143, 0.06966266723130878]
/** Views that keep the same embed in front of the camera: the reported one, then left and right of it. */
const VIEWS: Models.Camera.View[] = [VIEW, [0.05, 0.15, 0.346893062666947, 0.5], [0.3, 0.28, 0.346893062666947, 0.5]]

/** A fresh id per test: the bundle and fetch caches are module-level and keyed by id. */
let run = 0
const embedImageId = (): string => `hitimg${(++run).toString(36).padStart(3, '0')}`

/**
 * One embed like the reported Kindred Spirits one: a tiled sub-image whose HTML layer
 * is a transparent click area, 1129x1400 at `AREA`, with an `href` click action.
 */
const embedData = (index: number, extra: Partial<Models.ImageData.Embed> = {}): Models.ImageData.Embed => ({
	id: `e${index}`,
	uuid: `u${index}`,
	src: 'about:blank',
	title: `Kindred Spirits ${index}`,
	micrioId: `sub${index}`,
	width: 1129,
	height: 1400,
	isWebP: true,
	isDeepZoom: true,
	area: AREA,
	rotX: 0,
	rotY: 0,
	rotZ: 0,
	scaleX: 1,
	scaleY: 1,
	clickAction: 'href',
	clickTarget: '/artwork/kindred',
	...extra,
})

const imageBundle = (id: string, embeds: Partial<Models.ImageData.Embed>[]): Models.ImageBundle.BundleImage => ({
	id,
	info: baseInfo(id, { is360: true, width: 12000, height: 6000, isWebP: true, isDeepZoom: true }),
	settings: {},
	data: { embeds: embeds.map((embed, index) => embedData(index, embed)) },
})

interface OpenEmbeds {
	viewer: Viewer
	image: MicrioImage
	/** One `<a>`/`<div>` overlay per embed, in bundle order. */
	containers: HTMLElement[]
}

/** Opens a 2:1 360 viewer on an image carrying the given embeds, ready to be positioned. */
async function openEmbeds(
	embeds: Partial<Models.ImageData.Embed>[],
	attrs: Record<string, string> = {},
): Promise<OpenEmbeds> {
	const id = embedImageId()
	mockJson(/bundle\.json/, { images: [imageBundle(id, embeds)], spaces: [] })
	const viewer = mountViewer(attrs, 'width: 1024px; height: 532px; display: block;')
	await viewer.open(id)
	await waitFor(() => viewer.el.$current?.id === id, 4000, 'current image')
	await waitFor(() => get(viewer.el._visible).length > 0, 8000, 'visible image')
	const image = viewer.el.$current
	if (!image) {
		throw new Error('the 360 image never became current')
	}
	const selector = 'micrio-image-embeds micrio-embed > a, micrio-image-embeds micrio-embed > div'
	await waitFor(() => viewer.el.querySelectorAll(selector).length === embeds.length, 4000, 'the embed overlays')
	const containers = [...viewer.el.querySelectorAll<HTMLElement>(selector)]
	// A natural-size image has no box until it decodes.
	await waitFor(() => containers.every((c) => c.offsetWidth > 0 && c.offsetHeight > 0), 4000, 'the overlay boxes')
	return { viewer, image, containers }
}

/** Opens a viewer on a single embed, for the tests that only need one. */
async function openEmbed(
	embed?: Partial<Models.ImageData.Embed>,
	attrs: Record<string, string> = {},
): Promise<Omit<OpenEmbeds, 'containers'> & { container: HTMLElement }> {
	const opened = await openEmbeds([embed ?? {}], attrs)
	const container = opened.containers[0]
	if (!container) {
		throw new Error('the embed overlay was never built')
	}
	return { viewer: opened.viewer, image: opened.image, container }
}

/** The rendered box of an overlay's content (`<button>`, `<img>`, `<iframe>` or `<video>`). */
const contentOf = (container: HTMLElement): HTMLElement =>
	container.querySelector<HTMLElement>('video, iframe, img, button') ?? container

/** Positions the camera and waits for the placement to land in the render. */
async function showAt(image: MicrioImage, view: Models.Camera.View): Promise<void> {
	image.camera.setView(view)
	await afterFrame()
	await afterFrame()
}

/**
 * Hit-tests a grid over the viewer and counts how many hits land on `container`
 * inside and outside the rendered box of the content itself (padded by one grid
 * step). The content — not the overlay — is the reference, because a video scales
 * itself inside the overlay and so can draw beyond it.
 */
function hitSpread(viewer: Viewer, container: HTMLElement, step = 8): { inside: number; outside: number } {
	const viewerRect = viewer.el.getBoundingClientRect()
	const box = contentOf(container).getBoundingClientRect()
	let inside = 0
	let outside = 0
	for (let y = 0; y < viewerRect.height; y += step) {
		for (let x = 0; x < viewerRect.width; x += step) {
			const el = document.elementFromPoint(viewerRect.left + x, viewerRect.top + y)
			if (!el || (el !== container && !container.contains(el))) {
				continue
			}
			const inBox =
				x >= box.left - viewerRect.left - step &&
				x <= box.right - viewerRect.left + step &&
				y >= box.top - viewerRect.top - step &&
				y <= box.bottom - viewerRect.top + step
			if (inBox) {
				inside++
			} else {
				outside++
			}
		}
	}
	return { inside, outside }
}

/** Positions the embed at each view and checks that it is hit only where it is drawn. */
async function expectHitOnlyOnTheEmbed(
	opened: Omit<OpenEmbeds, 'containers'> & { container: HTMLElement },
): Promise<void> {
	for (const view of VIEWS) {
		// Sequential by design: each view is measured from the previous one's settled camera.
		// oxlint-disable-next-line eslint/no-await-in-loop -- see above
		await showAt(opened.image, view)
		const spread = hitSpread(opened.viewer, opened.container)
		// The overlay is there and clickable at its own position...
		expect(spread.inside, `hits inside the drawn box for view ${view.join(',')}`).toBeGreaterThan(0)
		// ...and nowhere else.
		expect(spread.outside, `phantom hits for view ${view.join(',')}`).toBe(0)
	}
	opened.viewer.destroy()
}

describe('360 embed hit geometry', () => {
	it('keeps a tiled embed clickable only where it is drawn', async () => {
		await expectHitOnlyOnTheEmbed(await openEmbed())
	})

	it('keeps an iframe embed clickable only where it is drawn', async () => {
		await expectHitOnlyOnTheEmbed(
			await openEmbed({ frameSrc: 'about:blank', src: undefined, micrioId: undefined, clickAction: undefined }),
		)
	})

	it('keeps an HTML image embed clickable only where it is drawn', async () => {
		// An SVG data URL has an intrinsic size, so the overlay box follows the image.
		const src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='600'%3E%3C/svg%3E"
		await expectHitOnlyOnTheEmbed(await openEmbed({ src, micrioId: undefined }, { 'data-embeds-inside-gl': 'false' }))
	})

	it('keeps an HTML video embed clickable only where it is drawn', async () => {
		// `controls` keeps a video out of WebGL, so its own `<figure>` is the overlay.
		await expectHitOnlyOnTheEmbed(
			await openEmbed({ src: undefined, micrioId: undefined, video: videoAsset({ controls: true }) }),
		)
	})
})

describe('360 embed size', () => {
	it('draws a tiled overlay at the size of the area it covers', async () => {
		const { viewer, image, container } = await openEmbed()
		await showAt(image, VIEW)
		// Pinned against the fixture's own projection (1024x532 canvas, 12000x6000
		// image, `AREA` at `VIEW`): the overlay covers the area, not the sub-image.
		expect(contentOf(container).getBoundingClientRect().width).toBeCloseTo(115.87, 1)
		viewer.destroy()
	})

	it('sizes a button overlay from the area, not from the sub-image resolution', async () => {
		// The same area at two sub-image resolutions: the matrix carries the content's
		// scale, so the extra pixels must not change how big the overlay is drawn.
		const opened = await openEmbeds([
			{ width: 1129, height: 1400 },
			{ width: 4000, height: 4960 },
		])
		await showAt(opened.image, VIEW)
		const [small, large] = opened.containers
		expect(small).toBeDefined()
		expect(large).toBeDefined()
		if (!small || !large) {
			return
		}
		const smallWidth = contentOf(small).getBoundingClientRect().width
		const largeWidth = contentOf(large).getBoundingClientRect().width
		expect(smallWidth).toBeGreaterThan(0)
		expect(Math.abs(smallWidth - largeWidth) / smallWidth).toBeLessThan(0.01)
		opened.viewer.destroy()
	})

	it('scales a button overlay with the area it covers', async () => {
		// Twice the area width around the same centre: twice the overlay.
		const opened = await openEmbeds([{}, { area: [AREA[0] - AREA[2] / 2, AREA[1], AREA[2] * 2, AREA[3]] }])
		await showAt(opened.image, VIEW)
		const [single, double] = opened.containers
		expect(single).toBeDefined()
		expect(double).toBeDefined()
		if (!single || !double) {
			return
		}
		const ratio = contentOf(double).getBoundingClientRect().width / contentOf(single).getBoundingClientRect().width
		expect(ratio).toBeGreaterThan(1.8)
		expect(ratio).toBeLessThan(2.2)
		opened.viewer.destroy()
	})
})
