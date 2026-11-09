import { describe, expect, it } from 'vitest'
import { reduceView, viewInitial } from '$core/view-state'

describe('reduceView', () => {
	it('moves loading to switching to shown', () => {
		expect(reduceView(viewInitial, { type: 'loaded' })?.phase).toBe('shown')
		expect(reduceView(viewInitial, { type: 'switch' })?.phase).toBe('switching')
		expect(reduceView({ phase: 'switching' }, { type: 'shown' })?.phase).toBe('shown')
	})

	it('always recovers from an error', () => {
		expect(reduceView({ phase: 'loading' }, { type: 'error' })?.phase).toBe('error')
		expect(reduceView({ phase: 'error' }, { type: 'open' })?.phase).toBe('loading')
	})
})
