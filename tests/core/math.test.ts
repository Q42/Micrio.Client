import { describe, expect, it } from 'vitest'
import { epsEq, mod, mod1, modPI, normalize3, pointInArea, toCenterJSON, twoNth } from '../../src/utils/math'

describe('mod', () => {
	it('is a floored modulo, not a JS remainder', () => {
		expect(mod(-1)).toBe(0)
		expect(mod(-1, 3)).toBe(2)
		expect(mod(-4, 3)).toBe(2)
		expect(mod(4, 3)).toBe(1)
	})

	it('defaults to mod 1 and keeps the positive fractional part', () => {
		expect(mod(2.25)).toBeCloseTo(0.25, 10)
		expect(mod(-0.25)).toBeCloseTo(0.75, 10)
		expect(mod(0)).toBe(0)
	})

	it('is well defined for non-integer and irrational moduli', () => {
		expect(mod(7.5, 2.5)).toBeCloseTo(0, 10)
		expect(mod(-Math.PI, Math.PI)).toBeCloseTo(0, 10)
		expect(mod(10, 0.5)).toBeCloseTo(0, 10)
	})
})

describe('mod1 / modPI', () => {
	it('wraps any input into [0, 1) / [0, 2*PI)', () => {
		const values = [0, 0.5, -0.5, 1, -1, 1234.5678, -1234.5678]
		for (const v of values) {
			const a = mod1(v)
			expect(a).toBeGreaterThanOrEqual(0)
			expect(a).toBeLessThan(1)

			const b = modPI(v)
			expect(b).toBeGreaterThanOrEqual(0)
			expect(b).toBeLessThan(Math.PI * 2)
		}
	})

	it('keeps already-normalized angles untouched', () => {
		expect(modPI(Math.PI)).toBeCloseTo(Math.PI, 10)
		expect(modPI(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10)
		// Exactly one full turn wraps back to 0
		expect(modPI(Math.PI * 2)).toBe(0)
		expect(modPI(-Math.PI * 2)).toBe(0)
	})

	it('wraps angles over a full sweep without drifting', () => {
		for (let i = -20; i <= 20; i++) {
			const angle = i * Math.PI * 0.5
			const wrapped = modPI(angle)
			expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(angle), 8)
			expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(angle), 8)
		}
	})
})

describe('twoNth', () => {
	it('computes powers of two for the zoom-level range', () => {
		expect(twoNth(0)).toBe(1)
		expect(twoNth(1)).toBe(2)
		expect(twoNth(10)).toBe(1024)
	})
})

describe('toCenterJSON', () => {
	it('converts a corner view to a centered view', () => {
		expect(toCenterJSON([0, 0, 1, 1])).toEqual({ centerX: 0.5, centerY: 0.5, width: 1, height: 1 })
		expect(toCenterJSON([0.25, 0.1, 0.5, 0.2])).toEqual({
			centerX: 0.5,
			centerY: 0.2,
			width: 0.5,
			height: 0.2,
		})
	})

	it('handles zero-size and inverted views without producing NaN', () => {
		expect(toCenterJSON([0.5, 0.5, 0, 0])).toEqual({ centerX: 0.5, centerY: 0.5, width: 0, height: 0 })
		expect(Number.isNaN(toCenterJSON([1, 1, -0.5, -0.5]).centerX)).toBe(false)
	})
})

describe('pointInArea', () => {
	const area: [number, number, number, number] = [10, 20, 30, 40]

	it('includes the edges and corners', () => {
		expect(pointInArea(10, 20, area)).toBe(true)
		expect(pointInArea(40, 60, area)).toBe(true)
		expect(pointInArea(10, 60, area)).toBe(true)
		expect(pointInArea(40, 20, area)).toBe(true)
	})

	it('excludes points just outside', () => {
		expect(pointInArea(9.999, 20, area)).toBe(false)
		expect(pointInArea(40.001, 20, area)).toBe(false)
		expect(pointInArea(10, 19.999, area)).toBe(false)
		expect(pointInArea(10, 60.001, area)).toBe(false)
		expect(pointInArea(25, 40, area)).toBe(true)
	})
})

describe('epsEq', () => {
	it('uses a strict epsilon comparison', () => {
		expect(epsEq(1, 1 + 1e-9)).toBe(true)
		// Just inside the epsilon
		expect(epsEq(1, 1 + 1e-7)).toBe(true)
		// Just outside it
		expect(epsEq(1, 1 + 1e-5)).toBe(false)
		expect(epsEq(1, 1 - 1e-5)).toBe(false)
		expect(epsEq(-0, 0)).toBe(true)
	})

	it('tolerates Float32 round-trip noise', () => {
		const f = new Float32Array([0.1])[0]
		expect(f).not.toBe(0.1)
		expect(epsEq(f, 0.1)).toBe(true)
	})
})

describe('normalize3', () => {
	it('returns a unit vector', () => {
		const [x, y, z] = normalize3(3, 4, 0)
		expect(x).toBeCloseTo(0.6, 10)
		expect(y).toBeCloseTo(0.8, 10)
		expect(z).toBe(0)
		expect(Math.hypot(x, y, z)).toBeCloseTo(1, 10)
	})

	it('returns a zero vector for zero-length input, without NaN', () => {
		expect(normalize3(0, 0, 0)).toEqual([0, 0, 0])
		expect(normalize3(0, 0, 0).some(Number.isNaN)).toBe(false)
	})

	it('keeps every component finite for very large magnitudes', () => {
		const [x, y, z] = normalize3(1e150, 1e150, 0)
		expect(Number.isFinite(x)).toBe(true)
		expect(Number.isFinite(y)).toBe(true)
		expect(x).toBeCloseTo(Math.SQRT1_2, 10)
		expect(y).toBeCloseTo(Math.SQRT1_2, 10)
		expect(z).toBe(0)
	})
})
