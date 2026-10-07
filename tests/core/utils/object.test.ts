import { describe, expect, it } from 'vitest'
import { deepCopy } from '$utils/object'

describe('deepCopy', () => {
	it('merges into an existing target and returns the same object', () => {
		const target: Record<string, unknown> = { a: 1, nested: { x: 1, y: 2 } }
		// `deepCopy` is a partial merge by design: pass a partial source on purpose.
		const result = deepCopy({ b: 2, nested: { y: 3 } }, target)
		expect(result).toBe(target)
		expect(target).toEqual({ a: 1, b: 2, nested: { x: 1, y: 3 } })
	})

	it('recurses into plain objects instead of replacing them', () => {
		const nested: Record<string, unknown> = { x: 1, y: 1 }
		const target: Record<string, unknown> = { nested }
		deepCopy({ nested: { y: 2 } }, target)
		expect(nested.x).toBe(1)
		expect(target.nested).toBe(nested)
		expect(target.nested).toEqual({ x: 1, y: 2 })
	})

	it('respects noOverwrite for existing keys, including explicitly-undefined ones', () => {
		const target: Record<string, unknown> = { a: 1, b: undefined }
		deepCopy({ a: 2, b: 3, c: 4 }, target, { noOverwrite: true })
		expect(target).toEqual({ a: 1, b: undefined, c: 4 })
	})

	it('replaces values when noOverwrite is not set', () => {
		const target: Record<string, unknown> = { a: 1 }
		deepCopy({ a: 2 }, target)
		expect(target.a).toBe(2)
	})

	it('rejects prototype-pollution keys', () => {
		const evil = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"bad":1},"prototype":1,"ok":2}') as Record<
			string,
			unknown
		>
		const target: Record<string, unknown> = {}
		deepCopy(evil, target)
		expect(target.ok).toBe(2)
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
		expect(Object.hasOwn(target, '__proto__')).toBe(false)
		expect(Object.hasOwn(target, 'constructor')).toBe(false)
		expect(Object.hasOwn(target, 'prototype')).toBe(false)
		expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
	})

	it('copies non-plain objects by reference', () => {
		const date = new Date(0)
		const arr = [1, 2, 3]
		class Custom {
			v = 1
		}
		const custom = new Custom()
		const nullProto = Object.create(null) as Record<string, unknown>
		const target: Record<string, unknown> = {}
		deepCopy({ date, arr, custom, nullProto }, target)
		expect(target.date).toBe(date)
		expect(target.arr).toBe(arr)
		expect(target.custom).toBe(custom)
		expect(target.nullProto).toBe(nullProto)
	})

	it('mirrors circular plain-object references instead of recursing forever', () => {
		const a: Record<string, unknown> = { name: 'a' }
		const b: Record<string, unknown> = { name: 'b' }
		a.self = a
		b.other = a
		const target: Record<string, unknown> = {}
		expect(() => deepCopy(b, target)).not.toThrow()
		expect(target.name).toBe('b')
		const other = target.other as Record<string, unknown>
		expect(other.name).toBe('a')
		// The cycle is preserved onto the copy, pointing at the copy itself
		expect(other.self).toBe(other)
		// ...and the source is untouched
		expect(a.self).toBe(a)
	})

	it('shares repeated (non-circular) references between siblings', () => {
		const shared = { v: 1 }
		const target: Record<string, unknown> = {}
		deepCopy({ x: shared, y: shared }, target)
		expect(target.x).toBe(target.y)
		expect(target.x).not.toBe(shared)
	})

	it('returns the target unchanged for non-record input', () => {
		const target = { a: 1 }
		expect(deepCopy(42 as unknown as object, target)).toBe(target)
		expect(deepCopy(null as unknown as object, target)).toBe(target)
		expect(deepCopy({ a: 2 }, null as unknown as object)).toBe(null)
	})

	it('copies falsy-but-valid values', () => {
		const target: Record<string, unknown> = {}
		deepCopy({ a: 0, b: '', c: false, d: null, e: Number.NaN }, target, { noOverwrite: true })
		expect(target).toEqual({ a: 0, b: '', c: false, d: null, e: Number.NaN })
	})
})
