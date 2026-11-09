import { describe, expect, it } from 'vitest'
import { reduceDrag, type DragPhase } from '$gallery/drag-state'

const run = (events: { type: 'down' | 'activate' | 'up' | 'cancel' }[]): DragPhase =>
	events.reduce<DragPhase>((phase, event) => reduceDrag(phase, event), 'idle')

describe('reduceDrag', () => {
	it('moves idle to pending to dragging to idle', () => {
		expect(run([{ type: 'down' }])).toBe('pending')
		expect(run([{ type: 'down' }, { type: 'activate' }])).toBe('dragging')
		expect(run([{ type: 'down' }, { type: 'activate' }, { type: 'up' }])).toBe('idle')
	})

	it('cancels and ignores a down while active', () => {
		expect(run([{ type: 'down' }, { type: 'cancel' }])).toBe('cancelled')
		expect(reduceDrag('dragging', { type: 'down' })).toBe('dragging')
	})
})
