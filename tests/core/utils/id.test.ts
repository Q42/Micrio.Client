import { describe, expect, it } from 'vitest'
import { decodeV5Id, getIdVal, idIsV5, randomUUID } from '$utils/id'

describe('getIdVal', () => {
	it('maps the uppercase alphabet to a 24..48 base', () => {
		expect(getIdVal('A')).toBe(24)
		expect(getIdVal('B')).toBe(25)
		expect(getIdVal('Z')).toBe(48)
	})

	it('maps the lowercase alphabet with the documented "i" and "k" holes', () => {
		expect(getIdVal('a')).toBe(0)
		expect(getIdVal('h')).toBe(7)
		// Both 'i' and 'j' land on 7/8, then 'k' and 'l' collide on 9.
		expect(getIdVal('i')).toBe(7)
		expect(getIdVal('j')).toBe(8)
		expect(getIdVal('k')).toBe(9)
		expect(getIdVal('l')).toBe(9)
		expect(getIdVal('z')).toBe(23)
	})

	it('keeps every value inside the 0..48 range the V5 bit decoder indexes', () => {
		for (const base of [65, 97]) {
			for (let i = 0; i < 26; i++) {
				const v = getIdVal(String.fromCharCode(base + i))
				expect(v).toBeGreaterThanOrEqual(0)
				expect(v).toBeLessThanOrEqual(48)
			}
		}
	})

	it('is monotonic (never decreasing) across the alphabet', () => {
		for (const base of [65, 97]) {
			let prev = -1
			for (let i = 0; i < 26; i++) {
				const v = getIdVal(String.fromCharCode(base + i))
				expect(v).toBeGreaterThanOrEqual(prev)
				prev = v
			}
		}
	})

	it('is case-insensitive up to the case offset for a..h', () => {
		for (let c = 0; c <= 7; c++) {
			const lower = String.fromCharCode(97 + c)
			const upper = String.fromCharCode(65 + c)
			expect(getIdVal(upper) - getIdVal(lower)).toBe(24)
		}
	})

	it('maps non-letter characters into the same small numeric range', () => {
		// Documents why `idIsV5` length checks matter: digits are valid indices too.
		expect(getIdVal('0')).toBe(7)
		expect(getIdVal('9')).toBe(16)
		expect(getIdVal('/')).toBe(6)
	})
})

describe('idIsV5', () => {
	it('is true only for 6- or 7-character ids', () => {
		expect(idIsV5('dzzLm')).toBe(false) // 5 = V4
		expect(idIsV5('rqFkjZ')).toBe(true) // 6 = V5 imported
		expect(idIsV5('rqFkjZz')).toBe(true) // 7 = V5 native
		expect(idIsV5('rqFkjZzz')).toBe(false) // 8
		expect(idIsV5('')).toBe(false)
	})

	it('counts separators towards the length', () => {
		expect(idIsV5('abc/de')).toBe(true)
		expect(idIsV5('external/')).toBe(false)
	})
})

describe('randomUUID', () => {
	it('returns a non-empty string and differs per call', () => {
		const a = randomUUID()
		const b = randomUUID()
		expect(typeof a).toBe('string')
		expect(a.length).toBeGreaterThan(0)
		expect(a).not.toBe(b)
	})
})

/**
 * The packed character index is `1 + (getIdVal(id[0]) % 6)`. The ids below and their
 * expected flags were verified against the live `bundle.json` info for each image.
 */
const decode = (id: string, info: Parameters<typeof decodeV5Id>[1] = {}) => {
	decodeV5Id(id, info)
	return info
}

describe('decodeV5Id', () => {
	it('reads WebP from the low bits and 360 from bit 4', () => {
		// rqFkjZz -> char 'j' (8): 00001000 => webp, deepzoom, r2
		expect(decode('rqFkjZz', { is360: false })).toEqual({
			is360: false,
			isWebP: true,
			isPng: false,
			format: 'dz',
			path: 'https://r2.micr.io/',
		})
	})

	it('keeps an already-true is360 flag', () => {
		const info = decode('rqFkjZz', { is360: true })
		expect(info.is360).toBe(true)
	})

	it('reads PNG and the EU storage flag', () => {
		// QgjdoCK -> char 'o' (12): 00001100 => webp + deepzoom + eu
		expect(decode('QgjdoCK', {})).toMatchObject({
			isWebP: true,
			isPng: false,
			format: 'dz',
			path: 'https://eu.micr.io/',
		})
	})

	it('detects a 360 image that is neither WebP nor PNG', () => {
		// iEvpRg -> char 'v' (19): 00010011 => 360, not webp, not png, r2
		expect(decode('iEvpRg', {})).toMatchObject({
			is360: true,
			isWebP: false,
			isPng: false,
			path: 'https://r2.micr.io/',
		})
		// Bit 3 is clear, so no deepzoom format is forced
		expect(decode('iEvpRg', {}).format).toBeUndefined()
	})

	it('never overwrites an existing path', () => {
		const info = decode('rqFkjZz', { path: 'https://custom.test/' })
		expect(info.path).toBe('https://custom.test/')
	})

	it('only forces deepzoom when the tile id is also V5-shaped', () => {
		// 'j' has the deepzoom bit set
		expect(decode('rqFkjZz', { tilesId: 'rqFkjZz' }).format).toBe('dz')
		expect(decode('rqFkjZz', { tilesId: 'abc' }).format).toBeUndefined()
	})

	it('is deterministic for the same id', () => {
		expect(decode('KUMwoaU', {})).toEqual(decode('KUMwoaU', {}))
	})
})
