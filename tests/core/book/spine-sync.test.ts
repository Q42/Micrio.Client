import { describe, expect, it } from 'vitest'
import {
	applySpineDelta,
	computeAllPageFloors,
	computePageSpineY,
	computeWeightFactor,
} from '$book/animation/spine-sync'

describe('computeWeightFactor', () => {
	it('is the mean progress of every page', () => {
		expect(computeWeightFactor(new Float32Array([1, 0, 0]), 3)).toBeCloseTo(1 / 3, 12)
		expect(computeWeightFactor(new Float32Array([1, 1, 0, 0]), 4)).toBeCloseTo(0.5, 12)
		expect(computeWeightFactor(new Float32Array([0, 0]), 2)).toBe(0)
		expect(computeWeightFactor(new Float32Array([1, 1]), 2)).toBe(1)
	})

	it('reads the whole array, not the first pageCount entries', () => {
		// The caller is expected to pass a `pageCount`-long array; a longer one
		// (or a wrong count) sums everything, which is what the book relies on.
		expect(computeWeightFactor(new Float32Array([1, 0, 0]), 2)).toBeCloseTo(1 / 2, 12)
	})

	it('avoids a division by zero for an empty book', () => {
		expect(computeWeightFactor(new Float32Array(0), 0)).toBe(0)
	})
})

describe('computePageSpineY', () => {
	const total = 0.012 // 10 pages × PAGE_THICKNESS
	const count = 10
	const thickness = 0.0012

	it('at progress 0 a page sits on the right stack, at 1 on the left stack', () => {
		// Right at page i is (count-1-i) thicknesses from the bottom, plus the
		// weight of every flipped page; left is the mirror of that.
		for (const i of [0, 3, 9]) {
			const right = computePageSpineY(i, 0, 0.4, total, count, thickness)
			expect(right).toBeCloseTo((count - 1 - i) * thickness + 0.4 * total, 12)

			const left = computePageSpineY(i, 1, 0.4, total, count, thickness)
			expect(left).toBeCloseTo(i * thickness + (1 - 0.4) * total, 12)
		}
	})

	it('interpolates linearly in progress', () => {
		const from = computePageSpineY(2, 0, 0.25, total, count, thickness)
		const to = computePageSpineY(2, 1, 0.25, total, count, thickness)
		expect(computePageSpineY(2, 0.5, 0.25, total, count, thickness)).toBeCloseTo((from + to) / 2, 12)
	})

	it('never returns NaN, including for a degenerate single-page book', () => {
		expect(computePageSpineY(0, 0, 0, 0, 1, 0)).toBe(0)
		expect(computePageSpineY(0, 1, 0, 0, 1, 0)).toBe(0)
		expect(Number.isNaN(computePageSpineY(0, 0.5, 0, 0, 0, 0))).toBe(false)
	})
})

describe('computeAllPageFloors', () => {
	it('returns one floor per page, in page order', () => {
		const progress = new Float32Array([0, 0.5, 1])
		const floors = computeAllPageFloors(progress, 0.5, 0.0036, 3, 0.0012)
		expect(floors).toHaveLength(3)
		for (let i = 0; i < 3; i++) {
			expect(floors[i]).toBeCloseTo(computePageSpineY(i, progress[i], 0.5, 0.0036, 3, 0.0012), 5)
		}
	})
})

describe('applySpineDelta', () => {
	it('moves every vertex y by the delta and nothing else', () => {
		const positions = new Float32Array([0, 1, 2, 3, 4, 5])
		applySpineDelta(positions, 0.5)
		expect(Array.from(positions)).toEqual([0, 1.5, 2, 3, 4.5, 5])
	})

	it('is a no-op at or below 1e-6, so a settled page is not touched', () => {
		const positions = new Float32Array([0, 1, 2, 3, 4, 5])
		applySpineDelta(positions, 1e-6)
		expect(Array.from(positions)).toEqual([0, 1, 2, 3, 4, 5])
		// Just above the threshold it does move (Float32 storage, hence the loose precision)
		applySpineDelta(positions, 1.1e-6)
		expect(positions[1]).toBeCloseTo(1 + 1.1e-6, 6)
	})
})
