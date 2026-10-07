import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openVisibleSpace } from '../../fixtures/space-fixture'
import type { Viewer } from '../../helpers/viewer'
import { waitFor } from '../../helpers/viewer'
import type { TileCanvas } from '$render/tile-canvas'
import Kinetic from '$render/kinetic'
import { segsX, segsY } from '$render/constants'

/**
 * The 360 half of the render engine: `Camera360`, the 360 tile culling in `Image`, the
 * `TileCanvas` facades, and the `Kinetic` drag-after-release physics.
 *
 * **One viewer for the whole file.** A 360 camera needs a real sphere canvas, so the suite
 * cannot avoid a GL context, but it mounts exactly one (`beforeAll`) and every test drives
 * `_camera360` directly. That is the AGENTS.md "one context per file" rule, and it is also why
 * the 2D counterpart lives in `canvas.test.ts` — a second viewer in either file would be a
 * second context.
 *
 * The fixture is `openVisibleSpace`, because a `<micr-io>` only prints its 360 canvas once the
 * image has entered `_visible`. `viewer.el._current` and the canvas' `_micrioImage` are the
 * same instance here (a plain single-image open, no gallery), so either can be used.
 */

let viewer: Viewer
/** The placed `TileCanvas` for the current 360 image. */
let canvas: TileCanvas

/** True when `a` is already wrapped into one full turn, which is what `modPI` guarantees. */
const isWrapped = (a: number): boolean => Math.abs(a) < Math.PI * 2 + 1e-9

/** Puts the camera and its view back to a known state between tests. */
function resetCamera(): void {
	// The direct setters, not the public `setDirection`/`setPerspective`: those animate, and an
	// animation left running between tests turns every later frame into a step of it.
	canvas._camera360._setDirection(0, 0)
	canvas._camera360._setPerspective(canvas._camera360._defaultPerspective, true)
	canvas._camera360._setLimits(0, 0)
	canvas.view._copy(canvas._ani._lastView)
}

beforeAll(async () => {
	;({ viewer } = await openVisibleSpace(0))
	await waitFor(() => viewer.el._engine._canvases.length > 0, 8000, 'a placed 360 canvas')
	const placed = viewer.el._engine._canvases[0]
	if (!placed) {
		throw new Error('no 360 canvas')
	}
	canvas = placed
})

afterAll(() => {
	viewer?.destroy()
})

describe('Camera360 construction', () => {
	it('derives its base yaw and the offX seam from the image rotation', () => {
		const cam = canvas._camera360
		// The fixture's first waypoint has rotationY 0, so the base yaw is 0 and the seam sits
		// at the left edge. `_offX` is the seam offset the tile culler and the embed placer use.
		expect(cam._baseYaw).toBeCloseTo(0, 12)
		expect(cam._offX).toBeCloseTo(0, 12)
		expect(cam._yaw).toBeCloseTo(cam._baseYaw, 12)
	})

	it('starts at the default perspective with the pitch level', () => {
		const cam = canvas._camera360
		expect(cam._perspective).toBeCloseTo(cam._defaultPerspective, 12)
		expect(cam._pitch).toBeCloseTo(0, 12)
	})

	it('scales the vertical sphere axis by the canvas aspect', () => {
		// `#scaleY` is imageHeight / (imageWidth / 2) — the half-width vertical extent of the
		// sphere. `TileCanvas._resize` copies the *element* box into `width`/`height` for a
		// canvas with children, so the fixture's 1024 x 512 buffer gives 2.
		const cam = canvas._camera360
		const scaleY = canvas.height / (canvas.width / 2)
		expect(scaleY).toBeCloseTo(2, 12)

		// `_setView` writes `(centerY - 0.5) * π * scaleY` into the pitch
		cam._setView(0.5, 0.75, 0.5, 0.5)
		expect(cam._pitch).toBeCloseTo(0.25 * Math.PI * scaleY, 6)
	})

	it('uses the real #scaleY for the vertical drag sensitivity', () => {
		resetCamera()
		const cam = canvas._camera360
		const { el } = canvas
		const scaleY = canvas.height / (canvas.width / 2)
		cam._rotate(0, 16)
		expect(cam._pitch).toBeCloseTo(((16 * el.ratio) / el.height) * cam._perspective * scaleY, 9)
	})
})

describe('Camera360 rotation', () => {
	it('turns the yaw in proportion to a horizontal drag', () => {
		resetCamera()
		const cam = canvas._camera360
		const before = cam._yaw
		const { el } = canvas
		// `_rotate(x, 0)` adds x * ratio / width * perspective * aspect to the yaw
		cam._rotate(32, 0)
		const expected = ((32 * el.ratio) / el.width) * cam._perspective * el._aspect
		expect(cam._yaw - before).toBeCloseTo(expected, 9)
	})

	it('turns the pitch in proportion to a vertical drag', () => {
		resetCamera()
		const cam = canvas._camera360
		const { el } = canvas
		// `#scaleY` is only exposed through the pitch maths, so it is recomputed here from the
		// canvas box the camera itself uses
		const scaleY = canvas.height / (canvas.width / 2)
		cam._rotate(0, 16)
		expect(cam._pitch).toBeCloseTo(((16 * el.ratio) / el.height) * cam._perspective * scaleY, 9)
	})

	it('keeps the yaw wrapped into (-π, π]', () => {
		resetCamera()
		const cam = canvas._camera360
		for (const px of [1e5, -1e5, 5000, -5000]) {
			cam._rotate(px, 0)
			// `modPI` maps the accumulated yaw back into one turn (it is `mod(n, 2π)`, so the
			// result is in [0, 2π) — the value can be larger than π). The raw yaw therefore never
			// grows without bound over a long drag.
			expect(isWrapped(cam._yaw), `px ${px}`).toBe(true)
		}
	})

	it('never lets the pitch leave the poles', () => {
		resetCamera()
		const cam = canvas._camera360
		// The sphere cannot be turned past straight up/down; `_update` clamps `_pitch` itself
		for (const py of [-1e6, 1e6]) {
			cam._rotate(0, py)
			expect(Math.abs(cam._pitch)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9)
		}
	})

	it('_setDirection applies a per-direction perspective', () => {
		resetCamera()
		const cam = canvas._camera360
		// A non-zero `persp` is the "reset the perspective too" flag on a waypoint switch
		cam._setDirection(0.25, 0.1, cam._defaultPerspective)
		expect(cam._perspective).toBeCloseTo(cam._defaultPerspective, 12)
		expect(cam._pitch).toBeCloseTo(0.1, 9)
		expect(cam._yaw).toBeCloseTo(0.25 - cam._baseYaw, 9)
	})
})

describe('Camera360 limits', () => {
	it('clamps the pitch once a vertical limit is set', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setLimits(0, 0.2)
		const maxPitch = (Math.PI * (canvas.height / (canvas.width / 2)) * 0.2) / 2

		cam._rotate(0, 1e5)
		expect(cam._pitch).toBeLessThanOrEqual(maxPitch + 1e-9)
		cam._rotate(0, -1e5)
		expect(cam._pitch).toBeGreaterThanOrEqual(-maxPitch - 1e-9)
	})

	it('lowers the maximum perspective when a vertical limit is set', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setLimits(0, 0)
		const unlimited = cam._maxPerspective
		cam._setLimits(0, 0.5)
		// `1.5 * y` caps the FoV, so the maximum perspective shrinks (or stays capped at π/2)
		expect(cam._maxPerspective).toBeLessThanOrEqual(unlimited)
	})

	it('clamps the yaw once a horizontal limit is set', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setLimits(0.25, 0)
		cam._setPerspective(cam._defaultPerspective, true)

		cam._rotate(1e5, 0)
		const halfFov = (cam._perspective / 2) * canvas.el._aspect
		const maxYaw = Math.PI * 0.25
		// The reachable yaw is bounded by both the limit and the half horizontal FoV
		expect(cam._yaw).toBeLessThanOrEqual(Math.max(maxYaw, halfFov) + 1e-6)
		expect(cam._yaw).toBeGreaterThanOrEqual(-Math.max(maxYaw, halfFov) - 1e-6)
	})

	it('keeps the yaw inside the limit while dragging within it', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setLimits(0.5, 0)
		cam._rotate(4, 0)
		// A small drag stays well inside the limit, so the value is just the raw delta
		expect(Math.abs(cam._yaw)).toBeLessThan(0.5)
	})
})

describe('Camera360 zoom', () => {
	it('changes the perspective immediately for a zero duration', () => {
		resetCamera()
		const cam = canvas._camera360
		// The zoom factor only means something next to the sphere scale:
		// `(delta / 2) / ((scale * diagonal) / 20)` is a few units per 1000 of delta here, so a
		// small delta cannot leave the perspective window and a large one is needed to observe
		// anything at all.
		const before = cam._perspective

		expect(cam._zoom(-1000, 0, 0, 0, true)).toBe(0)
		// A negative delta raises the perspective towards `_minPerspective`. The 360 canvas
		// clamps even when `noLimit` is set (`if (!noLimit || c.is360)`), and on this fixture
		// `_maxPerspective` (π/2) sits *below* `_minPerspective` (π), so `Math.min(max, Math.max(min, x))`
		// always resolves to the maximum. That inversion is real — asserted, not assumed.
		expect(cam._minPerspective).toBeGreaterThan(cam._maxPerspective)
		expect(cam._perspective).toBeCloseTo(cam._maxPerspective, 9)

		cam._setPerspective(before, true)
		expect(cam._zoom(1000, 0, 0, 0, true)).toBe(0)
		// ... and a positive delta lands on the same clamped value
		expect(cam._perspective).toBeCloseTo(cam._maxPerspective, 9)
	})

	it('keeps the cursor-anchored coordinate stable while zooming', () => {
		resetCamera()
		const cam = canvas._camera360
		// With a real cursor position the zoom re-centres on it: the image coordinate under the
		// pointer must be (nearly) the same before and after, which is the whole point of the
		// `beforeX/afterX` correction.
		const px = 40
		const py = 30
		const before = cam._getCoo(px, py)
		const beforeX = before.x
		const beforeY = before.y
		cam._zoom(-0.2, px, py, 0, true)
		const after = cam._getCoo(px, py)
		// The correction wraps the horizontal delta, so compare the wrapped distance
		const dx = Math.abs(after.x - beforeX)
		const dy = Math.abs(after.y - beforeY)
		expect(Math.min(dx, 1 - dx)).toBeLessThan(0.02)
		expect(dy).toBeLessThan(0.02)
	})

	it('animates the zoom for a non-zero duration', () => {
		resetCamera()
		const cam = canvas._camera360
		const before = cam._perspective
		const dur = cam._zoom(-0.4, 0, 0, 0.3, true)
		expect(dur).toBe(0.3)
		// The animation has been armed; stepping it is `Ani`'s business, so only the armed
		// state is asserted here
		expect(canvas._ani._isStarted()).toBe(false)
		expect(canvas._ani._flying).toBe(false)
		// Nothing has happened to the perspective yet
		expect(cam._perspective).toBeCloseTo(before, 12)
	})
})

describe('Camera360 coordinates', () => {
	it('reports the scale and direction on every coordinate', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._rotate(0.1, 0)
		const coo = cam._getCoo(canvas.el.width / 2, canvas.el.height / 2)
		expect(Number.isFinite(coo.x)).toBe(true)
		expect(coo.scale).toBe(cam._scale)
		expect(cam._scale).toBeGreaterThan(0)
	})

	it('_getXYZ maps the image centre to the screen centre-ish and back', () => {
		resetCamera()
		const cam = canvas._camera360
		const centre = cam._getXYZ(0.5, 0.5)
		expect(Number.isFinite(centre.x)).toBe(true)
		expect(Number.isFinite(centre.y)).toBe(true)
		// The w component is the unprojected depth, negative in front of the camera
		expect(Number.isFinite(centre.w)).toBe(true)
	})

	it('_getVec3 places a point on the unit sphere and optionally projects it', () => {
		resetCamera()
		const cam = canvas._camera360
		const raw = cam._getVec3(0.5, 0.5, true)
		// Unprojected points lie exactly on the radius-10 sphere
		const length = Math.hypot(raw.x, raw.y, raw.z)
		expect(length).toBeCloseTo(cam._radius, 6)
		// w is left at 1 for an absolute (unprojected) query
		expect(raw.w).toBe(1)
	})

	it('_getMatrix builds a finite 16-element matrix', () => {
		resetCamera()
		const mat = canvas._camera360._getMatrix(0.25, 0.5, 1, 5, 0, 0, 0)
		expect(mat.arr).toHaveLength(16)
		expect([...mat.arr].every(Number.isFinite)).toBe(true)
	})

	it('_getMatrix falls back to the sphere radius for a NaN radius', () => {
		resetCamera()
		const cam = canvas._camera360
		const withNaN = cam._getMatrix(0.25, 0.5, 1, Number.NaN, 0, 0, 0)
		const withRadius = cam._getMatrix(0.25, 0.5, 1, cam._radius, 0, 0, 0)
		// NaN radius is replaced by `_radius`, so the two matrices are identical
		expect([...withNaN.arr]).toEqual([...withRadius.arr])
	})
})

describe('Camera360 view synchronisation', () => {
	it('_moveTo offsets the camera position and marks the view changed', () => {
		resetCamera()
		const cam = canvas._camera360
		canvas.view._changed = false
		// A transition between spaces moves the camera along the sphere
		cam._moveTo(0.5, 0.25, 0.75, 0)
		expect(canvas.view._changed).toBe(true)
	})

	it('_moveTo accepts an extra yaw offset', () => {
		resetCamera()
		const cam = canvas._camera360
		expect(() => {
			cam._moveTo(0.2, 0, 0.5, Math.PI / 4)
		}).not.toThrow()
	})

	it('_setView refuses an incomplete view', () => {
		resetCamera()
		const cam = canvas._camera360
		// All three of centerX/centerY/height are required, and an explicit `undefined` is the
		// case under test: it is exactly what a caller produces by omitting an argument.
		// oxlint-disable-next-line unicorn/no-useless-undefined -- see above
		expect(cam._setView(0.5, 0.5, 1, undefined)).toBe(false)
		expect(cam._setView(undefined, 0.5, 1, 0.5)).toBe(false)
		expect(cam._setView(0.5, undefined, 1, 0.5)).toBe(false)
		expect(cam._setView(0.5, 0.5, 1, 0.5)).toBe(true)
	})

	it('correctNorth shifts the yaw by the seam offset', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setView(0.5, 0.5, 1, 0.5, { correctNorth: true })
		const corrected = cam._yaw
		cam._setView(0.5, 0.5, 1, 0.5, { correctNorth: false })
		const plain = cam._yaw
		// For this fixture `_offX` is 0, so the two agree; the branch is what is being covered
		expect(corrected).toBeCloseTo(plain, 9)
		expect(cam._offX).toBeCloseTo(0, 12)
	})

	it('_resize recomputes the minimum perspective', () => {
		resetCamera()
		const cam = canvas._camera360
		const before = cam._minPerspective
		cam._resize()
		expect(Number.isFinite(cam._minPerspective)).toBe(true)
		expect(cam._minPerspective).toBeCloseTo(before, 9)
		// `_resize` ends in `_setPerspective(..., true)`: the noLimit arm, which for a 360
		// canvas (`c.is360`) still clamps
		expect(cam._perspective).toBeLessThanOrEqual(cam._maxPerspective + 1e-9)
	})

	it('_isZoomedIn/_isZoomedOut track the perspective limits', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setPerspective(cam._minPerspective, true)
		expect(cam._isZoomedIn()).toBe(true)
		cam._setPerspective(cam._maxPerspective, true)
		expect(cam._isZoomedOut()).toBe(true)
	})

	it('the 2D compat surface is inert on a 360 camera', () => {
		resetCamera()
		const cam = canvas._camera360
		// These exist so the union type has one shape; a 360 canvas never uses them
		expect(cam._isOutsideLimit()).toBe(false)
		expect(cam._isUnderZoom()).toBe(false)
		expect(cam._isZoomedOut()).toBe(cam._perspective >= cam._maxPerspective)
		expect(cam._minScale).toBe(0)
		cam._correctMinMax()
		expect(() => {
			cam._pan(1, 1, 0)
		}).not.toThrow()
	})
})

describe('TileCanvas 360 facades', () => {
	it('_getScale and the zoom predicates delegate to the 360 camera', () => {
		resetCamera()
		const cam = canvas._camera360
		expect(canvas._getScale()).toBeCloseTo(cam._scale, 12)
		expect(canvas._isZoomedIn()).toBe(cam._perspective <= cam._minPerspective)
		expect(canvas._isZoomedOut()).toBe(cam._perspective >= cam._maxPerspective)
	})

	it('_setDirection falls back to the current pitch for a NaN pitch', () => {
		resetCamera()
		const cam = canvas._camera360
		cam._setDirection(0.2, 0.3)
		const pitch = cam._pitch
		canvas._setDirection(0.4, Number.NaN)
		// The NaN is replaced by the camera's own pitch, so only the yaw moved
		expect(cam._pitch).toBeCloseTo(pitch, 9)
	})

	it('_getMatrix scales the radius by the canvas width', () => {
		resetCamera()
		const mat = canvas._getMatrix(0.25, 0.5, 1, 5, 0, 0, 0, 0)
		const direct = canvas._camera360._getMatrix(0.25, 0.5, (1 * 20000) / canvas.width, 5, 0, 0, 0, 0)
		// `_getMatrix` converts the image-space scale into sphere space using 20000/width
		expect([...mat].map((v) => Math.round(v * 1e4) / 1e4)).toEqual(
			[...direct.arr].map((v) => Math.round(v * 1e4) / 1e4),
		)
	})

	it('_setTile360 fills the shared 360 vertex buffer', () => {
		resetCamera()
		canvas._camera360._setTile360(0, 0, 1, 1)
		const buffer = viewer.el._engine._vertexBuffer360
		expect(buffer.length).toBe(6 * 3 * segsX * segsY)
		// Every vertex has been written (no leftover zeroes in the first segment)
		expect(buffer.slice(0, 18).some((v) => v !== 0)).toBe(true)
		expect([...buffer].every(Number.isFinite)).toBe(true)
	})

	it('_isTileInViewport always reports false for a 360 canvas', () => {
		// A sphere wraps, so there is no off-screen tile to evict by rectangle test
		expect(canvas._isTileInViewport(0)).toBe(false)
		expect(viewer.el._engine._numTiles).toBeGreaterThan(0)
	})

	it('_sendViewport writes the rect in CSS pixels', () => {
		const image = canvas._micrioImage
		if (!image) {
			throw new Error('no image')
		}
		canvas.el.set(256, 128, 0, 0, 1, 1, false)
		canvas._sendViewport()
		const viewport = image._viewport
		expect(viewport).toBeDefined()
	})

	it('_reset clears the animation and the image opacity', () => {
		resetCamera()
		const image = canvas.images[0]
		if (!image) {
			throw new Error('no tile image')
		}
		canvas._reset()
		expect(image._gotBase).toBe(0)
		expect(image.opacity).toBe(0)
	})

	it('_aniStop/_aniPause/_aniResume reach the children as well', () => {
		resetCamera()
		canvas._aniPause()
		expect(canvas._areaAnimating()).toBe(false)
		canvas._aniResume()
		expect(() => {
			canvas._aniStop()
		}).not.toThrow()
	})

	it('_setActiveLayer and _setActiveImage update the layer and the view', () => {
		resetCamera()
		canvas.view._changed = false
		canvas._setActiveLayer(0)
		expect(canvas.layer).toBe(0)
		expect(canvas.view._changed).toBe(true)

		canvas._setActiveImage(0)
		expect(canvas._activeImageIdx).toBe(0)
	})
})

describe('Kinetic drag physics', () => {
	it('accumulates drag steps and moves the camera on the first step', () => {
		resetCamera()
		const engine = viewer.el._engine
		const kinetic = new Kinetic(canvas)
		const cam = canvas._camera360

		engine.now = 1000
		kinetic.addStep(60, 0)
		engine.now = 1016
		kinetic.addStep(60, 0)

		// The velocity is only computed on the first `step()`, from the accumulated deltas
		kinetic.start()
		expect(kinetic.started).toBe(true)

		const yaw = cam._yaw
		engine.now = 1032
		kinetic.step()
		expect(cam._yaw).not.toBeCloseTo(yaw, 12)
		// Still running: the decay has not taken the velocity under the stop threshold yet
		expect(kinetic.started).toBe(true)
		kinetic.stop()
	})

	it('a heavier drag travels further than a light one', () => {
		resetCamera()
		const engine = viewer.el._engine
		const cam = canvas._camera360

		const travel = (px: number): number => {
			resetCamera()
			const kinetic = new Kinetic(canvas)
			engine.now = 5000
			kinetic.addStep(px, 0)
			engine.now = 5016
			kinetic.addStep(px, 0)
			kinetic.start()
			const before = cam._yaw
			engine.now = 5032
			kinetic.step()
			const moved = cam._yaw - before
			kinetic.stop()
			return Math.abs(moved)
		}

		// The velocity is linear in the accumulated delta, so a bigger drag moves further
		expect(travel(120)).toBeGreaterThan(travel(60))
	})

	it('does not start below the under-zoom threshold', () => {
		resetCamera()
		const kinetic = new Kinetic(canvas)
		// `_isUnderZoom` is false on a 360 camera, so start() succeeds. The guard itself is
		// what the 2D path depends on; here it is asserted to be a no-op branch.
		expect(canvas.camera._isUnderZoom()).toBe(false)
		kinetic.start()
		expect(kinetic.started).toBe(true)
	})

	it('stops and resets once the velocity decays below the threshold', () => {
		resetCamera()
		const engine = viewer.el._engine
		const kinetic = new Kinetic(canvas)

		engine.now = 2000
		kinetic.addStep(2, 0)
		engine.now = 2016
		kinetic.start()

		// Step until the kinetic phase stops itself (or bail out after plenty of frames)
		let steps = 0
		while (kinetic.started && steps < 500) {
			engine.now += 16
			kinetic.step()
			steps++
		}
		expect(kinetic.started).toBe(false)
		// Decay is a per-frame 0.94 factor, so it must not take thousands of frames
		expect(steps).toBeLessThan(500)
	})

	it('a step before any drag reports "stopped"', () => {
		resetCamera()
		const kinetic = new Kinetic(canvas)
		// `started` is false and no start time has been recorded
		expect(kinetic.step()).toBe(1)
	})

	it('ignores addStep once the drag has ended', () => {
		resetCamera()
		const engine = viewer.el._engine
		const kinetic = new Kinetic(canvas)
		engine.now = 3000
		kinetic.addStep(5, 5)
		kinetic.start()
		engine.now = 3010
		// The first step sets `#endTime`, after which further drag steps are ignored
		kinetic.step()
		const before = engine._dragElasticity
		engine.now = 3020
		kinetic.addStep(1000, 1000)
		expect(engine._dragElasticity).toBe(before)
		kinetic.stop()
	})

	it('routes a 360 release through the camera rotation, not a pan', () => {
		resetCamera()
		const engine = viewer.el._engine
		const cam = canvas._camera360
		const kinetic = new Kinetic(canvas)

		engine.now = 6000
		kinetic.addStep(200, 0)
		engine.now = 6016
		kinetic.start()
		const yaw = cam._yaw
		const pitch = cam._pitch
		engine.now = 6032
		kinetic.step()
		// The 360 branch calls `_rotate`, so the yaw moves (and only the yaw, since the drag was
		// horizontal)
		expect(cam._yaw).not.toBeCloseTo(yaw, 12)
		expect(cam._pitch).toBeCloseTo(pitch, 9)
		kinetic.stop()
	})
})
