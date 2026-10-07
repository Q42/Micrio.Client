import { describe, expect, it } from 'vitest'
import { PaperMesh } from '$book/geometry/paper-mesh'
import { CoverMesh } from '$book/geometry/cover-mesh'
import { PageFlipAnimator } from '$book/animation/page-flip'
import { computePageSpineY } from '$book/animation/spine-sync'
import { ARC_PEAK, BASE_FLIP_DURATION, FLIP_SPEED, GRAB_ROW, GRID_COLS, GRID_ROWS } from '$book/core/settings'

/** The page-flip clock: a full flip lasts BASE_FLIP_DURATION / FLIP_SPEED seconds. */
const FULL_FLIP = BASE_FLIP_DURATION / FLIP_SPEED
const TICK = 1 / 60

/** A fresh animator with `pageCount` paper pages, plus a page index to drive. */
function setup(pageCount = 3): { animator: PageFlipAnimator; meshes: PaperMesh[] } {
	const animator = new PageFlipAnimator()
	animator._initSlots(pageCount)
	const meshes = Array.from({ length: pageCount }, () => new PaperMesh(0, 1, 1))
	return { animator, meshes }
}

/** Runs `_update` for `frames` ticks. */
function run(animator: PageFlipAnimator, meshes: PaperMesh[], frames: number, selectedPage = 0): void {
	for (let i = 0; i < frames; i++) {
		animator._update(TICK, meshes, selectedPage, meshes.length * 0.0012, meshes.length, 0.0012)
	}
}

/** The vertex index of the corner grabbed at a given row of the grid. */
const cornerVertex = (grabRow: number): number =>
	Math.round(GRID_ROWS - 1 - grabRow * (GRID_ROWS - 1)) * GRID_COLS + (GRID_COLS - 1)

describe('PageFlipAnimator — slots', () => {
	it('starts every page idle at progress 0', () => {
		const { animator } = setup(3)
		for (let i = 0; i < 3; i++) {
			expect(animator._getPageProgress(i)).toBe(0)
			expect(animator._getPageDirection(i)).toBe(0)
			expect(animator._isPageAnimating(i)).toBe(false)
			expect(animator._isPageDragging(i)).toBe(false)
		}
		expect(animator._animating).toBe(false)
	})

	it('ignores an out-of-range page index without throwing', () => {
		const { animator, meshes } = setup(2)
		animator._flipLeft(5)
		animator._flipRight(-1)
		expect(animator._animating).toBe(false)
		expect(() => {
			run(animator, meshes, 2)
		}).not.toThrow()
	})

	it('re-initialises the slots when the mesh count changes', () => {
		const { animator, meshes } = setup(2)
		animator._flipLeft(0)
		meshes.push(new PaperMesh())
		run(animator, meshes, 1)
		// The new page list was rebuilt, so the flip is gone
		expect(animator._animating).toBe(false)
		expect(animator._getPageProgress(0)).toBe(0)
	})

	it('_setPageProgress sets the value, stops the flip and re-bases the start', () => {
		const { animator } = setup(2)
		animator._flipLeft(0)
		animator._setPageProgress(0, 0.25)
		expect(animator._getPageProgress(0)).toBe(0.25)
		expect(animator._getPageDirection(0)).toBe(0)
		expect(animator._animating).toBe(false)
		// From the new start, a flip animates the remaining 0.75
		animator._flipLeft(0)
		expect(animator._getPageDirection(0)).toBe(1)
	})
})

describe('PageFlipAnimator — animation', () => {
	it('eases a forward flip from 0 to exactly 1 over the flip duration', () => {
		const { animator, meshes } = setup(2)
		animator._flipLeft(0)
		expect(animator._animating).toBe(true)
		expect(animator._getPageDirection(0)).toBe(1)

		// Half way through the smoothstep is symmetric, so it sits on 0.5
		run(animator, meshes, Math.round(FULL_FLIP / 2 / TICK))
		expect(animator._getPageProgress(0)).toBeCloseTo(0.5, 3)

		run(animator, meshes, Math.ceil(FULL_FLIP / 2 / TICK) + 2)
		expect(animator._getPageProgress(0)).toBe(1)
		expect(animator._getPageDirection(0)).toBe(0)
		expect(animator._animating).toBe(false)
	})

	it('eases a backward flip from 1 down to 0', () => {
		const { animator, meshes } = setup(2)
		animator._setPageProgress(0, 1)
		animator._flipRight(0)
		expect(animator._getPageDirection(0)).toBe(-1)
		run(animator, meshes, Math.ceil(FULL_FLIP / TICK) + 2)
		expect(animator._getPageProgress(0)).toBe(0)
		expect(animator._animating).toBe(false)
	})

	it('uses the smoothstep, not a linear ramp', () => {
		const { animator, meshes } = setup(2)
		animator._flipLeft(0)
		// A quarter of the way through: 0.25²(3-0.5) = 0.15625, well below 0.25
		run(animator, meshes, Math.round(FULL_FLIP / 4 / TICK))
		const quarter = animator._getPageProgress(0)
		expect(quarter).toBeGreaterThan(0.1)
		expect(quarter).toBeLessThan(0.25)
	})

	it('clamps its own dt, so a stalled frame cannot skip the ease', () => {
		const { animator, meshes } = setup(2)
		animator._flipLeft(0)
		animator._update(10, meshes, 0, 0.0036, 2, 0.0012)
		// Still animating: 1/30 of a second was applied, not 10 seconds
		expect(animator._getPageProgress(0)).toBeLessThan(1)
		expect(animator._animating).toBe(true)
	})

	it('applies a random grab row when none is passed and honours an explicit one', () => {
		const { animator, meshes } = setup(2)
		const rest = meshes[0]._restPositions

		// An explicit grab row pins the corner vertex that row names
		animator._flipLeft(0, 0)
		run(animator, meshes, 2)
		expect(Number.isFinite(meshes[0]._positions[cornerVertex(0) * 3])).toBe(true)
		expect(meshes[0]._positions[1]).not.toBe(rest[1])

		// No grab row: a random offset around GRAB_ROW, still inside the page
		animator._reset(meshes)
		animator._flipLeft(0)
		run(animator, meshes, 2)
		expect(Number.isFinite(meshes[0]._positions[1])).toBe(true)
	})

	it('drives the corner vertex between the paper edges along the arc', () => {
		const { animator, meshes } = setup(2)
		const mesh = meshes[0]
		const cornerIndex = cornerVertex(GRAB_ROW)
		const i3 = cornerIndex * 3

		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, 1)
		// Just started: the corner is at (paperWidth, spine floor, rest z)
		expect(mesh._positions[i3]).toBeCloseTo(1, 4)
		expect(mesh._invMasses[cornerIndex]).toBe(0)

		// A quarter of the way: the arc's peak lift is ARC_PEAK at π/2
		animator._reset(meshes)
		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, Math.round(FULL_FLIP / 2 / TICK))
		expect(mesh._positions[i3]).toBeCloseTo(0, 2)
		expect(mesh._positions[i3 + 1] - mesh._positions[1]).toBeGreaterThan(ARC_PEAK * 0.9)
	})

	it('releases the driven vertex and its inverse mass when the flip finishes', () => {
		const { animator, meshes } = setup(2)
		const mesh = meshes[0]
		const cornerIndex = cornerVertex(GRAB_ROW)

		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, 2)
		expect(mesh._invMasses[cornerIndex]).toBe(0)
		run(animator, meshes, Math.ceil(FULL_FLIP / TICK) + 2)
		expect(mesh._invMasses[cornerIndex]).toBe(1)
		expect(animator._getPageProgress(0)).toBe(1)
	})

	it('moves the grabbed corner when the grab row changes mid-flip', () => {
		const { animator, meshes } = setup(2)
		const mesh = meshes[0]
		const first = cornerVertex(GRAB_ROW)
		const second = cornerVertex(0.9)

		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, 2)
		expect(mesh._invMasses[first]).toBe(0)

		// Re-grabbing restores the old vertex and pins the new one
		animator._setPageProgress(0, 0.2)
		animator._flipLeft(0, 0.9)
		run(animator, meshes, 2)
		expect(mesh._invMasses[second]).toBe(0)
		expect(mesh._invMasses[first]).toBe(1)
	})

	it('does not move the spine when the selected page is out of range', () => {
		const { animator, meshes } = setup(2)
		const before = Array.from(meshes[0]._positions)
		animator._update(TICK, meshes, 9, 0.0024, 2, 0.0012)
		expect(Array.from(meshes[0]._positions)).toEqual(before)
	})
})

describe('PageFlipAnimator — spine floor tracking', () => {
	it('shifts the page to its computed spine floor while it animates', () => {
		const { animator, meshes } = setup(3)
		const mesh = meshes[1]
		animator._flipLeft(1, GRAB_ROW)
		run(animator, meshes, 1, 1)
		const expectedProgress = animator._getPageProgress(1)
		const weight = (0 + expectedProgress + 0) / 3
		const expected = computePageSpineY(1, expectedProgress, weight, 3 * 0.0012, 3, 0.0012)
		// Every vertex's y moved by the same delta, so vertex 0 sits on the floor
		expect(mesh._positions[1]).toBeCloseTo(mesh._restPositions[1] + (expected - mesh._restPositions[1]), 5)
		expect(mesh._positions[1]).toBeCloseTo(expected, 5)
	})

	it('leaves a page that is not animating and not dragging alone', () => {
		const { animator, meshes } = setup(3)
		const before = Array.from(meshes[2]._positions)
		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, 3)
		expect(Array.from(meshes[2]._positions)).toEqual(before)
	})
})

describe('PageFlipAnimator — dragging', () => {
	it('tracks the pointer through _setDragProgress, clamped to [0,1]', () => {
		const { animator } = setup(2)
		animator._beginDrag(0, 0.5)
		expect(animator._isPageDragging(0)).toBe(true)
		animator._setDragProgress(0, 0.4)
		expect(animator._getPageProgress(0)).toBeCloseTo(0.4, 6)
		animator._setDragProgress(0, 2)
		expect(animator._getPageProgress(0)).toBe(1)
		animator._setDragProgress(0, -2)
		expect(animator._getPageProgress(0)).toBe(0)
	})

	it('ignores a drag update on a page that is not being dragged', () => {
		const { animator } = setup(2)
		animator._setDragProgress(0, 0.5)
		expect(animator._getPageProgress(0)).toBe(0)

		animator._beginDrag(0, 0.5)
		animator._endDrag(0, 1)
		animator._setDragProgress(0, 0.5)
		// The drag ended, so the value no longer updates
		expect(animator._getPageProgress(0)).toBe(0)
	})

	it('animates the release from the progress it was left at, in the given direction', () => {
		const { animator, meshes } = setup(2)
		animator._beginDrag(0, 0.5)
		animator._setDragProgress(0, 0.6)
		animator._endDrag(0, 1)
		expect(animator._isPageDragging(0)).toBe(false)
		expect(animator._getPageDirection(0)).toBe(1)
		expect(animator._animating).toBe(true)
		run(animator, meshes, Math.ceil(FULL_FLIP / TICK) + 2)
		expect(animator._getPageProgress(0)).toBe(1)

		// A release in the other direction animates back down
		animator._setPageProgress(0, 0.6)
		animator._endDrag(0, -1)
		run(animator, meshes, Math.ceil(FULL_FLIP / TICK) + 2)
		expect(animator._getPageProgress(0)).toBe(0)
	})

	it('does not advance a dragged page through the animation pass', () => {
		const { animator, meshes } = setup(2)
		animator._beginDrag(0, 0.5)
		animator._setDragProgress(0, 0.3)
		// The drag pass skips the animation update, so the progress stays put
		run(animator, meshes, 30)
		expect(animator._getPageProgress(0)).toBeCloseTo(0.3, 6)
		expect(animator._isPageDragging(0)).toBe(true)
	})

	it('keeps the grabbed corner pinned while dragging', () => {
		const { animator, meshes } = setup(2)
		const mesh = meshes[0]
		const cornerIndex = cornerVertex(0.5)
		animator._beginDrag(0, 0.5)
		animator._setDragProgress(0, 0.5)
		run(animator, meshes, 3)
		expect(mesh._invMasses[cornerIndex]).toBe(0)
		// The drag pins the corner at the arc position for progress 0.5
		expect(mesh._positions[cornerIndex * 3]).toBeCloseTo(0, 3)
	})
})

describe('PageFlipAnimator — hard covers', () => {
	it('rigidly rotates a hard cover instead of pinning a corner', () => {
		const { animator } = setup(2)
		const cover = new CoverMesh(0, 1, 1)
		const meshes = [cover, new PaperMesh()]
		animator._hardCoverPages = new Set([0])

		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, 30)
		// Every vertex was rotated about the spine, and all masses were masked
		expect(Array.from(cover._invMasses).every((m) => m === 0)).toBe(true)
		const progress = animator._getPageProgress(0)
		expect(progress).toBeCloseTo(0.5, 3)
		// The cover's pivot is (paperWidth/4)·(1 - coverScale) = -0.01, so the first
		// vertex (rest x -0.02) rotates to -0.01 about it, with y following sin
		const pivotX = (cover._paperWidth / 4) * (1 - cover._coverScale)
		const rx = cover._restPositions[0]
		expect(cover._positions[0]).toBeCloseTo(pivotX + (rx - pivotX) * Math.cos(Math.PI / 2), 5)
		expect(cover._positions[1]).toBeCloseTo((rx - pivotX) * Math.sin(Math.PI / 2) + cover._restPositions[1], 5)
		// z is untouched by the rotation
		expect(cover._positions[2]).toBeCloseTo(cover._restPositions[2], 6)
	})

	it('restores every masked inverse mass when the hard cover flip finishes', () => {
		const { animator } = setup(2)
		const cover = new CoverMesh(0, 1, 1)
		const meshes = [cover, new PaperMesh()]
		animator._hardCoverPages = new Set([0])
		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, Math.ceil(FULL_FLIP / TICK) + 2)
		expect(Array.from(cover._invMasses).every((m) => m === 1)).toBe(true)
		expect(animator._getPageProgress(0)).toBe(1)
	})

	it('_instantFlip releases the mask and rigidly lands the page', () => {
		const { animator } = setup(2)
		const cover = new CoverMesh(0, 1, 1)
		const meshes = [cover, new PaperMesh()]
		animator._hardCoverPages = new Set([0])
		animator._flipLeft(0, GRAB_ROW)
		run(animator, meshes, 5)

		animator._instantFlip(cover, 0)
		expect(animator._getPageProgress(0)).toBe(1)
		expect(animator._getPageDirection(0)).toBe(0)
		expect(Array.from(cover._invMasses).every((m) => m === 1)).toBe(true)
		expect(Array.from(cover._velocities).every((v) => v === 0)).toBe(true)
		// At progress 1 the rotation has mirrored every vertex about the pivot
		const pivotX = (cover._paperWidth / 4) * (1 - cover._coverScale)
		expect(cover._positions[0]).toBeCloseTo(pivotX - (cover._restPositions[0] - pivotX), 5)
	})
})

describe('PageFlipAnimator — reset', () => {
	it('returns every slot and mesh to rest, unmasking driven vertices', () => {
		const { animator, meshes } = setup(3)
		animator._flipLeft(1, GRAB_ROW)
		run(animator, meshes, 5)
		animator._beginDrag(2, 0.5)
		animator._setDragProgress(2, 0.5)

		animator._reset(meshes)
		for (let i = 0; i < 3; i++) {
			expect(animator._getPageProgress(i)).toBe(0)
			expect(animator._getPageDirection(i)).toBe(0)
			expect(animator._isPageDragging(i)).toBe(false)
			expect(animator._isPageAnimating(i)).toBe(false)
		}
		expect(Array.from(meshes[1]._invMasses).every((m) => m === 1)).toBe(true)
	})
})
