import { describe, expect, it } from 'vitest'
import { markerPopupInitial, reduceMarkerPopup, type MarkerPopupState } from '$markers/marker-popup-state'

const send = (state: MarkerPopupState, event: Parameters<typeof reduceMarkerPopup>[1]): MarkerPopupState =>
	reduceMarkerPopup(state, event) as MarkerPopupState

describe('reduceMarkerPopup', () => {
	it('moves between live and destroying and re-arms a re-opened popup', () => {
		const advancing = send(markerPopupInitial, { type: 'advance' })
		const destroying = send(advancing, { type: 'popup', open: false })
		expect(destroying.phase).toBe('destroying')
		expect(destroying.stepping).toBe(false)
		expect(send(destroying, { type: 'popup', open: true }).phase).toBe('live')
	})

	it('toggles minimization and advances only once', () => {
		const minimized = send(markerPopupInitial, { type: 'minimize', minimized: true })
		expect(minimized.minimized).toBe(true)
		const stepping = send(minimized, { type: 'advance' })
		expect(reduceMarkerPopup(stepping, { type: 'advance' })).toBeNull()
	})

	it('tracks tour-control placement and detaches once', () => {
		expect(send(markerPopupInitial, { type: 'controls', controls: 'pending' }).controls).toBe('pending')
		expect(send(markerPopupInitial, { type: 'controls', controls: 'placed' }).controls).toBe('placed')
		const detached = send(markerPopupInitial, { type: 'removed' })
		expect(detached.phase).toBe('detached')
		expect(reduceMarkerPopup(detached, { type: 'removed' })).toBeNull()
	})
})
