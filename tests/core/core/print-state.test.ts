import { describe, expect, it } from 'vitest'
import { printInitial, reducePrint } from '$core/print-state'

describe('reducePrint', () => {
	it('moves unprinted to printing to printed with one generation per run', () => {
		const printing = reducePrint(printInitial, { type: 'print' })
		expect(printing?.phase).toBe('printing')
		expect(printing?.generation).toBe(1)
		if (printing === null) {
			throw new Error('print was ignored')
		}
		const printed = reducePrint(printing, { type: 'printed' })
		expect(printed?.phase).toBe('printed')
	})

	it('increments the generation on abort', () => {
		const printing = reducePrint(printInitial, { type: 'print' })
		if (printing === null) {
			throw new Error('print was ignored')
		}
		expect(reducePrint(printing, { type: 'abort' })?.generation).toBe(2)
	})
})
