import { describe, expect, it, vi } from 'vitest'
import { createElement } from '$utils/dom'
import { icons } from '$ui/icons'
import type { MicrioElement } from '$core/component'
import { openUi, uiBundle } from '../../fixtures/ui'
import { settle } from '../../helpers/tour'

/**
 * The small UI primitives: the inline icon, the circular progress indicator and the 360
 * rotation dial. Each has a narrow contract that nothing else asserted before, even though
 * every button in the client renders one of these icons.
 */
const ICON_TAG = 'micrio-icon'

/** Mounts an icon with a name and returns the host. */
function makeIcon(name: string) {
	const el = createElement(ICON_TAG, {
		setProps: { name },
		parent: document.body,
	}) as MicrioElement
	return el
}

describe('micrio-icon', () => {
	it('renders an inline svg for a known name', () => {
		const el = makeIcon('close')
		const svg = el.querySelector('svg')
		expect(svg).not.toBeNull()
		// The viewBox comes from the icon definition, and the fill from currentColor
		expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${icons.close[0]} ${icons.close[1]}`)
		expect(svg?.getAttribute('fill')).toBe('currentColor')
		expect(svg?.querySelector('path')?.getAttribute('d')).toBe(icons.close[2])
		el.remove()
	})

	it('marks the small icons as small', () => {
		for (const name of ['chevronDown', 'linkExt'] as const) {
			const el = makeIcon(name)
			expect(el.querySelector('svg')?.classList.contains('small'), name).toBe(true)
			el.remove()
		}
		const normal = makeIcon('close')
		expect(normal.querySelector('svg')?.classList.contains('small')).toBe(false)
		normal.remove()
	})

	it('falls back to the close icon for an unknown name', () => {
		// `_setProps` only accepts a known name, so the default stays in place
		const el = makeIcon('not-an-icon')
		expect(el.querySelector('svg')?.querySelector('path')?.getAttribute('d')).toBe(icons.close[2])
		el.remove()
	})

	it('renders every declared icon without throwing', () => {
		for (const name of Object.keys(icons) as (keyof typeof icons)[]) {
			const el = makeIcon(name)
			expect(el.querySelector('svg'), name).not.toBeNull()
			el.remove()
		}
	})

	it('swaps the icon when the name changes', () => {
		const el = makeIcon('close')
		el._setProps({ name: 'play' })
		expect(el.querySelector('svg')?.querySelector('path')?.getAttribute('d')).toBe(icons.play[2])
		el.remove()
	})

	it('lets a custom icon from the current image override the built-in', async () => {
		const ui = uiBundle()
		ui.bundle.settings = { ui: { icons: { close: '<span class="custom">x</span>' } } }
		const { viewer } = await openUi(ui)
		const el = makeIcon('close')
		// The icon element has to be *inside* the viewer to see the image's settings
		viewer.el.append(el)
		await settle(2)
		expect(el.querySelector('.custom')?.textContent).toBe('x')
		expect(el.querySelector('svg')).toBeNull()
		viewer.destroy()
	})
})

const PROGRESS_TAG = 'micrio-progress-circle'
/** The circle whose offset moves; the first one is the grey track. */
const progressCircle = (el: Element) => el.querySelectorAll('circle')[1]

describe('micrio-progress-circle', () => {
	/** The circumference the component uses for a radius of 40. */
	const CIRC = 2 * Math.PI * 40

	it('renders a track plus a progress circle inside one svg', () => {
		const el = createElement(PROGRESS_TAG, { parent: document.body }) as MicrioElement
		const svg = el.querySelector('svg')
		expect(svg).not.toBeNull()
		expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100')
		expect(svg?.querySelectorAll('circle')).toHaveLength(2)
		el.remove()
	})

	it('starts empty', () => {
		const el = createElement(PROGRESS_TAG, { parent: document.body }) as MicrioElement
		// No progress means the dash is fully offset, so nothing is drawn
		expect(progressCircle(el)?.getAttribute('stroke-dashoffset')).toBe(`${CIRC}px`)
		el.remove()
	})

	it('draws proportionally to the progress', () => {
		const el = createElement(PROGRESS_TAG, {
			setProps: { progress: 0.25 },
			parent: document.body,
		}) as MicrioElement
		expect(progressCircle(el)?.getAttribute('stroke-dashoffset')).toBe(`${CIRC * 0.75}px`)

		el._setProps({ progress: 0.5 })
		expect(progressCircle(el)?.getAttribute('stroke-dashoffset')).toBe(`${CIRC * 0.5}px`)

		el._setProps({ progress: 1 })
		expect(progressCircle(el)?.getAttribute('stroke-dashoffset')).toBe('0px')
		el.remove()
	})

	it('treats a missing progress as zero', () => {
		const el = createElement(PROGRESS_TAG, { parent: document.body }) as MicrioElement
		el._setProps({})
		expect(progressCircle(el)?.getAttribute('stroke-dashoffset')).toBe(`${CIRC}px`)
		el.remove()
	})
})

const DIAL_TAG = 'micrio-dial'

describe('micrio-dial', () => {
	it('renders nothing without a viewer to read a camera from', () => {
		// The dial resolves its camera through the injected micrio element
		const el = createElement(DIAL_TAG, {
			setProps: { currentRotation: 0, frames: 36 },
			parent: document.body,
		}) as MicrioElement
		expect(el.querySelector('svg, canvas, div')).toBeNull()
		el.remove()
	})

	it('turns while dragging and reports whole frames', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		// The dial captures the pointer, which a synthetic event cannot do on its own
		const captured: number[] = []
		viewer.el.setPointerCapture = (id: number) => {
			captured.push(id)
		}
		viewer.el.releasePointerCapture = (id: number) => {
			captured.push(-id)
		}

		const turns: number[] = []
		// The dial measures itself to convert pixels to frames, so it needs a real width;
		// a custom element is inline by default, which would ignore the width
		const el = createElement(DIAL_TAG, {
			style: { display: 'block', width: '200px', height: '40px' },
			setProps: { currentRotation: 0, frames: 36, onturn: (frame: number) => turns.push(frame) },
			parent: viewer.el,
		}) as MicrioElement
		await settle(2)

		el.dispatchEvent(
			new PointerEvent('pointerdown', { pointerId: 7, clientX: 100, clientY: 0, button: 0, bubbles: true }),
		)
		// The element marks itself as panning for the duration of the drag
		expect(viewer.el.dataset.panning).toBe('')
		expect(captured).toEqual([7])

		// Dragging left by half the 200px dial at 36 frames lands halfway round
		viewer.el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 50, clientY: 0, bubbles: true }))
		expect(turns).toHaveLength(1)
		// (100px - 50px) / 200px * 36 frames
		expect(turns[0]).toBeCloseTo(9, 5)

		// Dragging back the other way moves the frame the other way
		viewer.el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 200, clientY: 0, bubbles: true }))
		expect(turns).toHaveLength(2)
		expect(turns[1]).toBeCloseTo(-18, 5)

		viewer.el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }))
		expect(viewer.el.dataset.panning).toBeUndefined()
		expect(captured).toEqual([7, -7])
		viewer.destroy()
	})

	it('ignores a non-primary button', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const onturn = vi.fn()
		const el = createElement(DIAL_TAG, {
			setProps: { currentRotation: 0, frames: 36, onturn },
			parent: viewer.el,
		}) as MicrioElement
		await settle(2)

		el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 100, button: 2, bubbles: true }))
		viewer.el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 0, bubbles: true }))
		expect(onturn).not.toHaveBeenCalled()
		viewer.destroy()
	})

	it('reports nothing while it has no measurable width', async () => {
		// The dial must not divide by a zero width and hand the caller a non-finite frame. The
		// width is pinned to zero *in the test* rather than left to the stylesheet being stubbed
		// (which is how it used to hold): that made the test state its own precondition, so a
		// measurement that landed differently under load reported a turn and failed.
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		viewer.el.setPointerCapture = () => {}
		viewer.el.releasePointerCapture = () => {}
		const onturn = vi.fn()
		const el = createElement(DIAL_TAG, {
			setProps: { currentRotation: 0, frames: 36, onturn },
			parent: viewer.el,
		}) as MicrioElement
		el.style.cssText = 'display: block; width: 0; height: 40px;'
		await settle(2)
		expect(el.offsetWidth).toBe(0)

		el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, clientX: 100, button: 0, bubbles: true }))
		viewer.el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: 0, bubbles: true }))
		// Settle before asserting nothing, so a deferred report cannot slip past the assertion
		await settle(2)
		expect(onturn).not.toHaveBeenCalled()
		viewer.destroy()
	})

	it('reports nothing when the viewer itself has no measurable width', async () => {
		// The guard's other operand: the frame maths divides by the dial's width *and* scales by
		// the viewer's, so an unsized host has to be refused for the same reason.
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		viewer.el.setPointerCapture = () => {}
		viewer.el.releasePointerCapture = () => {}
		const onturn = vi.fn()
		const el = createElement(DIAL_TAG, {
			setProps: { currentRotation: 0, frames: 36, onturn },
			parent: viewer.el,
		}) as MicrioElement
		el.style.cssText = 'display: block; width: 200px; height: 40px;'
		await settle(2)
		vi.spyOn(viewer.el, 'offsetWidth', 'get').mockReturnValue(0)

		el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, clientX: 100, button: 0, bubbles: true }))
		viewer.el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 5, clientX: 0, bubbles: true }))
		await settle(2)
		expect(onturn).not.toHaveBeenCalled()
		viewer.destroy()
	})

	it('offsets itself from the current rotation', async () => {
		const ui = uiBundle()
		const { viewer } = await openUi(ui)
		const el = createElement(DIAL_TAG, {
			setProps: { currentRotation: 180, frames: 36 },
			parent: viewer.el,
		}) as MicrioElement
		await settle(2)
		el._setProps({ currentRotation: 90 })
		expect(el.style.getPropertyValue('--micrio-dial-offset')).toContain('px')
		viewer.destroy()
	})
})
