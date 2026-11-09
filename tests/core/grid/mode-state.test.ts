import { describe, expect, it } from 'vitest'
import { gridModeInitial, reduceGridMode, type GridModeState } from '$grid/mode-state'

const send = (state: GridModeState, event: Parameters<typeof reduceGridMode>[1]): GridModeState =>
	reduceGridMode(state, event) as GridModeState

describe('reduceGridMode', () => {
	it('tracks visibility and focus', () => {
		expect(send(gridModeInitial, { type: 'hide' }).visibility).toBe('hidden')
		expect(send(gridModeInitial, { type: 'focus' }).visibility).toBe('focused')
		expect(send(send(gridModeInitial, { type: 'hide' }), { type: 'show-overview' }).visibility).toBe('overview')
	})

	it('tracks the serial transport', () => {
		const paused = send(gridModeInitial, { type: 'serial-pause' })
		expect(paused.serial).toBe('paused')
		expect(send(paused, { type: 'serial-play' }).serial).toBe('playing')
		expect(send(paused, { type: 'serial-idle' }).serial).toBe('idle')
	})
})
