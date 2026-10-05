import { describe, expect, it } from 'vitest'
import { Bicubic, easeInOut, getEasing, getTimingFunction, longitudeDistance } from '../../src/render/easing'

describe('longitudeDistance', () => {
	it('returns the direct distance when it is the shorter one', () => {
		expect(longitudeDistance(0.1, 0.3)).toBeCloseTo(0.2, 12)
		expect(longitudeDistance(0.3, 0.1)).toBeCloseTo(-0.2, 12)
	})

	it('wraps around the 0/1 seam', () => {
		expect(longitudeDistance(0.9, 0.1)).toBeCloseTo(0.2, 12)
		expect(longitudeDistance(0.1, 0.9)).toBeCloseTo(-0.2, 12)
	})

	it('never exceeds half a turn', () => {
		for (let i = 0; i <= 50; i++) {
			for (let j = 0; j <= 50; j++) {
				const d = longitudeDistance(i / 50, j / 50)
				expect(Math.abs(d)).toBeLessThanOrEqual(0.5 + 1e-12)
			}
		}
	})

	it('normalizes inputs outside [0,1] and negatives', () => {
		expect(longitudeDistance(-0.1, 0.1)).toBeCloseTo(0.2, 12)
		expect(longitudeDistance(1.9, 2.1)).toBeCloseTo(0.2, 12)
		expect(longitudeDistance(0, 1)).toBeCloseTo(0, 12)
	})
})

describe('Bicubic', () => {
	it('pins the endpoints', () => {
		for (const fx of [easeInOut, getEasing('ease-in'), getEasing('ease-out'), getEasing('linear')]) {
			expect(fx.get(0)).toBeCloseTo(0, 12)
			expect(fx.get(1)).toBeCloseTo(1, 12)
		}
	})

	it('is linear in the (0,0,1,1) fast path', () => {
		const lin = new Bicubic(0, 0, 1, 1)
		for (let i = 0; i <= 10; i++) {
			expect(lin.get(i / 10)).toBeCloseTo(i / 10, 12)
		}
	})

	it('is monotonically increasing', () => {
		for (const fx of [easeInOut, getEasing('ease'), getEasing('ease-in'), getEasing('ease-out')]) {
			let prev = -1
			for (let i = 0; i <= 1000; i++) {
				const v = fx.get(i / 1000)
				expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
				prev = v
			}
		}
	})

	it('eases in/out around the middle', () => {
		expect(easeInOut.get(0.5)).toBeCloseTo(0.5, 3)
		expect(getEasing('ease-in').get(0.25)).toBeLessThan(0.25)
		expect(getEasing('ease-out').get(0.25)).toBeGreaterThan(0.25)
	})
})

describe('lookups', () => {
	it('resolves timing function indices, defaulting to easeInOut', () => {
		expect(getTimingFunction(3)).toBe(getEasing('linear'))
		expect(getTimingFunction(99)).toBe(easeInOut)
		expect(getTimingFunction(-1)).toBe(easeInOut)
	})

	it('resolves names, defaulting to easeInOut', () => {
		expect(getEasing('linear')).toBe(getTimingFunction(3))
		expect(getEasing()).toBe(easeInOut)
		expect(getEasing('nope')).toBe(easeInOut)
	})
})
