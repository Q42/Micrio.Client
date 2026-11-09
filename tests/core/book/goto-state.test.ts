import { describe, expect, it } from 'vitest'
import { gotoInitial, reduceGoto, type GotoState } from '$book/goto-state'

const start = (target = 3): GotoState =>
	reduceGoto(gotoInitial, { type: 'goto', target, current: 0, pageCount: 5 }) as GotoState

describe('reduceGoto', () => {
	it('ignores a goto to the current page and clamps the target', () => {
		expect(reduceGoto(gotoInitial, { type: 'goto', target: 0, current: 0, pageCount: 5 })).toBeNull()
		const state = reduceGoto(gotoInitial, { type: 'goto', target: 99, current: 0, pageCount: 5 })
		expect(state?.target).toBe(4)
		expect(state?.phase).toBe('stepping')
	})

	it('increments the run id and settles only its own run', () => {
		const first = start()
		const second = reduceGoto(first, { type: 'goto', target: 1, current: 0, pageCount: 5 }) as GotoState
		expect(second.runId).toBe(first.runId + 1)
		expect(reduceGoto(second, { type: 'settled', runId: first.runId })).toBeNull()
		expect(reduceGoto(second, { type: 'settling', runId: first.runId })).toBeNull()
		expect(reduceGoto(second, { type: 'settling', runId: second.runId })?.phase).toBe('settling')
		expect(reduceGoto(second, { type: 'settled', runId: second.runId })?.phase).toBe('idle')
	})

	it('cancels a run', () => {
		expect(reduceGoto(start(), { type: 'cancel' })?.phase).toBe('idle')
	})
})
