import { describe, expect, it } from 'vitest'
import { aniInitial, reduceAni, type AniState } from '$render/ani-state'

const start = (event: { type: 'start-view' } | { type: 'start-zoom' }): AniState =>
	reduceAni(aniInitial, event) as AniState

describe('reduceAni', () => {
	it('switches channels without a paused+running combination', () => {
		const view = start({ type: 'start-view' })
		expect(view.phase).toBe('view')
		const zoom = reduceAni(view, { type: 'start-zoom' })
		expect(zoom?.phase).toBe('zoom')
		expect(zoom?.channel).toBe('zoom')
	})

	it('pauses and resumes on the remembered channel', () => {
		const paused = reduceAni(start({ type: 'start-zoom' }), { type: 'pause' })
		expect(paused?.phase).toBe('paused')
		expect(reduceAni(paused as AniState, { type: 'resume' })?.phase).toBe('zoom')
	})

	it('does not pause an idle animation', () => {
		expect(reduceAni(aniInitial, { type: 'pause' })).toBeNull()
	})

	it('stops and finishes back to idle', () => {
		expect(reduceAni(start({ type: 'start-view' }), { type: 'stop' })?.phase).toBe('idle')
		expect(reduceAni(start({ type: 'start-view' }), { type: 'finish' })?.phase).toBe('idle')
	})
})
