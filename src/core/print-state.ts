import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export interface PrintState extends MachineState {
	phase: 'unprinted' | 'printing' | 'printed'
	generation: number
}

/** @internal */
export type PrintEvent = { type: 'print' } | { type: 'printed' } | { type: 'abort' } | { type: 'reset' }

/** @internal */
export const printInitial: PrintState = { phase: 'unprinted', generation: 0 }

/** @internal */
export function reducePrint(state: Readonly<PrintState>, event: PrintEvent): PrintState | null {
	switch (event.type) {
		case 'print': {
			return state.phase === 'printing' ? null : { phase: 'printing', generation: state.generation + 1 }
		}
		case 'printed': {
			return state.phase === 'printing' ? { ...state, phase: 'printed' } : null
		}
		case 'abort': {
			return { phase: 'unprinted', generation: state.generation + 1 }
		}
		case 'reset': {
			return { phase: 'unprinted', generation: state.generation + 1 }
		}
		default: {
			return assertNever(event)
		}
	}
}
