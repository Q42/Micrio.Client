import { describe, expect, it } from 'vitest'
import { reduceSerial, serialInitial, type SerialContext, type SerialState } from '$tour/serial-tour-state'

const context: SerialContext = { durations: [4, 4], cannotClose: false }
const open = (step = 0): SerialState => reduceSerial(serialInitial, { type: 'open', step }, context) as SerialState

const opened = (state: SerialState, hasMedia = true): SerialState => {
	const next = reduceSerial(state, { type: 'opened', runId: state.runId, hasMedia }, context)
	if (next === null) {
		throw new Error('opened was ignored')
	}
	return next
}

describe('reduceSerial', () => {
	it('opens a step with a new run id', () => {
		const state = open()
		expect(state.phase).toBe('opening')
		expect(state.runId).toBe(1)
		expect(reduceSerial(state, { type: 'open', step: 1 }, context)?.runId).toBe(2)
	})

	it('ignores an opened event from a superseded run', () => {
		const first = open()
		const second = reduceSerial(first, { type: 'open', step: 1 }, context) as SerialState
		expect(reduceSerial(second, { type: 'opened', runId: first.runId, hasMedia: true }, context)).toBeNull()
		expect(opened(second).step).toBe(1)
	})

	it('advances on ended and opens the next run', () => {
		const state = opened(open())
		const next = reduceSerial(state, { type: 'ended' }, context) as SerialState
		expect(next.phase).toBe('opening')
		expect(next.step).toBe(1)
		expect(next.runId).toBe(state.runId + 1)
	})

	it('finishes on the last step only when the tour cannot close', () => {
		const cannotClose: SerialContext = { ...context, cannotClose: true }
		const state = opened(reduceSerial(serialInitial, { type: 'open', step: 1 }, cannotClose) as SerialState)
		const ended = reduceSerial(state, { type: 'ended' }, cannotClose)
		expect(ended?.phase).toBe('finished')
		const closed = reduceSerial(state, { type: 'ended' }, context)
		expect(closed?.phase).toBe('closed')
	})

	it('advances a media step on ended but not by ticking', () => {
		const state = opened(open())
		expect(reduceSerial(state, { type: 'tick' }, context)).toBeNull()
		const ended = reduceSerial(state, { type: 'ended' }, context)
		expect(ended?.phase).toBe('opening')
	})

	it('times a step without media and hands the clock to media when present', () => {
		let state = opened(open(0), false)
		state = reduceSerial(state, { type: 'tick' }, context) as SerialState
		expect(state.elapsed).toBe(0.25)
		state = reduceSerial(state, { type: 'media', runId: state.runId, hasMedia: true }, context) as SerialState
		expect(reduceSerial(state, { type: 'tick' }, context)).toBeNull()
	})

	it('does not advance a paused or blocked step on tick', () => {
		const paused = reduceSerial(opened(open(0), false), { type: 'pause' }, context) as SerialState
		expect(reduceSerial(paused, { type: 'tick' }, context)).toBeNull()
		const blocked = reduceSerial(opened(open(0), false), { type: 'blocked' }, context) as SerialState
		expect(reduceSerial(blocked, { type: 'tick' }, context)).toBeNull()
	})

	it('replays from the first step with a new run', () => {
		const state = reduceSerial(opened(open(1)), { type: 'replay' }, context) as SerialState
		expect(state.phase).toBe('opening')
		expect(state.step).toBe(0)
		expect(state.runId).toBeGreaterThan(1)
	})

	it('closes and reports a broken step', () => {
		const state = opened(open())
		expect(reduceSerial(state, { type: 'close' }, context)?.phase).toBe('closed')
		const broken = reduceSerial(state, { type: 'error', error: 'bad' }, context)
		expect(broken?.phase).toBe('broken')
		expect(broken?.error).toBe('bad')
	})
})
