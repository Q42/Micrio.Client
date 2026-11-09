import { assertNever, type MachineState } from '$core/machine'

/** How the grid is currently presented. @internal */
export type GridVisibility = 'overview' | 'hidden' | 'focused' | 'non-clickable'

/** The serial-tour transport mirror owned by the grid. @internal */
export type GridSerial = 'idle' | 'playing' | 'paused'

/** @internal */
export interface GridModeState extends MachineState {
	phase: 'mode'
	visibility: GridVisibility
	serial: GridSerial
}

/** @internal */
export type GridModeEvent =
	| { type: 'show-overview' }
	| { type: 'hide' }
	| { type: 'focus' }
	| { type: 'non-clickable' }
	| { type: 'serial-play' }
	| { type: 'serial-pause' }
	| { type: 'serial-idle' }

/** @internal */
export const gridModeInitial: GridModeState = { phase: 'mode', visibility: 'overview', serial: 'idle' }

/** @internal */
export function reduceGridMode(state: Readonly<GridModeState>, event: GridModeEvent): GridModeState | null {
	switch (event.type) {
		case 'show-overview': {
			return state.visibility === 'overview' ? null : { ...state, visibility: 'overview' }
		}
		case 'hide': {
			return state.visibility === 'hidden' ? null : { ...state, visibility: 'hidden' }
		}
		case 'focus': {
			return state.visibility === 'focused' ? null : { ...state, visibility: 'focused' }
		}
		case 'non-clickable': {
			return state.visibility === 'non-clickable' ? null : { ...state, visibility: 'non-clickable' }
		}
		case 'serial-play': {
			return state.serial === 'playing' ? null : { ...state, serial: 'playing' }
		}
		case 'serial-pause': {
			return state.serial === 'paused' ? null : { ...state, serial: 'paused' }
		}
		case 'serial-idle': {
			return state.serial === 'idle' ? null : { ...state, serial: 'idle' }
		}
		default: {
			return assertNever(event)
		}
	}
}
