import { describe, expect, it } from 'vitest'
import { fmt, parseTime } from '$utils/time'

describe('parseTime', () => {
	it('formats durations as hh:mm:ss, padding every field', () => {
		expect(parseTime(0)).toBe('00:00')
		expect(parseTime(5)).toBe('00:05')
		expect(parseTime(59)).toBe('00:59')
		expect(parseTime(60)).toBe('01:00')
		expect(parseTime(125)).toBe('02:05')
		expect(parseTime(3599)).toBe('59:59')
	})

	it('grows to hours without truncating', () => {
		expect(parseTime(3600)).toBe('01:00:00')
		expect(parseTime(3661)).toBe('01:01:01')
		expect(parseTime(86399)).toBe('23:59:59')
	})

	it('returns 0:00 for NaN instead of "NaN:NaN"', () => {
		expect(parseTime(Number.NaN)).toBe('0:00')
	})

	it('prefixes negative durations with a minus and keeps the magnitude', () => {
		expect(parseTime(-5)).toBe('-00:05')
		expect(parseTime(-3600)).toBe('-01:00:00')
		// -0 is not < 0, so it formats like 0
		expect(parseTime(-0)).toBe('00:00')
	})

	it('truncates fractional seconds', () => {
		expect(parseTime(1.9)).toBe('00:01')
		expect(parseTime(59.999)).toBe('00:59')
	})

	it('keeps sub-hour output the same width as fmt()', () => {
		// Both formatters share the mm:ss width; this is what the tour UI relies on
		for (const s of [0, 5, 59, 60, 125]) {
			expect(parseTime(s)).toBe(fmt(s))
		}
	})
})

describe('fmt', () => {
	it('always returns mm:ss, wrapping past an hour', () => {
		expect(fmt(0)).toBe('00:00')
		expect(fmt(59)).toBe('00:59')
		expect(fmt(61)).toBe('01:01')
		expect(fmt(3599)).toBe('59:59')
		// Date-based implementation wraps at 24h
		expect(fmt(3600)).toBe('00:00')
	})

	it('uses the absolute value', () => {
		expect(fmt(-61)).toBe('01:01')
	})
})
