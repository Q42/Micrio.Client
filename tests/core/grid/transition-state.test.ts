import { describe, expect, it } from 'vitest'
import { gridTransitionInitial, reduceGridTransition, type GridTransitionState } from '$grid/transition-state'

const send = (state: GridTransitionState, event: Parameters<typeof reduceGridTransition>[1]): GridTransitionState =>
	reduceGridTransition(state, event) as GridTransitionState

describe('reduceGridTransition', () => {
	it('increments the set id and records tiers', () => {
		const began = send(gridTransitionInitial, { type: 'begin' })
		expect(began.phase).toBe('gated')
		expect(began.setId).toBe(1)
		const tiers = send(began, { type: 'tiers', tiers: [{ id: 'a', z: 3 }] })
		expect(tiers.tiers).toEqual([{ id: 'a', z: 3 }])
	})

	it('moves gated to timing to done', () => {
		const gated = send(gridTransitionInitial, { type: 'begin' })
		const timing = send(gated, { type: 'timing' })
		expect(timing.phase).toBe('timing')
		expect(send(timing, { type: 'done' }).phase).toBe('done')
	})

	it('cancels and clears tiers', () => {
		const tiers = send(send(gridTransitionInitial, { type: 'begin' }), {
			type: 'tiers',
			tiers: [{ id: 'a', z: 3 }],
		})
		expect(send(tiers, { type: 'cancel' })).toEqual({ ...gridTransitionInitial, setId: tiers.setId })
	})
})
