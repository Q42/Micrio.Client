import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { createElement } from '$utils/dom'
import { embedBundle, glEmbed, imageEmbed } from '../../fixtures/embeds'
import { fakeImage, mockHost, openEmbedImage, type FakeImage } from '../../helpers/embed'
import { settle } from '../../helpers/tour'
import { waitFor, type Viewer } from '../../helpers/viewer'

/**
 * `<micrio-image-embeds>` — the container the layout mounts per visible image.
 *
 * The element itself has one job: watch `image.data` and rebuild one
 * `<micrio-embed>` per `data.embeds` entry. The unit cases use a fake image
 * (no WebGL); the integration cases open a real bundle so the layout's
 * `#syncImageLayer` wiring, the `data-embeds` opt-out and the GL/HTML decision
 * are exercised end to end.
 */
let host: Viewer
const viewers: Viewer[] = []

beforeEach(() => {
	host = mockHost()
})

afterEach(() => {
	for (const viewer of viewers) {
		viewer.destroy()
	}
	viewers.length = 0
	host.destroy()
})

/** Mounts the container against a fake image; the children get their context from `host`. */
function mountContainer(image: FakeImage): HTMLElement {
	return createElement('micrio-image-embeds', { setProps: { image }, parent: host.el })
}

const embedChildren = (el: Element): Element[] => [...el.querySelectorAll('micrio-embed')]

describe('micrio-image-embeds (unit)', () => {
	it('renders one embed element per data entry, in order', () => {
		const image = fakeImage()
		image.data.set({ embeds: [imageEmbed({ id: 'a' }), imageEmbed({ id: 'b' })] })
		const el = mountContainer(image)
		const children = embedChildren(el)
		expect(children).toHaveLength(2)
		expect(children.map((c) => c.firstElementChild?.id)).toEqual(['e-a', 'e-b'])
	})

	it('renders nothing when the data has no embeds', () => {
		const image = fakeImage()
		image.data.set({})
		expect(embedChildren(mountContainer(image))).toHaveLength(0)
	})

	it('renders nothing while the data store is still empty', () => {
		const image = fakeImage()
		expect(embedChildren(mountContainer(image))).toHaveLength(0)
	})

	it('replaces every embed when the data is set again', () => {
		const image = fakeImage()
		image.data.set({ embeds: [imageEmbed({ id: 'a' })] })
		const el = mountContainer(image)
		const first = embedChildren(el)[0]
		image.data.set({ embeds: [imageEmbed({ id: 'b' }), imageEmbed({ id: 'c' })] })
		const children = embedChildren(el)
		expect(children).toHaveLength(2)
		// The old element is discarded, not reused.
		expect(children.includes(first as Element)).toBe(false)
	})

	it('clears the embeds when the data is emptied', () => {
		const image = fakeImage()
		image.data.set({ embeds: [imageEmbed({ id: 'a' })] })
		const el = mountContainer(image)
		image.data.set(undefined)
		expect(embedChildren(el)).toHaveLength(0)
	})
})

describe('micrio-image-embeds (layout integration)', () => {
	it('mounts the layer from a bundle whose data carries embeds', async () => {
		const bundle = embedBundle([imageEmbed({ id: 'a' }), glEmbed({ uuid: 'u1' })])
		const { viewer, image } = await openEmbedImage(bundle)
		viewers.push(viewer)

		await waitFor(() => viewer.el.querySelector('micrio-image-embeds') !== null, 4000, 'the embed layer')
		await waitFor(
			() => embedChildren(viewer.el.querySelector('micrio-image-embeds') as Element).length === 2,
			4000,
			'the embeds',
		)

		const children = embedChildren(viewer.el.querySelector('micrio-image-embeds') as Element)
		expect(children[0]?.querySelector('img')?.getAttribute('src')).toBe('about:blank')
		// The tiled embed reaches the real engine and registers itself on the image.
		expect(image._embeds.some((i) => i.$info?.title === 'u1')).toBe(true)
	})

	it('omits the layer entirely when data-embeds is false', async () => {
		const { viewer } = await openEmbedImage(embedBundle([imageEmbed()]), { 'data-embeds': 'false' })
		viewers.push(viewer)
		// The layer would be created by the same layout sync that reports the image
		// as visible, so waiting for that is enough to prove it was suppressed.
		await waitFor(() => get(viewer.el._visible).length > 0, 4000, 'image visible')
		await settle(2)
		expect(viewer.el.querySelector('micrio-image-embeds')).toBeNull()
	})

	it('renders a tiled embed as HTML when data-embeds-inside-gl is false', async () => {
		const { viewer } = await openEmbedImage(embedBundle([glEmbed({ uuid: 'u2', src: 'about:blank' })]), {
			'data-embeds-inside-gl': 'false',
		})
		viewers.push(viewer)
		await waitFor(
			() => viewer.el.querySelector('micrio-image-embeds micrio-embed img') !== null,
			4000,
			'the HTML fallback',
		)
		expect(viewer.el.querySelector('micrio-image-embeds micrio-embed img')?.getAttribute('src')).toBe('about:blank')
	})
})
