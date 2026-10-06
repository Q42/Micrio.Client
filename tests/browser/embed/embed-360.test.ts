import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import { embed, frameEmbed, glEmbed } from '../../fixtures/embeds'
import { openVisibleSpace, type OpenSpace } from '../../fixtures/space-fixture'
import { containerOf, contentOf, dispatchChange, mountEmbed } from '../../helpers/embed'

/**
 * `<micrio-embed>` on a 360 image.
 *
 * These are the *real* cases: a real space viewer, a real bound `Camera360`, a
 * real `matrix3d` transform. The geometry is not stubbed (the unit-level seam
 * tests live in `embed.test.ts`); assertions therefore compare the DOM against a
 * same-tick `camera.getMatrix(...)` call rather than against literals, because
 * the matrix depends on the canvas pixel size and camera state.
 *
 * `#readPlacement`'s 360 pass adds the `Math.PI / 2` projection factor to
 * `--scale`; the container is `<div>/<a class="embed3d">` positioned entirely by
 * `transform: matrix3d(...)`, and `display` stays `''` because `getMatrix` never
 * returns an empty array without the book3d override.
 */
async function open360(
	embedData: Models.ImageData.Embed,
): Promise<OpenSpace & { image: MicrioImage; el: HTMLElement }> {
	const space = await openVisibleSpace(0)
	const image = space.viewer.el.$current
	if (!image) {
		throw new Error('the 360 space never produced a current image')
	}
	const wrapper = document.createElement('div')
	space.viewer.el.append(wrapper)
	const el = mountEmbed({ embed: embedData, image }, wrapper)
	return { ...space, image, el }
}

describe('360 embeds', () => {
	it('writes a real matrix3d transform from the area and rotations', async () => {
		const { viewer, image, el } = await open360(frameEmbed({ area: [0.4, 0.4, 0.2, 0.2], scale: 1.5 }))
		const container = containerOf(el)
		expect(container).not.toBeNull()
		const c = container as HTMLElement

		// Force a synchronous re-apply with a known rotation, then compare against
		// the same camera call the element makes. No frame can run in between.
		dispatchChange(el, { rotY: 0.5 })

		expect(c.classList.contains('embed3d')).toBe(true)
		expect(c.style.display).toBe('')
		expect(c.style.transform).toMatch(/^matrix3d\(/)

		// The CSSOM reserializes the matrix with ~6 significant digits and spaces,
		// so compare the numbers, not the string.
		const expected = [...image.camera.getMatrix(0.5, 0.5, 1.5, 1, 0, 0.5, 0, undefined, 1, 1)]
		const written = /^matrix3d\((.+)\)$/.exec(c.style.transform)?.[1].split(',').map(Number) ?? []
		expect(expected).toHaveLength(16)
		expect(written).toHaveLength(16)
		for (const [i, value] of written.entries()) {
			expect(Math.abs(value - (expected[i] ?? Number.NaN)) / Math.max(1, Math.abs(expected[i] ?? 1))).toBeLessThan(1e-4)
		}

		// The element also builds the iframe itself, at the area's pixel size.
		expect(el.querySelector('iframe')?.getAttribute('width')).toBe('102')

		viewer.destroy()
	})

	it('scales a 360 button by the π/2 projection factor, not the matrix alone', async () => {
		const { viewer, el } = await open360(embed({ area: [0.25, 0.25, 0.25, 0.25] }))
		const button = contentOf(el)
		expect(button?.tagName).toBe('BUTTON')
		expect(Number(button?.style.getPropertyValue('--scale'))).toBeCloseTo(0.25 * (512 / 100) * (Math.PI / 2), 10)
		expect(button?.style.getPropertyValue('--ratio')).toBe('1')
		viewer.destroy()
	})

	it('updates the matrix when a rotation changes', async () => {
		const { viewer, el } = await open360(frameEmbed({ scale: 1 }))
		const c = containerOf(el) as HTMLElement
		dispatchChange(el, { rotY: 0.2 })
		const first = c.style.transform
		dispatchChange(el, { rotY: -0.4 })
		expect(first).toMatch(/^matrix3d\(/)
		expect(c.style.transform).not.toBe(first)
		viewer.destroy()
	})

	it('places a tiled 360 embed inside WebGL without an HTML layer', async () => {
		const { viewer, image, el } = await open360(glEmbed({ uuid: 'u360' }))
		expect(containerOf(el)).toBeNull()
		expect(image._embeds.some((i) => i.$info?.title === 'u360')).toBe(true)
		viewer.destroy()
	})

	it('keeps an interactive overlay for a WebGL 360 embed', async () => {
		const { viewer, image, el } = await open360(glEmbed({ uuid: 'u361', clickAction: 'markerId', clickTarget: 'm1' }))
		const container = containerOf(el)
		expect(container).not.toBeNull()
		container?.dispatchEvent(new MouseEvent('click'))
		expect(get(image.state.marker)).toBe('m1')
		viewer.destroy()
	})
})
