import { afterEach, describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { restoreArchiveXhr } from '../../fixtures/grid'
import { destroyOmni, omniFixture, openOmni } from '../../fixtures/omni'
import type { OpenOmni } from '../../fixtures/omni'
import type { Viewer } from '../../helpers/viewer'
import { mountViewer } from '../../helpers/viewer'
import { settle } from '../../helpers/tour'

/**
 * Omni (3D rotatable object) viewing: the frame strip the UI builds, the dial,
 * the layer menu and the swipe gesture, plus what teardown resets.
 */

const extraViewers: Viewer[] = []

afterEach(() => {
	destroyOmni()
	for (const viewer of extraViewers.splice(0)) {
		viewer.destroy()
	}
	restoreArchiveXhr()
})

/** The dial and canvas drags capture the pointer, which a synthetic event cannot do. */
function stubCapture(viewer: Viewer): void {
	viewer.el.setPointerCapture = () => {}
	viewer.el.releasePointerCapture = () => {}
}

/** Gives the dial a measurable width, so its rotation offset is observable. */
function sizeDial(omni: OpenOmni, width = 200): HTMLElement {
	const { dial } = omni
	if (!dial) {
		throw new Error('no dial')
	}
	dial.style.display = 'block'
	dial.style.width = `${width}px`
	return dial
}

function dialOffset(dial: HTMLElement): number {
	return Number.parseFloat(dial.style.getPropertyValue('--micrio-dial-offset'))
}

describe('omni — setup', () => {
	it('marks the image as omni and builds one engine frame per rotation frame', async () => {
		const omni = await openOmni({ frames: 24 })
		expect(omni.image._isOmni).toBe(true)
		expect(omni.image.$settings.omni?.frames).toBe(24)
		expect(omni.dial).not.toBeNull()
		// One embedded frame per rotation frame, with the first active
		expect(omni.image.canvas?.images).toHaveLength(24)
		expect(omni.image.canvas?._activeImageIdx).toBe(0)
		expect(omni.omni.currentIndex).toBe(0)
	})

	it('applies the omni camera settings to the canvas', async () => {
		const omni = await openOmni({ frames: 12, distance: 4, fieldOfView: 0.7, verticalAngle: 0.2, offsetX: 0.1 })
		const { canvas } = omni.image
		// The distance is negated: the camera sits in front of the object
		expect(canvas?._omniDistance).toBe(-4)
		expect(canvas?._omniFieldOfView).toBeCloseTo(0.7, 6)
		expect(canvas?._omniVerticalAngle).toBeCloseTo(0.2, 6)
		expect(canvas?._omniOffsetX).toBeCloseTo(0.1, 6)
	})

	it('hooks the swipe engine flags while the omni UI is live', async () => {
		const omni = await openOmni({ frames: 12 })
		expect(omni.viewer.el._engine._noPinchPan).toBe(true)
		expect(omni.viewer.el._engine._isSwipe).toBe(true)
	})

	it('builds the dial even when the bundle is older than v5', async () => {
		// `setup` only awaits the archive load for a v5+ bundle; the dial is built either way
		const omni = await openOmni({ frames: 12, version: '4.0' })
		expect(omni.dial).not.toBeNull()
		expect(omni.image.omni).toBe(omni.omni)
	})

	it('does not set up omni when the bundle was opened as an object', async () => {
		// `setup` reads the bundle back out of the fetch cache, which the object path
		// never fills — so `open(bundle)` shows the first frame and no omni UI at all
		const fixture = omniFixture({ frames: 12 })
		const viewer = mountViewer()
		extraViewers.push(viewer)
		await viewer.open(fixture.image)
		await settle(3)

		expect(viewer.el.$current?._isOmni).toBe(true)
		expect(viewer.el.$current?.omni).toBeUndefined()
		expect(viewer.el.querySelector('micrio-dial')).toBeNull()
	})
})

describe('omni — rotation', () => {
	it('turns to a frame and wraps around the ends', async () => {
		const omni = await openOmni({ frames: 36 })
		const dial = sizeDial(omni)

		omni.omni.goto(9)
		expect(omni.omni.currentIndex).toBe(9)
		expect(omni.image.canvas?._activeImageIdx).toBe(9)
		// The dial is driven from the frame: 9/36 turns = 90deg of a 200px dial
		expect(dialOffset(dial)).toBeCloseTo(-50, 3)

		// A negative frame wraps forward
		omni.omni.goto(-1)
		expect(omni.omni.currentIndex).toBe(35)
		expect(dialOffset(dial)).toBeCloseTo(-(350 / 360) * 200, 3)

		// Exactly one full turn is frame 0
		omni.omni.goto(36)
		expect(omni.omni.currentIndex).toBe(0)
	})

	it('turns with a shift-drag on the canvas', async () => {
		// A single pointer only drives the omni while the object is fully zoomed out
		// (`#isFullWidth`, which a *change* of `state.view` sets) or while shift is
		// held — so shift is the deterministic path here
		const omni = await openOmni({ frames: 36 })
		stubCapture(omni.viewer)
		const canvas = omni.viewer.el.canvas.element

		canvas.dispatchEvent(
			new PointerEvent('pointerdown', {
				pointerId: 3,
				clientX: 400,
				clientY: 300,
				button: 0,
				shiftKey: true,
				bubbles: true,
			}),
		)
		expect(omni.viewer.el.dataset.panning).toBe('')
		// The move that crosses the threshold re-arms the gesture (it resets
		// `#startX` to its own clientX), so the delta is only computed from the
		// *next* move on
		omni.viewer.el.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 3, clientX: 200, clientY: 300, shiftKey: true, bubbles: true }),
		)
		expect(omni.omni.currentIndex).toBe(0)
		omni.viewer.el.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 3, clientX: 50, clientY: 300, shiftKey: true, bubbles: true }),
		)
		expect(omni.omni.currentIndex).not.toBe(0)

		omni.viewer.el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientX: 50, bubbles: true }))
		expect(omni.viewer.el.dataset.panning).toBeUndefined()
	})

	it('ignores a three-pointer gesture', async () => {
		const omni = await openOmni({ frames: 36 })
		stubCapture(omni.viewer)
		const canvas = omni.viewer.el.canvas.element

		const down = (pointerId: number) =>
			canvas.dispatchEvent(
				new PointerEvent('pointerdown', {
					pointerId,
					clientX: 400,
					clientY: 300,
					button: 0,
					shiftKey: true,
					bubbles: true,
				}),
			)
		down(1)
		down(2)
		down(3)
		// The third pointer clears the gesture and unhooks the move listener
		omni.viewer.el.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 1, clientX: 50, clientY: 300, shiftKey: true, bubbles: true }),
		)
		expect(omni.omni.currentIndex).toBe(0)
	})
})

describe('omni — layers', () => {
	it('splits the frames across the layers and starts on layerStartIndex', async () => {
		const omni = await openOmni({ frames: 36, layers: 3, layerStartIndex: 1 })
		expect(omni.image.canvas?._omniNumLayers).toBe(3)
		expect(omni.image.canvas?.layer).toBe(1)
		expect(get(omni.image.state.layer)).toBe(1)
	})

	it('prints a layer menu that swaps the current layer in and out', async () => {
		const omni = await openOmni({ frames: 36, layers: 2, layerStartIndex: 1 })
		const menu = () => (omni.image.$data?.pages ?? []).find((p) => p.id?.startsWith('_omni-layers'))

		// The menu names the current layer and offers every other one
		expect(menu()?.id).toBe('_omni-layers-1')
		expect(menu()?.children?.map((p) => p.id)).toEqual(['omni-layer-0'])

		// Choosing a layer moves the object and reprints the menu for the new layer
		menu()?.children?.[0]?.action?.()
		expect(get(omni.image.state.layer)).toBe(0)
		await settle(2)
		expect(menu()?.id).toBe('_omni-layers-0')
		expect(menu()?.children?.map((p) => p.id)).toEqual(['omni-layer-1'])
	})

	it('drives the canvas layer and the dial from the layer store', async () => {
		const omni = await openOmni({ frames: 36, layers: 2 })
		const dial = sizeDial(omni, 180)

		omni.image.state.layer.set(1)
		expect(omni.image.canvas?.layer).toBe(1)
		// Pinned as-is: the layer subscription feeds the *layer index* into the
		// frame-based dial rotation, so layer 1 of 2 reads as 1/18 of a turn
		// (20deg), not the half turn the layer names
		expect(dialOffset(dial)).toBeCloseTo(-10, 3)

		omni.image.state.layer.set(0)
		expect(omni.image.canvas?.layer).toBe(0)
		expect(dialOffset(dial)).toBeCloseTo(0, 3)
	})

	it('adds no layer menu for a single-layer object', async () => {
		const omni = await openOmni({ frames: 12 })
		expect(omni.image.$data?.pages?.some((p) => p.id?.startsWith('_omni-layers')) ?? false).toBe(false)
	})

	it('pins the omni settings that are not wired up yet', async () => {
		// `noDial`, `noKeys`, `showDegrees`, `frontIndex`, `twoAxes` and the omni
		// `startIndex` are read nowhere, so they change nothing observable: the dial
		// is still built and frame 0 is still active
		const omni = await openOmni({
			frames: 36,
			omni: { noDial: true, noKeys: true, showDegrees: true, frontIndex: 5, twoAxes: true, startIndex: 7 },
		})
		expect(omni.dial).not.toBeNull()
		expect(omni.omni.currentIndex).toBe(0)
	})
})

describe('omni — teardown', () => {
	it('resets the swipe flags when the viewer is destroyed', async () => {
		const omni = await openOmni({ frames: 12 })
		expect(get(omni.image.state.layer)).toBe(0)

		destroyOmni()
		expect(omni.viewer.el.$current).toBeUndefined()
		expect(omni.viewer.el._engine._noPinchPan).toBe(false)
		expect(omni.viewer.el._engine._isSwipe).toBe(false)
		expect(omni.viewer.el.querySelector('micrio-dial')).toBeNull()
	})
})
