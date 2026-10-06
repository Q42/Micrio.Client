import { describe, expect, it } from 'vitest'
import { getCols, slideAreas, swipeAreas, swipeExitAreas } from '$grid/format'

/**
 * `format.ts` is the pure part of the grid: the column maths behind the CSS template and
 * the three area tables the slide/swipe transitions place images with. It has no DOM or
 * element state, so it is asserted directly.
 */
describe('getCols', () => {
	it('returns a positive integer for every sensible input', () => {
		for (let numTiles = 1; numTiles <= 24; numTiles++) {
			for (let images = 1; images <= numTiles; images++) {
				const cols = getCols(images, numTiles)
				expect(Number.isInteger(cols), `images=${images} tiles=${numTiles}`).toBe(true)
				expect(cols, `images=${images} tiles=${numTiles}`).toBeGreaterThanOrEqual(1)
				// Never more columns than there are tiles to put in them
				expect(cols, `images=${images} tiles=${numTiles}`).toBeLessThanOrEqual(numTiles)
			}
		}
	})

	it('derives the columns from the tile count when images and tiles differ', () => {
		// The estimate is `ceil(tiles / ceil(√tiles))`, and the factoring branch is
		// skipped because `images !== numTiles`
		// 3 tiles → ceil(3/2) = 2
		expect(getCols(2, 3)).toBe(2)
		// 5 tiles → ceil(5/3) = 2
		expect(getCols(3, 5)).toBe(2)
		// 9 tiles → ceil(9/3) = 3
		expect(getCols(5, 9)).toBe(3)
	})

	it('prefers a divisor of the image count when they match', () => {
		// 4 images/4 tiles: √4 = 2, divisors of 4 in [2, 2+2) are [2] → 2
		expect(getCols(4, 4)).toBe(2)
		// 6 images/6 tiles: √6 = 2 (floor), span [2, 2+3) holds 2 and 3 → middle is 3
		expect(getCols(6, 6)).toBe(3)
		// 9 images/9 tiles: √9 = 3, span [3, 3+3) holds 3 → 3
		expect(getCols(9, 9)).toBe(3)
		// 12 images/12 tiles: span [3, 3+4) holds 3, 4, 6 → middle is 4
		expect(getCols(12, 12)).toBe(4)
	})

	it('keeps the tile estimate when no divisor is found', () => {
		// 7 is prime: `√7` floors to 2, the estimate is ceil(7/3) = 3, and the divisor
		// scan over [2, 5) finds nothing, so the estimate stands
		expect(getCols(7, 7)).toBe(3)
		// 11 is prime: √11 floors to 3, the estimate is ceil(11/4) = 3, scan finds nothing
		expect(getCols(11, 11)).toBe(3)
	})

	it('handles a single image and a zero-tile layout', () => {
		expect(getCols(1, 1)).toBe(1)
		// A zero-tile layout must not produce a zero-column template
		expect(getCols(0, 0)).toBeNaN()
	})
})

/** Every table is keyed by the four right angles the transitions understand. */
const ANGLES = [0, 90, 180, 270] as const

describe('transition area tables', () => {
	it.each([
		['slideAreas', slideAreas],
		['swipeAreas', swipeAreas],
		['swipeExitAreas', swipeExitAreas],
	] as const)('%s covers every angle with a finite view', (_name, table) => {
		for (const angle of ANGLES) {
			const area = table[angle]
			expect(area, `angle ${angle}`).toHaveLength(4)
			expect(area.every(Number.isFinite), `angle ${angle}`).toBe(true)
		}
	})

	it('places the swipe entry one full frame away and the exit on the opposite side', () => {
		for (const angle of ANGLES) {
			const entry = swipeAreas[angle]
			const exit = swipeExitAreas[angle]
			// Entry and exit are mirrored: their x/y offsets sum to zero across the pair
			expect(entry[0] + exit[0], `angle ${angle}`).toBe(0)
			expect(entry[1] + exit[1], `angle ${angle}`).toBe(0)
			// Both are full-size cells
			expect([entry[2], entry[3]]).toEqual([1, 1])
			expect([exit[2], exit[3]]).toEqual([1, 1])
		}
	})

	it('slants nothing: every entry shifts on a single axis', () => {
		// A view is [x, y, w, h], so index 0 is x and index 1 is y. An entry that moved on
		// both axes would slide diagonally, which no transition is meant to do.
		for (const angle of ANGLES) {
			for (const [name, table] of [
				['slideAreas', slideAreas],
				['swipeAreas', swipeAreas],
			] as const) {
				const [x, y] = table[angle]
				expect(x === 0 || y === 0, `${name}[${angle}] shifts both axes`).toBe(true)
			}
		}
	})

	it('offsets by the authored amount on the moved axis', () => {
		// Pinned exactly: the two tables are authored by hand and do not follow one ratio
		expect(slideAreas).toEqual({
			0: [0, -0.5, 1, 0.5],
			90: [1, 0, 0.5, 1],
			180: [0, 1, 1, 0.5],
			270: [-0.5, 0, 0.5, 1],
		})
		expect(swipeAreas).toEqual({ 0: [0, -1, 1, 1], 90: [1, 0, 1, 1], 180: [0, 1, 1, 1], 270: [-1, 0, 1, 1] })
		expect(swipeExitAreas).toEqual({
			0: [0, 1, 1, 1],
			90: [-1, 0, 1, 1],
			180: [0, -1, 1, 1],
			270: [1, 0, 1, 1],
		})
	})

	it('moves in the direction each angle names', () => {
		// 0 = up, 90 = right, 180 = down, 270 = left
		expect(slideAreas[0][1]).toBeLessThan(0)
		expect(slideAreas[90][0]).toBeGreaterThan(0)
		expect(slideAreas[180][1]).toBeGreaterThan(0)
		expect(slideAreas[270][0]).toBeLessThan(0)
	})

	it('keeps the perpendicular axis at the origin', () => {
		// A vertical slide must not also shift x, and vice versa
		expect([slideAreas[0][0], slideAreas[180][0]]).toEqual([0, 0])
		expect([slideAreas[90][1], slideAreas[270][1]]).toEqual([0, 0])
		expect([swipeAreas[0][0], swipeAreas[180][0]]).toEqual([0, 0])
		expect([swipeAreas[90][1], swipeAreas[270][1]]).toEqual([0, 0])
	})
})
