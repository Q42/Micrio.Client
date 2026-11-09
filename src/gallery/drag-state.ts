/** A pointer gesture's lifetime, shared by the swipe strip and the scrubbing bar. @internal */
export type DragPhase = 'idle' | 'pending' | 'dragging' | 'cancelled'

/** @internal */
export type DragEvent = { type: 'down' } | { type: 'activate' } | { type: 'up' } | { type: 'cancel' }

/** @internal */
export function reduceDrag(phase: DragPhase, event: DragEvent): DragPhase {
	switch (event.type) {
		case 'down': {
			return phase === 'idle' ? 'pending' : phase
		}
		case 'activate': {
			return phase === 'pending' ? 'dragging' : phase
		}
		case 'up': {
			return phase === 'idle' ? phase : 'idle'
		}
		case 'cancel': {
			return phase === 'idle' ? phase : 'cancelled'
		}
		default: {
			return phase
		}
	}
}
