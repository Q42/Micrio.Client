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
 * The hit geometry of a 360 `<micrio-embed>` overlay.
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
 * regression is asserted on the geometry rather than on a rule, because the bug only
 * exists where layout and hit testing meet.
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
 * A 360 image carrying one embed, built like the reported Kindred Spirits one: a
 * tiled sub-image whose HTML layer is a transparent click area, 1129x1400 at `AREA`,
 * with an `href` click action.
 */
const imageBundle = (id: string, embed: Partial<Models.ImageData.Embed> = {}): Models.ImageBundle.BundleImage => ({
	id,
	info: baseInfo(id, { is360: true, width: 12000, height: 6000, isWebP: true, isDeepZoom: true }),
	settings: {},
	data: {
		embeds: [
			{
				id: 'e1',
				uuid: 'u1',
				src: 'about:blank',
				title: 'Kindred Spirits',
				micrioId: `${id}/micrios/sub`,
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
				...embed,
			},
		],
	},
})

interface OpenEmbed {
	viewer: Viewer
	image: MicrioImage
	/** The `<a>`/`<div>` overlay the embed element transforms. */
	container: HTMLElement
}

/** Opens a 2:1 360 viewer on the embed bundle, ready to be positioned. */
async function openEmbed(
	embed?: Partial<Models.ImageData.Embed>,
	attrs: Record<string, string> = {},
): Promise<OpenEmbed> {
	const id = embedImageId()
	mockJson(/bundle\.json/, { images: [imageBundle(id, embed)], spaces: [] })
	const viewer = mountViewer(attrs, 'width: 1024px; height: 532px; display: block;')
	await viewer.open(id)
	await waitFor(() => viewer.el.$current?.id === id, 4000, 'current image')
	await waitFor(() => get(viewer.el._visible).length > 0, 8000, 'visible image')
	const image = viewer.el.$current
	if (!image) {
		throw new Error('the 360 image never became current')
	}
	const selector = 'micrio-image-embeds micrio-embed > a, micrio-image-embeds micrio-embed > div'
	await waitFor(() => viewer.el.querySelector(selector) !== null, 4000, 'the embed overlay')
	const container = viewer.el.querySelector<HTMLElement>(selector)
	if (!container) {
		throw new Error('the embed overlay was never built')
	}
	// A natural-size image has no box until it decodes.
	await waitFor(() => container.offsetWidth > 0 && container.offsetHeight > 0, 4000, 'the overlay box')
	return { viewer, image, container }
}

/**
 * Hit-tests a grid over the viewer and counts how many hits land on `container`
 * inside and outside the rendered box of the content itself (padded by one grid
 * step). The content — not the overlay — is the reference, because a video scales
 * itself inside the overlay and so can draw beyond it.
 */
function hitSpread(viewer: Viewer, container: HTMLElement, step = 8): { inside: number; outside: number } {
	const viewerRect = viewer.el.getBoundingClientRect()
	const content = container.querySelector<HTMLElement>('video, iframe, img, button') ?? container
	const box = content.getBoundingClientRect()
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
async function expectHitOnlyOnTheEmbed(opened: OpenEmbed): Promise<void> {
	for (const view of VIEWS) {
		opened.image.camera.setView(view)
		// Sequential by design: each view is measured from the previous one's settled camera.
		// oxlint-disable-next-line eslint/no-await-in-loop -- see above
		await afterFrame()
		// oxlint-disable-next-line eslint/no-await-in-loop -- see above
		await afterFrame()
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
