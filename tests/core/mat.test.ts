import { describe, expect, it } from 'vitest'
import { Mat4, Vec4 } from '../../src/render/mat'

/** Compares two matrices element-wise, tolerating Float32 precision. */
function expectMatClose(actual: Float32Array, expected: number[], precision = 5) {
	expect(actual.length).toBe(expected.length)
	for (let i = 0; i < expected.length; i++) {
		expect(actual[i], `element ${i}`).toBeCloseTo(expected[i], precision)
	}
}

const translation = (x: number, y: number, z: number) => {
	const m = new Mat4()
	m._translate(x, y, z)
	return m
}

describe('Mat4 basics', () => {
	it('starts as the identity and can be reset', () => {
		const m = new Mat4()
		expect([...m.arr]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
		m._scale(2, 3, 4)
		m._identity()
		expect([...m.arr]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
	})

	it('accepts column-major constructor values', () => {
		const m = new Mat4(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
		expect([...m.arr]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
	})

	it('_copy duplicates the source', () => {
		const a = translation(1, 2, 3)
		const b = new Mat4()
		b._copy(a)
		expect([...b.arr]).toEqual([...a.arr])
	})
})

describe('Mat4 transforms', () => {
	it('_translate accumulates into the translation column', () => {
		const m = translation(1, 2, 3)
		m._translate(4, 5, 6)
		expect(m.arr[12]).toBe(5)
		expect(m.arr[13]).toBe(7)
		expect(m.arr[14]).toBe(9)
	})

	it('_scaleFlat scales only the X/Y columns', () => {
		const m = new Mat4()
		m._scaleFlat(2)
		expect(m.arr[0]).toBe(2)
		expect(m.arr[5]).toBe(2)
		expect(m.arr[10]).toBe(1)
	})

	it('_scale defaults z to 1', () => {
		const m = new Mat4()
		m._scale(2, 3)
		expect(m.arr[0]).toBe(2)
		expect(m.arr[5]).toBe(3)
		expect(m.arr[10]).toBe(1)
	})

	it('_rotateX is a right-handed rotation about X', () => {
		const m = new Mat4()
		m._rotateX(Math.PI / 2)
		// Column 1 (Y axis) maps to +Z, column 2 (Z axis) maps to -Y
		expectMatClose(m.arr.slice(0, 4), [1, 0, 0, 0])
		expectMatClose(m.arr.slice(4, 8), [0, 0, 1, 0])
		expectMatClose(m.arr.slice(8, 12), [0, -1, 0, 0])
	})

	it('_rotateZ is a right-handed rotation about Z', () => {
		const m = new Mat4()
		m._rotateZ(Math.PI / 2)
		expectMatClose(m.arr.slice(0, 4), [0, 1, 0, 0])
		expectMatClose(m.arr.slice(4, 8), [-1, 0, 0, 0])
	})

	it('two quarter turns equal one half turn', () => {
		const a = new Mat4()
		a._rotateY(Math.PI / 2)
		a._rotateY(Math.PI / 2)
		const b = new Mat4()
		b._rotateY(Math.PI)
		expectMatClose(a.arr, [...b.arr])
	})

	it('a full turn is the identity again', () => {
		const m = new Mat4()
		m._rotateY(Math.PI * 2)
		expectMatClose(m.arr, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
	})
})

describe('Mat4 projections', () => {
	it('_perspective places the documented elements', () => {
		const m = new Mat4()
		m._perspective(Math.PI / 2, 2, 1, 10)
		expect(m.arr[0]).toBeCloseTo(1 / 2, 6) // f/aspect, f = 1/tan(pi/4) = 1
		expect(m.arr[5]).toBeCloseTo(1, 6)
		expect(m.arr[11]).toBe(-1)
		expect(m.arr[15]).toBe(0)
		expect(m.arr[10]).toBeCloseTo((10 + 1) / (1 - 10), 5)
		expect(m.arr[14]).toBeCloseTo((2 * 10 * 1) / (1 - 10), 5)
	})

	it('_perspectiveCss only sets the focal scale', () => {
		const m = new Mat4()
		m._perspectiveCss(Math.PI / 2)
		expect(m.arr[0]).toBeCloseTo(1, 6)
		expect(m.arr[5]).toBeCloseTo(1, 6)
		expect(m.arr[15]).toBe(1)
	})

	it('_lookAt produces a rigid orthonormal view matrix', () => {
		const m = new Mat4()
		m._lookAt(0, 0, 5, 0, 0, 0, 0, 1, 0)
		// Looking down -Z from +5, with +Y up: identity rotation, translated -5 in Z
		expectMatClose(m.arr, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1])
	})

	it('_lookAt survives degenerate input (eye == target)', () => {
		const m = new Mat4()
		m._lookAt(1, 1, 1, 1, 1, 1, 0, 1, 0)
		expect([...m.arr].every(Number.isFinite)).toBe(true)
	})

	it('_lookAt survives an up vector parallel to the view direction', () => {
		const m = new Mat4()
		m._lookAt(0, 0, 0, 0, 5, 0, 0, 1, 0)
		expect([...m.arr].every(Number.isFinite)).toBe(true)
	})
})

describe('Mat4 multiplication and inversion', () => {
	it('multiplying by the identity is a no-op', () => {
		const m = translation(1, 2, 3)
		const before = [...m.arr]
		m._multiply(new Mat4())
		expect([...m.arr]).toEqual(before)
	})

	it('applies the right-hand operand before the left-hand one', () => {
		const rot = new Mat4()
		rot._rotateZ(Math.PI / 2)
		const a = new Mat4()
		a._copy(rot)
		a._multiply(translation(1, 0, 0))

		const b = translation(1, 0, 0)
		b._multiply(rot)

		expect([...a.arr]).not.toEqual([...b.arr])
		// `this._multiply(o)` applies `o` *first*: rotate-then-translate puts the
		// origin at (1,0,0), while translate-then-rotate puts it at (0,1,0).
		expect(a.arr[12]).toBeCloseTo(1, 5)
		expect(a.arr[13]).toBeCloseTo(0, 5)
		expect(b.arr[12]).toBeCloseTo(0, 5)
		expect(b.arr[13]).toBeCloseTo(1, 5)
	})

	it('_invert round-trips a translation+scale', () => {
		const m = translation(3, -4, 5)
		m._scale(2, 4, 1)
		const inv = new Mat4()
		inv._copy(m)
		inv._invert()
		const product = new Mat4()
		product._copy(m)
		product._multiply(inv)
		expectMatClose(product.arr, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 4)
	})

	it('_invert leaves a singular matrix untouched', () => {
		const m = new Mat4(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
		const before = [...m.arr]
		m._invert()
		expect([...m.arr]).toEqual(before)
	})

	it('inverting twice returns the original', () => {
		const m = translation(1, 2, 3)
		const before = [...m.arr]
		m._invert()
		m._invert()
		expect(m.arr[12]).toBeCloseTo(before[12] ?? 0, 4)
		expect(m.arr[13]).toBeCloseTo(before[13] ?? 0, 4)
	})
})

describe('Vec4', () => {
	it('transforms with the w-division guard when w would be 0', () => {
		const m = new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0)
		const v = new Vec4(2, 3, 4)
		v._transformMat4(m)
		// a[15] is 0 and the other w terms are 0, so w falls back to 1
		expect(v.w).toBe(1)
		expect(v.x).toBe(2)
		expect(v.y).toBe(3)
		expect(v.z).toBe(4)
	})

	it('applies the perspective divide', () => {
		const m = new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2)
		const v = new Vec4(2, 4, 6)
		v._transformMat4(m)
		expect(v.w).toBe(2)
		expect(v.x).toBe(1)
		expect(v.y).toBe(2)
		expect(v.z).toBe(3)
	})

	it('_normalize makes the vector unit length and is a no-op at the origin', () => {
		const v = new Vec4(0, 3, 4)
		v._normalize()
		expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6)
		const zero = new Vec4(0, 0, 0)
		zero._normalize()
		expect([zero.x, zero.y, zero.z]).toEqual([0, 0, 0])
	})

	it('_copy duplicates every component', () => {
		const a = new Vec4(1, 2, 3, 4)
		const b = new Vec4()
		b._copy(a)
		expect([b.x, b.y, b.z, b.w]).toEqual([1, 2, 3, 4])
	})
})
