import { describe, expect, it } from 'vitest'
import { OrbitCamera } from '$book/core/orbit-camera'
import { Vec3 } from '$book/core/vec3'

/** The angle between two directions, for asserting on the pick-ray fan. */
function angleBetween(a: Vec3, b: Vec3): number {
	return Math.acos(Math.min(1, a._x * b._x + a._y * b._y + a._z * b._z))
}

/** Runs the smoothing until it settles. */
function settle(cam: OrbitCamera, steps = 3000): void {
	for (let i = 0; i < steps; i++) {
		cam._update(1 / 60)
	}
}

/**
 * Mirrors the private phi floor the eye is actually built from, so a test can
 * assert on the eye without blindly re-implementing the formula.
 */
function effectivePhi(cam: OrbitCamera): number {
	if (cam._freeCamMode) {
		return cam._phi
	}
	const t = (cam._radius - cam._minRadius) / (cam._maxRadius - cam._minRadius)
	return Math.max((1 - t * t) * (Math.PI / 3), cam._phi)
}

/**
 * Sets the current pose and snaps the private targets onto it.
 *
 * Assert on the *result* of a follow-up `_zoom`/`_rotate` rather than on the
 * current field here: `_zoom` writes the private target, and the public radius
 * only follows on the next `_update`.
 */
function setPose(cam: OrbitCamera, theta: number, radius?: number): void {
	if (radius !== undefined) {
		cam._radius = radius
	}
	cam._snap()
	cam._theta = theta
	cam._snap()
}

describe('OrbitCamera — smoothing', () => {
	it('is at rest after a snap of an untouched camera', () => {
		const cam = new OrbitCamera()
		cam._snap()
		expect(cam._isMoving()).toBe(false)
	})

	it('reports movement as soon as a target changes, and settles back down', () => {
		const cam = new OrbitCamera()
		cam._snap()
		cam._rotate(100, 0)
		expect(cam._isMoving()).toBe(true)
		settle(cam)
		expect(cam._isMoving()).toBe(false)
	})

	it('approaches the target exponentially, never overshooting', () => {
		const cam = new OrbitCamera()
		cam._snap()
		cam._rotate(100, 0)
		const target = cam._theta + 100 * cam._rotateSpeed
		const before = cam._theta
		cam._update(1 / 60)
		expect(cam._theta).toBeGreaterThan(before)
		expect(cam._theta).toBeLessThan(target)
		settle(cam)
		expect(cam._theta).toBeCloseTo(target, 5)
	})

	it('does not move at all for a zero-length step', () => {
		const cam = new OrbitCamera()
		cam._snap()
		cam._rotate(50, 50)
		const theta = cam._theta
		cam._update(0)
		expect(cam._theta).toBe(theta)
	})
})

describe('OrbitCamera — eye', () => {
	it('places the eye on a sphere of the radius around the target', () => {
		const cam = new OrbitCamera()
		cam._target._set(1, 2, 3)
		setPose(cam, 0)
		settle(cam)
		const eye = cam._getEye()
		expect(eye._x).toBeCloseTo(1, 6)
		// The eye is built from the effective (floored) phi, which here is phi itself
		const phi = effectivePhi(cam)
		expect(eye._z - 3).toBeCloseTo(cam._radius * Math.cos(phi), 6)
		expect(eye._y - 2).toBeCloseTo(cam._radius * Math.sin(phi), 6)
	})

	it('builds the eye from the effective phi at the minimum radius', () => {
		// At radius === minRadius the floor is pi/3 (the quadratic has no effect
		// there), so the eye is lifted to it even though phi itself is lower.
		const cam = new OrbitCamera()
		cam._minRadius = 0.6
		cam._maxRadius = 12
		cam._radius = 0.6
		cam._snap()
		expect(cam._radius).toBe(0.6)
		expect(cam._getEye()._y).toBeCloseTo(0.6 * Math.sin(effectivePhi(cam)), 6)
		expect(effectivePhi(cam)).toBeCloseTo(Math.PI / 3, 6)
	})

	it('raises the eye to the phi floor as the camera zooms out', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.6
		cam._maxRadius = 12
		cam._radius = 0.6
		cam._snap()
		const zoomedInY = cam._getEye()._y

		// A positive delta zooms out, toward the maximum radius where the floor lifts
		cam._zoom(1e6)
		expect(cam._isMoving()).toBe(true)
		settle(cam)
		expect(cam._radius).toBeCloseTo(12, 5)
		// The eye follows the (possibly floored) phi at the new radius
		expect(cam._getEye()._y).toBeCloseTo(12 * Math.sin(effectivePhi(cam)), 5)
		expect(cam._getEye()._y).toBeGreaterThan(zoomedInY)
	})

	it('ignores the phi floor in free-cam mode', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.6
		cam._maxRadius = 4.5
		cam._radius = 4.5
		cam._setFreeCamMode(true)
		cam._snap()
		// phi is left alone, where the clamped mode would have raised it to pi/3
		expect(effectivePhi(cam)).toBe(cam._phi)
		expect(cam._getEye()._y).toBeCloseTo(4.5 * Math.sin(cam._phi), 6)
	})

	it('caps phi and radius when free-cam mode is switched off', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.5
		cam._maxRadius = 2
		cam._setFreeCamMode(true)
		cam._radius = 9
		cam._snap()
		cam._setFreeCamMode(false)
		settle(cam)
		expect(cam._radius).toBeLessThanOrEqual(2 + 1e-9)
		expect(cam._phi).toBeLessThanOrEqual(Math.PI * 0.49 + 1e-9)
		expect(cam._manualZoomActive).toBe(true)
	})
})

describe('OrbitCamera — rotate', () => {
	it('adds a scaled delta to the target angles', () => {
		const cam = new OrbitCamera()
		cam._snap()
		const phi = cam._phi
		cam._rotate(0, 20)
		settle(cam)
		expect(cam._phi).toBeCloseTo(phi + 20 * cam._rotateSpeed, 6)

		// theta is unbounded, so the full delta passes through
		const theta = cam._theta
		cam._rotate(10, 0)
		settle(cam)
		expect(cam._theta).toBeCloseTo(theta + 10 * cam._rotateSpeed, 6)
	})

	it('bounds phi into (0, 0.49π]', () => {
		const cam = new OrbitCamera()
		cam._snap()
		const cap = Math.PI * 0.49

		cam._rotate(0, -100000)
		settle(cam)
		// Clamped to the 0 floor, within float noise
		expect(cam._phi).toBeGreaterThan(0)
		expect(cam._phi).toBeLessThan(1e-6)

		cam._rotate(0, 100000)
		settle(cam)
		expect(cam._phi).toBeCloseTo(cap, 6)
	})

	it('can be told not to clamp phi', () => {
		const cam = new OrbitCamera()
		cam._snap()
		cam._rotate(0, 100000, false)
		settle(cam)
		expect(cam._phi).toBeGreaterThan(Math.PI * 0.49)
	})

	it('rotateViewStep snaps to the 90° grid before stepping', () => {
		const quarter = Math.PI / 2
		const cam = new OrbitCamera()

		// On-grid: it just steps
		setPose(cam, quarter)
		cam._rotateViewStep(1)
		settle(cam)
		expect(cam._theta).toBeCloseTo(quarter * 2, 6)

		// Off-grid: it snaps to the nearest grid point first
		setPose(cam, quarter * 2 + 0.2)
		cam._rotateViewStep(-1)
		settle(cam)
		expect(cam._theta).toBeCloseTo(quarter, 6)

		// Past the midpoint it rounds up instead: 2.6 quarters steps from 3 to 4
		setPose(cam, quarter * 2.6)
		cam._rotateViewStep(1)
		settle(cam)
		expect(cam._theta).toBeCloseTo(quarter * 4, 6)
	})
})

describe('OrbitCamera — zoom', () => {
	it('a negative delta brings the camera closer', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.6
		cam._maxRadius = 12
		setPose(cam, 0, 12)
		cam._zoom(-100)
		expect(cam._radius).toBe(12)
		expect(cam._isMoving()).toBe(true)
		settle(cam)
		expect(cam._radius).toBeCloseTo(12 - 100 * cam._zoomSpeed, 5)
		expect(cam._manualZoomActive).toBe(true)
	})

	it('a positive delta pushes the camera out again', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.6
		cam._maxRadius = 12
		setPose(cam, 0, 6)
		cam._zoom(100)
		settle(cam)
		expect(cam._radius).toBeCloseTo(6 + 100 * cam._zoomSpeed, 5)
	})

	it('never goes closer than the minimum radius', () => {
		const cam = new OrbitCamera()
		cam._snap()
		cam._zoom(-1e6)
		settle(cam)
		expect(cam._radius).toBeCloseTo(cam._minRadius, 5)
	})

	it('never goes further than the maximum radius, unless in free-cam mode', () => {
		const cam = new OrbitCamera()
		cam._radius = cam._maxRadius
		cam._snap()
		cam._zoom(1000)
		settle(cam)
		expect(cam._radius).toBeCloseTo(cam._maxRadius, 5)

		// In free-cam mode it may pass the maximum
		cam._setFreeCamMode(true)
		cam._zoom(1000)
		settle(cam)
		expect(cam._radius).toBeGreaterThan(cam._maxRadius)
	})

	it('sets the manual-zoom flag on a zoom in and clears it at the maximum again', () => {
		const cam = new OrbitCamera()
		cam._radius = 4
		cam._maxRadius = 12
		cam._snap()
		cam._zoom(-10)
		expect(cam._manualZoomActive).toBe(true)
		cam._zoom(10000)
		expect(cam._isMoving()).toBe(true)
		settle(cam)
		expect(cam._radius).toBeCloseTo(12, 5)
		expect(cam._manualZoomActive).toBe(false)
	})

	it('moves the target along the zoom when a hit point is given', () => {
		const cam = new OrbitCamera()
		cam._snap()
		// Zooming in (a negative delta) pulls the target toward the hit point
		cam._zoom(-100, new Vec3(2, 0, 0))
		settle(cam)
		expect(cam._target._x).toBeGreaterThan(0)
		expect(cam._target._x).toBeLessThan(2)

		// Zooming back out overshoots past the origin, because the scale is negative
		const out = new OrbitCamera()
		out._snap()
		out._zoom(100, new Vec3(2, 0, 0))
		settle(out)
		expect(out._target._x).toBeLessThan(0)
	})

	it('reports whether the camera is zoomed in through its pan directions', () => {
		const cam = new OrbitCamera()
		cam._canPanLeft = false
		cam._canPanRight = false
		cam._canPanUp = false
		cam._canPanDown = false
		expect(cam._isZoomedIn()).toBe(false)
		cam._canPanLeft = true
		expect(cam._isZoomedIn()).toBe(true)
	})
})

describe('OrbitCamera — pan', () => {
	it('does nothing when every direction is closed', () => {
		const cam = new OrbitCamera()
		cam._canPanLeft = false
		cam._canPanRight = false
		cam._canPanUp = false
		cam._canPanDown = false
		cam._snap()
		cam._pan(100, 100)
		settle(cam)
		expect(cam._target).toEqual(new Vec3(0, 0, 0))
	})

	it('zeroes a delta that is blocked in that direction', () => {
		const cam = new OrbitCamera()
		cam._canPanLeft = false
		cam._snap()
		// Negative deltaX is a rightward world move, which is blocked
		cam._pan(-100, 0)
		settle(cam)
		expect(cam._target._x).toBe(0)

		// The other direction still works
		cam._pan(100, 0)
		settle(cam)
		expect(cam._target._x).toBeLessThan(0)
	})

	it('moves the target in world units scaled by radius and field of view', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 100)
		cam._fov = Math.PI / 2
		setPose(cam, 0)
		const radius = cam._radius
		cam._pan(10, 0)
		settle(cam)
		// worldH = 2·radius·tan(fov/2) = 2·radius, so one pixel is 2·radius/100
		expect(cam._target._x).toBeCloseTo(-10 * ((2 * radius) / 100), 5)
	})

	it('clamps the target inside the pan bounds', () => {
		const cam = new OrbitCamera()
		cam._panBoundsMin = new Vec3(-1, -1, -1)
		cam._panBoundsMax = new Vec3(1, 1, 1)
		cam._snap()
		cam._pan(100000, 0)
		settle(cam)
		expect(cam._target._x).toBeGreaterThanOrEqual(-1)
		expect(cam._target._x).toBeLessThanOrEqual(1)
	})
})

describe('OrbitCamera — contain radius', () => {
	it('fits the page box inside the canvas, minus the margin', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.5
		cam._setCanvasSize(800, 600)
		cam._initContainRadius({ minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 }, 20)
		// limitW = 760, limitH = 560, with the default fov of pi/4
		const halfTan = Math.tan(cam._fov / 2)
		const rW = (2 * 600) / (2 * 760 * halfTan)
		const rH = (1 * 600) / (2 * 560 * halfTan)
		expect(cam._maxRadius).toBeCloseTo(Math.max(rW, rH, 0.5), 5)
		expect(cam._radius).toBeCloseTo(cam._maxRadius, 6)
		expect(cam._isMoving()).toBe(false)
	})

	it('falls back to the minimum radius for a degenerate box or canvas', () => {
		const cam = new OrbitCamera()
		cam._minRadius = 0.5
		cam._initContainRadius({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, 20)
		expect(cam._maxRadius).toBe(0.5)
	})
})

describe('OrbitCamera — viewport clamp', () => {
	it('closes every pan direction when the book fits the viewport', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 600)
		cam._clampViewport({ minX: 200, maxX: 600, minY: 100, maxY: 500 }, 800, 600, 20)
		expect(cam._canPanLeft).toBe(false)
		expect(cam._canPanRight).toBe(false)
		expect(cam._canPanUp).toBe(false)
		expect(cam._canPanDown).toBe(false)
		expect(cam._maxRadius).toBeGreaterThan(0)
	})

	it('opens the directions the content overflows, and keeps the others closed', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 600)
		// 1000 wide content in an 800 wide viewport, but fully inside vertically
		cam._clampViewport({ minX: -50, maxX: 950, minY: 200, maxY: 400 }, 800, 600, 20)
		expect(cam._canPanRight).toBe(true) // content starts left of the margin
		expect(cam._canPanLeft).toBe(true) // and extends past the right margin
		expect(cam._canPanUp).toBe(false)
		expect(cam._canPanDown).toBe(false)
	})

	it('only re-fits the radius when the user has not zoomed in manually', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 600)
		cam._snap()
		cam._manualZoomActive = true
		const radius = cam._radius
		cam._clampViewport({ minX: 400, maxX: 401, minY: 300, maxY: 301 }, 800, 600, 20)
		// The view is left where the user put it
		expect(cam._radius).toBe(radius)
	})
})

describe('OrbitCamera — pick ray', () => {
	it('starts at the eye and looks at the target for the screen centre', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 600)
		cam._snap()
		const eye = cam._getEye()
		const centre = cam._getPickRay(400, 300)
		expect(centre.origin).toEqual(eye)
		expect(Math.hypot(centre.direction._x, centre.direction._y, centre.direction._z)).toBeCloseTo(1, 6)
		const toTarget = new Vec3()._copy(cam._target)._sub(eye)._normalize()
		expect(centre.direction._x).toBeCloseTo(toTarget._x, 6)
		expect(centre.direction._y).toBeCloseTo(toTarget._y, 6)
		expect(centre.direction._z).toBeCloseTo(toTarget._z, 6)
	})

	it('fans the rays out by half the field of view at the screen edges', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 600)
		cam._fov = Math.PI / 2
		cam._snap()
		const centre = cam._getPickRay(400, 300).direction

		// tan(fov/2) = 1, so a screen edge is half the field of view away
		expect(angleBetween(centre, cam._getPickRay(400, 0).direction)).toBeCloseTo(Math.PI / 4, 6)
		expect(angleBetween(centre, cam._getPickRay(800, 300).direction)).toBeCloseTo(Math.atan(800 / 600), 6)
		// The two opposite corners fan out symmetrically
		expect(angleBetween(centre, cam._getPickRay(0, 600).direction)).toBeCloseTo(
			angleBetween(centre, cam._getPickRay(800, 0).direction),
			6,
		)
	})

	it('produces a unit direction for every screen position, including outside the canvas', () => {
		const cam = new OrbitCamera()
		cam._setCanvasSize(800, 600)
		cam._snap()
		for (const [x, y] of [
			[-100, -100],
			[0, 0],
			[400, 300],
			[1200, 900],
		]) {
			const { direction } = cam._getPickRay(x, y)
			expect(Math.hypot(direction._x, direction._y, direction._z)).toBeCloseTo(1, 6)
		}
	})
})

describe('OrbitCamera — degenerate radius range', () => {
	it('keeps the eye finite when minRadius equals maxRadius, which a small book can reach', () => {
		// `_initContainRadius` sets maxRadius to at least minRadius, so a book whose
		// box is small against the canvas lands on minRadius === maxRadius. The phi
		// floor used to divide by that zero range and turn the eye into NaN.
		const cam = new OrbitCamera()
		cam._minRadius = 0.6
		cam._maxRadius = 0.6
		cam._radius = 0.6
		cam._snap()
		const eye = cam._getEye()
		expect(Number.isFinite(eye._x)).toBe(true)
		expect(Number.isFinite(eye._y)).toBe(true)
		expect(Number.isFinite(eye._z)).toBe(true)
	})
})
