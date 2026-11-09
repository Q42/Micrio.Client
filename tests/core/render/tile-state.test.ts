import { describe, expect, it } from 'vitest'
import { reduceTilePhase, type TilePhase } from '$render/tile-state'

const run = (events: { type: 'request' | 'loaded' | 'drawn' | 'failed' | 'evict' }[]): TilePhase =>
	events.reduce<TilePhase>((phase, event) => reduceTilePhase(phase, event), 'empty')

describe('reduceTilePhase', () => {
	it('requests, loads and draws one tile', () => {
		expect(run([{ type: 'request' }])).toBe('requesting')
		expect(run([{ type: 'request' }, { type: 'loaded' }])).toBe('ready')
		expect(run([{ type: 'request' }, { type: 'loaded' }, { type: 'drawn' }])).toBe('drawn')
	})

	it('makes a failed request terminal until eviction', () => {
		expect(run([{ type: 'request' }, { type: 'failed' }])).toBe('failed')
		expect(reduceTilePhase('failed', { type: 'loaded' })).toBe('failed')
		expect(reduceTilePhase('failed', { type: 'evict' })).toBe('empty')
	})

	it('ignores invalid transitions and evicts every live phase', () => {
		expect(reduceTilePhase('empty', { type: 'loaded' })).toBe('empty')
		expect(reduceTilePhase('drawn', { type: 'request' })).toBe('drawn')
		for (const phase of ['requesting', 'ready', 'drawn', 'failed'] as const) {
			expect(reduceTilePhase(phase, { type: 'evict' })).toBe('empty')
		}
	})
})
