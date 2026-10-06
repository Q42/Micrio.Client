import { describe, expect, it } from 'vitest'
import { Vec3 } from '$book/core/vec3'

describe('Vec3', () => {
	it('returns the mutated instance from every mutator, so calls chain', () => {
		const v = new Vec3(1, 2, 3)
		expect(v._set(4, 5, 6)).toBe(v)
		expect(v._copy(new Vec3(7, 8, 9))).toBe(v)
		expect(v._add(new Vec3(1, 1, 1))).toBe(v)
		expect(v._sub(new Vec3(1, 1, 1))).toBe(v)
		expect(v._cross(new Vec3(0, 0, 1))).toBe(v)
		expect(v._normalize()).toBe(v)
		// 7,8,9 crossed with ẑ is 8,-7,0, normalized (its length is √113)
		expect(v._x).toBeCloseTo(8 / Math.sqrt(113), 12)
		expect(v._y).toBeCloseTo(-7 / Math.sqrt(113), 12)
		expect(v._z).toBe(0)
	})

	it('computes the cross product in the (x → y → z) right-handed order', () => {
		// x̂ × ŷ = ẑ, and ŷ × x̂ = -ẑ
		expect(new Vec3(1, 0, 0)._cross(new Vec3(0, 1, 0))).toEqual(new Vec3(0, 0, 1))
		expect(new Vec3(0, 1, 0)._cross(new Vec3(1, 0, 0))).toEqual(new Vec3(0, 0, -1))
	})

	it('reads the operands before writing, so cross(v) with itself is zero', () => {
		const v = new Vec3(3, -2, 5)
		expect(v._dot(new Vec3(1, 1, 1))).toBe(6)
		expect(v._cross(v)).toEqual(new Vec3(0, 0, 0))
	})

	it('normalizes to unit length and leaves a zero vector untouched (no NaN)', () => {
		const unit = new Vec3(3, 4, 0)._normalize()
		expect(unit._length()).toBeCloseTo(1, 12)
		expect(unit._x).toBeCloseTo(0.6, 12)
		expect(unit._y).toBeCloseTo(0.8, 12)

		const zero = new Vec3(0, 0, 0)._normalize()
		expect(zero).toEqual(new Vec3(0, 0, 0))
		expect([zero._x, zero._y, zero._z].some(Number.isNaN)).toBe(false)
	})

	it('treats a length at the 1e-9 threshold as zero-length', () => {
		// 5e-10 per axis is just under the guard, so the vector is left alone
		const tiny = new Vec3(5e-10, 0, 0)._normalize()
		expect(tiny._x).toBe(5e-10)
		// Just above it the vector is normalized
		const small = new Vec3(2e-9, 0, 0)._normalize()
		expect(small._x).toBeCloseTo(1, 12)
	})

	it('clones and copies are independent of the source', () => {
		const source = new Vec3(1, 2, 3)
		const clone = source._clone()
		const copy = new Vec3()._copy(source)
		source._set(9, 9, 9)
		expect(clone).toEqual(new Vec3(1, 2, 3))
		expect(copy).toEqual(new Vec3(1, 2, 3))
		expect(new Vec3()).toEqual(new Vec3(0, 0, 0))
	})

	it('keeps the components finite for very large magnitudes', () => {
		const huge = new Vec3(1e150, 1e150, 0)._normalize()
		expect(huge._length()).toBeCloseTo(1, 12)
		expect(huge._x).toBeCloseTo(Math.SQRT1_2, 12)
	})
})
