import { describe, expect, it } from 'vitest'
import { Coordinates, DrawRect, View, Viewport } from '$render/shared'
import type { TileCanvas } from '$render/tile-canvas'

/**
 * `src/render/shared.ts` is the geometry substrate the whole engine sits on: the logical
 * `View` rectangle, the `Coordinates` payload a camera hands out, and the `Viewport` the
 * canvas reports. None of it needs WebGL or a DOM, so it lives in the `core` project.
 *
 * `View` reads exactly four things off its owning canvas — `is360`, `width`, `height` and
 * `el`, plus `_camera2d._minScale/_maxScale/_minSize` inside `_limit`. A literal with those
 * members is the whole harness; the cast is how the suite stays off the render loop.
 */
function view(canvas: Record<string, unknown> = {}): View {
	// The stub is assembled as a plain record and cast once: `View` reads only `is360`,
	// `width`, `height`, `el` and `_camera2d._minScale/_maxScale/_minSize`, and spelling out
	// the whole `TileCanvas` (or its `Camera2D`) would be noise, not coverage.
	const base = {
		is360: false,
		width: 1000,
		height: 500,
		el: { width: 1000, height: 500 },
		_camera2d: { _minScale: 1, _maxScale: 4, _minSize: 1 },
		...canvas,
	} as unknown as TileCanvas
	return new View(base)
}

describe('View', () => {
	it('derives its edges from the centre and size', () => {
		const v = view()
		v.set(0.5, 0.5, 0.5, 0.25)
		expect(v.x0).toBeCloseTo(0.25, 12)
		expect(v.y0).toBeCloseTo(0.375, 12)
		expect(v.x1).toBeCloseTo(0.75, 12)
		expect(v.y1).toBeCloseTo(0.625, 12)
		expect(v.aspect).toBeCloseTo(2, 12)
	})

	it('exposes x0/x1 as measured edges, not wrapped ones', () => {
		// The wrapping happens only for 360, so a view that runs off the image keeps its
		// out-of-range edges: `_limit` is what pulls it back.
		const v = view()
		v.set(0.1, 0.5, 1, 1)
		expect(v.x0).toBeCloseTo(-0.4, 12)
		expect(v.x1).toBeCloseTo(0.6, 12)
	})

	it('wraps x0 and x1 for a 360 canvas', () => {
		const v = view({ is360: true })
		v.set(0.05, 0.5, 0.4, 0.4)
		// 0.05 - 0.2 = -0.15 -> 0.85; a naive left edge would be negative
		expect(v.x0).toBeCloseTo(0.85, 12)
		expect(v.x1).toBeCloseTo(0.25, 12)
	})

	it('keeps the arr view in sync, and only recomputes when dirty', () => {
		const v = view()
		v.set(0.25, 0.75, 0.5, 0.5)
		const { arr } = v
		expect([...arr]).toEqual([0.25, 0.75, 0.5, 0.5])
		// The same Float64Array instance is handed back every time
		expect(v.arr).toBe(arr)

		v._centerX = 0.9
		// `_centerX` is written directly, so `arr` is stale until something marks it dirty
		expect(v.arr[0]).toBe(0.25)
		v.set(0.9, 0.75, 0.5, 0.5)
		expect(v.arr[0]).toBe(0.9)
	})

	it('marks the view changed on set and on limit', () => {
		const v = view()
		v._changed = false
		v._limitChanged = false
		v.set(0.4, 0.4, 0.2, 0.2)
		expect(v._changed).toBe(true)
		expect(v._limitChanged).toBe(false)

		v._changed = false
		v._setLimit(0.5, 0.5, 0.5, 0.5)
		expect(v._changed).toBe(true)
		expect(v._limitChanged).toBe(true)
	})

	it('reports the limit edges from the limit centre and size', () => {
		const v = view()
		v._setLimit(0.4, 0.6, 0.5, 0.25)
		expect(v.lX0).toBeCloseTo(0.15, 12)
		expect(v.lY0).toBeCloseTo(0.475, 12)
		expect(v.lX1).toBeCloseTo(0.65, 12)
		expect(v.lY1).toBeCloseTo(0.725, 12)
	})

	it('preserveAspect widens the height only when the target is much flatter', () => {
		// `set(..., true)` compares against the *current* aspect and only fires when the new
		// width/height is more than 1.5x flatter and narrower than what is there.
		const wide = view()
		wide.set(0.5, 0.5, 1, 0.5)
		wide.set(0.5, 0.5, 0.5, 0.01, true)
		// cAr = 2, width/height = 50 > 3 and 0.5 < 1, so height is recomputed to 0.25
		expect(wide.height).toBeCloseTo(0.25, 12)
		expect(wide.width).toBeCloseTo(0.5, 12)

		const tall = view()
		tall.set(0.5, 0.5, 0.5, 1)
		tall.set(0.5, 0.5, 0.4, 0.2, true)
		// cAr = 0.5, width/height = 2 > 0.75, so the height is stretched to 0.4 / 0.5 = 0.8
		expect(tall.height).toBeCloseTo(0.8, 12)
		expect(tall.width).toBeCloseTo(0.4, 12)
	})

	it('preserveAspect does not fire for a wider rect than the current one', () => {
		const v = view()
		v.set(0.5, 0.5, 0.5, 0.5)
		v.set(0.5, 0.5, 1, 0.01, true)
		// `width < this.width` is false (1 is not < 0.5), so the height is left alone
		expect(v.height).toBeCloseTo(0.01, 12)
	})

	it('_copy mirrors a view, and can skip the limits', () => {
		const from = view()
		from.set(0.2, 0.3, 0.4, 0.5)
		from._setLimit(0.5, 0.5, 0.2, 0.2)

		const all = view()
		all._copy(from)
		expect([all._centerX, all._centerY, all.width, all.height]).toEqual([0.2, 0.3, 0.4, 0.5])
		expect([all._lCenterX, all._lCenterY, all._lWidth, all._lHeight]).toEqual([0.5, 0.5, 0.2, 0.2])

		const noLimit = view()
		noLimit._copy(from, true)
		expect([noLimit._centerX, noLimit._centerY, noLimit.width, noLimit.height]).toEqual([0.2, 0.3, 0.4, 0.5])
		// The limit stays at its constructor default
		expect([noLimit._lCenterX, noLimit._lWidth]).toEqual([0.5, 1])
	})

	describe('_limit', () => {
		it('snaps back to the limit centre when zoomed out past _minScale', () => {
			// `_minSize < 1 && scale < _minScale` is the under-zoom corner: the view resets to
			// the image centre and is clamped to `1 / _minSize` in both axes.
			const v = view({ _camera2d: { _minScale: 2, _maxScale: 4, _minSize: 0.5 } })
			v.set(0.9, 0.9, 0.8, 0.8)
			v._limit(false)
			// scale = 1 / max(0.8, 0.8) = 1.25 < 2, so the snap-back fires
			expect(v._centerX).toBeCloseTo(0.5, 12)
			expect(v._centerY).toBeCloseTo(0.5, 12)
			// mWH = 1 / 0.5 = 2; nW/nH are `Math.min(2, width)` so both stay 0.8
			expect(v.width).toBeCloseTo(0.8, 12)
			expect(v.height).toBeCloseTo(0.8, 12)
		})

		it('clamps the size to 1 / _minSize', () => {
			const v = view({ _camera2d: { _minScale: 2, _maxScale: 4, _minSize: 0.25 } })
			v.set(0.5, 0.5, 8, 8)
			v._limit(false)
			// scale = 0.125 < 2, mWH = 4, so the 8x8 view is pulled in to 4x4
			expect(v.width).toBeCloseTo(4, 12)
			expect(v.height).toBeCloseTo(4, 12)
		})

		it('does not snap back when _minSize is 1', () => {
			const v = view({ _camera2d: { _minScale: 2, _maxScale: 4, _minSize: 1 } })
			v.set(0.9, 0.9, 0.8, 0.8)
			v._limit(false)
			// The under-zoom branch is skipped entirely; the normal clamping runs instead
			expect(v._centerX).not.toBeCloseTo(0.5, 3)
		})

		it('applies the over-zoom correction when correctZoom is set', () => {
			// scale = 1 / max(1 * 1000/1000, 1 * 500/500) = 1, so s/_maxScale = 4 for a
			// maxScale of 0.25 and the view is scaled up until it reaches 1.
			const v = view({ _camera2d: { _minScale: 1, _maxScale: 0.25, _minSize: 1 } })
			v.set(0.5, 0.5, 0.5, 0.5)
			v._limit(true)
			expect(v.width).toBeCloseTo(1, 12)
			expect(v.height).toBeCloseTo(1, 12)
		})

		it('clamps the centre to the limit box', () => {
			const v = view()
			v._setLimit(0.5, 0.5, 0.5, 0.5)
			v.set(0.95, 0.95, 0.2, 0.2)
			v._limit(false)
			// halfW = 0.1, so the centre can reach at most 0.5 + 0.25 - 0.1 = 0.65
			expect(v._centerX).toBeCloseTo(0.65, 12)
			expect(v._centerY).toBeCloseTo(0.65, 12)
		})

		it('freeMove skips the centre clamp but keeps the size clamp', () => {
			const v = view()
			v._setLimit(0.5, 0.5, 0.1, 0.1)
			v.set(2, 2, 0.5, 0.5)
			v._limit(false, false, true)
			// The centre is left alone; only `Math.min(width, maxVw)` shrinks the box
			expect(v._centerX).toBeCloseTo(2, 12)
			expect(v.width).toBeCloseTo(0.1, 12)
			expect(v.height).toBeCloseTo(0.1, 12)
		})

		it('noLimit skips the whole centre clamp', () => {
			const v = view()
			v._setLimit(0.5, 0.5, 0.1, 0.1)
			v.set(2, 2, 0.5, 0.5)
			v._limit(false, true)
			expect(v._centerX).toBeCloseTo(2, 12)
			expect(v._centerY).toBeCloseTo(2, 12)
			// The `maxVw < 1` clamp still applies, because it is not behind `noLimit`
			expect(v.width).toBeCloseTo(0.1, 12)
		})

		it('wraps the centre for a 360 canvas instead of clamping it', () => {
			const v = view({ is360: true })
			v.set(1.3, 0.5, 0.5, 0.5)
			v._limit(false)
			expect(v._centerX).toBeCloseTo(0.3, 12)
		})
	})

	it('_correctAspectRatio stretches the shrunken axis to the camera pixel aspect', () => {
		const wide = view({ _camera2d: { cpw: 1000, cph: 250, _minScale: 1, _maxScale: 4, _minSize: 1 } })
		wide.set(0.5, 0.5, 2, 1)
		wide._correctAspectRatio()
		// targetAspect = cpw / cph = 4; the view is wider than that (2) only if 2 > 4, which is
		// false, so the *width* is stretched to height * targetAspect = 1 * 4
		expect(wide.width).toBeCloseTo(4, 12)
		expect(wide.height).toBeCloseTo(1, 12)

		const narrow = view({ _camera2d: { cpw: 125, cph: 250, _minScale: 1, _maxScale: 4, _minSize: 1 } })
		narrow.set(0.5, 0.5, 4, 1)
		narrow._correctAspectRatio()
		// targetAspect = 0.5, currentAspect = 4 > 0.5, so the height grows to width / 0.5 = 8
		expect(narrow.width).toBeCloseTo(4, 12)
		expect(narrow.height).toBeCloseTo(8, 12)
	})

	it('_correctAspectRatio is a no-op for 360', () => {
		const v = view({ is360: true, _camera2d: { cpw: 1000, cph: 250, _minScale: 1, _maxScale: 4, _minSize: 1 } })
		v.set(0.5, 0.5, 2, 1)
		v._correctAspectRatio()
		// A 360 sphere has no aspect ratio to correct: the values survive untouched
		expect([v.width, v.height]).toEqual([2, 1])
	})

	it('_setArea writes the box and the dirty flag without touching the limits', () => {
		const v = view()
		v._changed = false
		v._setArea(0.25, 0.25, 0.75, 0.5)
		expect([v._centerX, v._centerY, v.width, v.height]).toEqual([0.5, 0.375, 0.5, 0.25])
		expect(v._changed).toBe(false)
		expect(v.arr[2]).toBeCloseTo(0.5, 12)
	})
})

describe('Coordinates', () => {
	it('starts at the image centre', () => {
		const c = new Coordinates()
		expect([c.x, c.y, c.scale, c.w, c.direction]).toEqual([0.5, 0.5, 1, 0, 0])
	})

	it('_toArray mirrors every field into the shared array', () => {
		const c = new Coordinates(0.1, 0.2, 3, 4, 5)
		const arr = c._toArray()
		expect([...arr]).toEqual([0.1, 0.2, 3, 4, 5])
		// A single reused instance, the same way `View.arr` works
		expect(c.arr).toBe(arr)
		c.x = 0.9
		c._toArray()
		expect(arr[0]).toBeCloseTo(0.9, 12)
	})

	it('_inView only bounds-checks coordinates that have a near depth plane', () => {
		const v = new Viewport(800, 600)
		const c = new Coordinates()
		c.x = 400
		c.y = 300
		// w = 0 is the normal case: both bound checks apply
		expect(c._inView(v)).toBe(true)

		// `w < -1` short-circuits to *visible*. In practice a negative w means "behind the
		// camera" for `Camera2D._getXYOmniCoo` (it writes `-vec4.w - _omniDistance`), so this
		// arm is really "do not cull a behind-plane point by its projected x/y alone".
		c.w = -1.5
		expect(c._inView(v)).toBe(true)

		// Between -1 and 3 the point is still culled by the viewport rectangle
		c.w = -0.5
		c.x = 4000
		expect(c._inView(v)).toBe(false)
		c.x = 400
		expect(c._inView(v)).toBe(true)

		// w >= 3 answers false unconditionally, whatever the coordinates: the point is treated
		// as too far away to be drawn, not as unbounded depth.
		c.w = 3
		c.x = 4000
		expect(c._inView(v)).toBe(false)
		c.x = 400
		expect(c._inView(v)).toBe(false)
	})

	it('_inView rejects points outside the viewport rectangle', () => {
		const v = new Viewport(800, 600)
		const c = new Coordinates()
		for (const [x, y] of [
			[-1, 300],
			[801, 300],
			[400, -1],
			[400, 601],
		] as [number, number][]) {
			c.x = x
			c.y = y
			expect(c._inView(v), `${x},${y}`).toBe(false)
		}
		// The bounds are inclusive
		c.x = 800
		c.y = 600
		expect(c._inView(v)).toBe(true)
	})
})

describe('Viewport', () => {
	it('scales left/top/width/height by the ratio', () => {
		const v = new Viewport()
		expect(v.set(400, 300, 10, 20, 2, 1.5, true)).toBe(true)
		expect([v.width, v.height, v.left, v.top]).toEqual([800, 600, 20, 40])
		expect([v.ratio, v.scale, v._isPortrait]).toEqual([2, 1.5, true])
	})

	it('returns false for a repeated set when the input has no offset', () => {
		const v = new Viewport()
		expect(v.set(400, 300, 0, 0, 2, 1.5, true)).toBe(true)
		// Every compared member matches, so there is nothing to do
		expect(v.set(400, 300, 0, 0, 2, 1.5, true)).toBe(false)
		// One differing field is enough to report a change
		expect(v.set(400, 300, 0, 0, 2, 1.5, false)).toBe(true)
	})

	it('reports a change on every update that carries a non-zero offset', () => {
		// The unchanged-check compares `left`/`top` against the *raw* arguments while it
		// compares width/height against `arg * ratio`. With a non-zero left or top the two
		// can never match, so `set()` reports a change even when every stored value is
		// already correct. The result is a redundant viewport dirty flag, not wrong numbers
		// (the next line assigns the same scaled values), but it is the one asymmetry in
		// this method. Pinned so a fix has to update this test.
		const v = new Viewport()
		expect(v.set(400, 300, 10, 20, 2, 1.5, true)).toBe(true)
		expect(v.set(400, 300, 10, 20, 2, 1.5, true)).toBe(true)
		// The stored values are still the scaled ones, not accumulated
		expect([v.width, v.height, v.left, v.top]).toEqual([800, 600, 20, 40])
	})

	it('does not accumulate a repeated set', () => {
		// `set` compares against the stored (already scaled) values, so calling it twice
		// with the same input must not multiply by the ratio again
		const v = new Viewport()
		v.set(400, 300, 0, 0, 2, 1, false)
		v.set(400, 300, 0, 0, 2, 1, false)
		expect(v.width).toBe(800)
		expect(v.height).toBe(600)
	})

	it('_aspect falls back to 1 before layout', () => {
		expect(new Viewport()._aspect).toBe(1)
		expect(new Viewport(0, 600)._aspect).toBe(1)
		expect(new Viewport(800, 0)._aspect).toBe(1)
		expect(new Viewport(800, 400)._aspect).toBe(2)
	})

	it('_copy carries the scaled fields but not the margins', () => {
		const from = new Viewport()
		from.set(400, 300, 10, 20, 2, 1.5, true)
		from._areaWidth = 99
		from._areaHeight = 98

		const to = new Viewport()
		to._copy(from)
		expect([to.width, to.height, to.left, to.top]).toEqual([800, 600, 20, 40])
		expect([to.ratio, to.scale, to._isPortrait]).toEqual([2, 1.5, true])
		// The persistent margin fields are deliberately excluded
		expect([to._areaWidth, to._areaHeight]).toEqual([0, 0])
	})
})

describe('DrawRect', () => {
	it('starts empty and is written in place', () => {
		const r = new DrawRect()
		expect([r.x0, r.y0, r.x1, r.y1, r.layer, r.x, r.y]).toEqual([0, 0, 0, 0, 0, 0, 0])
		const filled = new DrawRect(0.1, 0.2, 0.3, 0.4, 5, 6, 7)
		expect([filled.x0, filled.y0, filled.x1, filled.y1, filled.layer, filled.x, filled.y]).toEqual([
			0.1, 0.2, 0.3, 0.4, 5, 6, 7,
		])
	})
})
