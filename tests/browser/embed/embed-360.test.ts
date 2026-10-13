import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import { frameEmbed, glEmbed } from '../../fixtures/embeds'
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
 * The overlay is `<div>/<a class="embed3d matrix360">` sized to its content, and
 * the matrix both places *and* centres the content (the child keeps no transform
 * of its own — see `#syncMatrixBox`); `display` stays `''` because `getMatrix`
 * never returns an empty array without the book3d override. A centre behind the
 * camera is taken out of the pointer path with the `behind` class instead, since
 * the matrix still transforms (and hit-tests) the mirrored overlay.
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
		expect(c.classList.contains('matrix360')).toBe(true)
		expect(c.style.display).toBe('')
		expect(c.style.transform).toMatch(/^matrix3d\(/)

		// The overlay is the content's box, and the matrix carries the child's
		// centring: the written matrix is the camera placement composed with
		// `translate(-halfWidth, -halfHeight)`.
		const child = contentOf(el)
		const hw = (child?.offsetWidth ?? 0) / 2
		const hh = (child?.offsetHeight ?? 0) / 2
		expect(c.style.width).toBe(`${child?.offsetWidth ?? 0}px`)
		expect(c.style.height).toBe(`${child?.offsetHeight ?? 0}px`)

		// The CSSOM reserializes the matrix with ~6 significant digits and spaces,
		// so compare the numbers, not the string.
		const expected = [...image.camera.getMatrix(0.5, 0.5, 1.5, 1, 0, 0.5, 0, undefined, 1, 1)]
		for (let i = 0; i < 4; i++) {
			expected[12 + i] = (expected[12 + i] ?? 0) - hw * (expected[i] ?? 0) - hh * (expected[4 + i] ?? 0)
		}
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

	it('folds the content scale and centring into the matrix', async () => {
		const { viewer, image, el } = await open360(
			glEmbed({ area: [0.25, 0.25, 0.25, 0.25], clickAction: 'href', clickTarget: '/artwork/x' }),
		)
		const c = containerOf(el) as HTMLElement
		const button = contentOf(el) as HTMLElement
		expect(button.tagName).toBe('BUTTON')
		// The content is no longer scaled (or centred) by its own transform: the
		// overlay is the content's box and the matrix does the placing, which is what
		// keeps Chromium's flattened hit test inside the drawn quad.
		expect(button.style.getPropertyValue('--scale')).toBe('1')
		expect(c.style.width).toBe(`${button.offsetWidth}px`)
		expect(c.style.height).toBe(`${button.offsetHeight}px`)

		// Composing the written matrix with the child's centring has to land the
		// content's centre exactly on the camera's anchor for the area — the same
		// anchor the camera reports for any scale, since a scale never moves it.
		const anchor = [...image.camera.getMatrix(0.375, 0.375, 1, 1, 0, 0, 0)].slice(12, 15)
		const m = (/^matrix3d\((.+)\)$/.exec(c.style.transform)?.[1].split(',').map(Number) ?? []).slice(0, 16)
		const hw = button.offsetWidth / 2
		const hh = button.offsetHeight / 2
		const placed = [0, 1, 2].map((i) => (m[12 + i] ?? 0) + hw * (m[i] ?? 0) + hh * (m[4 + i] ?? 0))
		for (const [i, value] of placed.entries()) {
			expect(value).toBeCloseTo(anchor[i] ?? Number.NaN, 3)
		}
		viewer.destroy()
	})

	it('flags an overlay that is behind the camera, so it stops taking clicks', async () => {
		const { viewer, el } = await open360(frameEmbed({ area: [0.4, 0.4, 0.2, 0.2] }))
		const c = containerOf(el) as HTMLElement
		// The camera looks at the view centre, so an embed there is in front of it.
		expect(c.classList.contains('behind')).toBe(false)

		// The opposite side of the sphere is behind the camera. The matrix still
		// transforms the overlay (mirrored through the eye), so the class is what
		// keeps it from covering and swallowing the clicks of what is in front.
		dispatchChange(el, { area: [0, 0.4, 0.2, 0.2] })
		expect(c.classList.contains('behind')).toBe(true)
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
