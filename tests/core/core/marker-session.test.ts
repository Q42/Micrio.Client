import { describe, expect, it } from 'vitest'
import { markerSessionInitial, reduceMarkerSession, type MarkerSessionState } from '$core/marker-session'

const send = (state: MarkerSessionState, event: Parameters<typeof reduceMarkerSession>[1]): MarkerSessionState =>
	reduceMarkerSession(state, event) as MarkerSessionState

describe('reduceMarkerSession', () => {
	it('opens and closes a selected marker', () => {
		const opening = send(markerSessionInitial, { type: 'select', markerId: 'm1' })
		expect(opening.phase).toBe('opening')
		const open = send(opening, { type: 'opened' })
		expect(open.phase).toBe('open')
		const closed = send(open, { type: 'close' })
		expect(closed.phase).toBe('closed')
		expect(closed.markerId).toBeUndefined()
	})

	it('keeps a popup for a link hand-off', () => {
		const kept = send(send(markerSessionInitial, { type: 'select', markerId: 'm1' }), { type: 'link-follow' })
		expect(kept.phase).toBe('kept-for-link')
		expect(kept.popup).toBe(true)
	})
})
