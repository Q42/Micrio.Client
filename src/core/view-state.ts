import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export interface ViewState extends MachineState {
	phase: 'idle' | 'loading' | 'switching' | 'shown' | 'error'
}

/** @internal */
export type ViewEvent =
	| { type: 'open' }
	| { type: 'loaded' }
	| { type: 'switch' }
	| { type: 'shown' }
	| { type: 'error' }
	| { type: 'close' }

/** @internal */
export const viewInitial: ViewState = { phase: 'loading' }

/** @internal */
export function reduceView(state: Readonly<ViewState>, event: ViewEvent): ViewState | null {
	switch (event.type) {
		case 'open': {
			return state.phase === 'loading' ? null : { phase: 'loading' }
		}
		case 'loaded': {
			return state.phase === 'loading' ? { phase: 'shown' } : null
		}
		case 'switch': {
			return state.phase === 'switching' ? null : { phase: 'switching' }
		}
		case 'shown': {
			// Always emit: a caller may have written the public store directly.
			return { phase: 'shown' }
		}
		case 'error': {
			return { phase: 'error' }
		}
		case 'close': {
			return { phase: 'idle' }
		}
		default: {
			return assertNever(event)
		}
	}
}
