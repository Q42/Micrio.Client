import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export interface GridTransitionState extends MachineState {
	phase: 'idle' | 'gated' | 'timing' | 'done'
	setId: number
	tiers: readonly { id: string; z: number }[]
}

/** @internal */
export type GridTransitionEvent =
	| { type: 'begin' }
	| { type: 'tiers'; tiers: readonly { id: string; z: number }[] }
	| { type: 'timing' }
	| { type: 'done' }
	| { type: 'cancel' }
	| { type: 'invalidate' }

/** @internal */
export const gridTransitionInitial: GridTransitionState = { phase: 'idle', setId: 0, tiers: [] }

/** @internal */
export function reduceGridTransition(
	state: Readonly<GridTransitionState>,
	event: GridTransitionEvent,
): GridTransitionState | null {
	switch (event.type) {
		case 'begin': {
			return { phase: 'gated', setId: state.setId + 1, tiers: [] }
		}
		case 'tiers': {
			return event.tiers.length === 0 && state.tiers.length === 0 ? null : { ...state, tiers: event.tiers }
		}
		case 'timing': {
			return state.phase === 'gated' ? { ...state, phase: 'timing' } : null
		}
		case 'done': {
			return state.phase === 'idle' || state.phase === 'done' ? null : { ...state, phase: 'done' }
		}
		case 'cancel': {
			return state.phase === 'idle' && state.tiers.length === 0
				? null
				: { ...gridTransitionInitial, setId: state.setId }
		}
		case 'invalidate': {
			return { ...gridTransitionInitial, setId: state.setId + 1 }
		}
		default: {
			return assertNever(event)
		}
	}
}
