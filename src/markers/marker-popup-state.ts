import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export interface MarkerPopupState extends MachineState {
	phase: 'live' | 'destroying' | 'detached'
	minimized: boolean
	stepping: boolean
	controls: 'own' | 'pending' | 'tour' | 'placed'
}

/** @internal */
export type MarkerPopupEvent =
	| { type: 'popup'; open: boolean }
	| { type: 'minimize'; minimized: boolean }
	| { type: 'advance' }
	| { type: 'reset-step' }
	| { type: 'controls'; controls: MarkerPopupState['controls'] }
	| { type: 'removed' }

/** @internal */
export const markerPopupInitial: MarkerPopupState = {
	phase: 'live',
	minimized: false,
	stepping: false,
	controls: 'own',
}

/** @internal */
export function reduceMarkerPopup(state: Readonly<MarkerPopupState>, event: MarkerPopupEvent): MarkerPopupState | null {
	switch (event.type) {
		case 'popup': {
			const phase = event.open ? 'live' : 'destroying'
			if (state.phase === phase) {
				// A same-marker re-set must not re-arm the advance latch mid-click.
				return null
			}
			return { ...state, phase, stepping: false }
		}
		case 'minimize': {
			return state.minimized === event.minimized ? null : { ...state, minimized: event.minimized }
		}
		case 'advance': {
			return state.stepping ? null : { ...state, stepping: true }
		}
		case 'reset-step': {
			return state.stepping ? { ...state, stepping: false } : null
		}
		case 'controls': {
			return state.controls === event.controls ? null : { ...state, controls: event.controls }
		}
		case 'removed': {
			return state.phase === 'detached' ? null : { ...state, phase: 'detached' }
		}
		default: {
			return assertNever(event)
		}
	}
}
