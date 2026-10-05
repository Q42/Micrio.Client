import { describe, expect, it } from 'vitest'
import { isRTL } from '../../src/core/i18n/locale'

describe('isRTL', () => {
	it('recognizes every right-to-left base language', () => {
		for (const lang of ['ar', 'dv', 'fa', 'he', 'iw', 'ku', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi']) {
			expect(isRTL(lang), lang).toBe(true)
		}
	})

	it('recognizes regional variants', () => {
		expect(isRTL('ar-EG')).toBe(true)
		expect(isRTL('he-IL')).toBe(true)
		expect(isRTL('fa-IR')).toBe(true)
	})

	it('rejects left-to-right and near-miss codes', () => {
		expect(isRTL('en')).toBe(false)
		expect(isRTL('en-US')).toBe(false)
		expect(isRTL('nl')).toBe(false)
		expect(isRTL('de')).toBe(false)
		expect(isRTL('')).toBe(false)
		// Only a `xx-` variant counts as a match, so longer words must not match
		expect(isRTL('arabic')).toBe(false)
		expect(isRTL('hebrew')).toBe(false)
		expect(isRTL('urance')).toBe(false)
	})

	it('is case-sensitive for the base code (documents the input contract)', () => {
		// Micrio language codes come from bundle data and are lower case.
		expect(isRTL('AR')).toBe(false)
		expect(isRTL('AR-EG')).toBe(false)
	})
})
