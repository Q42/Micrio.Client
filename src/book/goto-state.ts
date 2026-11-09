import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export interface GotoState extends MachineState {
	phase: 'idle' | 'stepping' | 'settling'
	target: number
	runId: number
}

/** @internal */
export type GotoEvent =
	| { type: 'goto'; target: number; current: number; pageCount: number }
	| { type: 'settling'; runId: number }
	| { type: 'settled'; runId: number }
	| { type: 'cancel' }

/** @internal */
export const gotoInitial: GotoState = { phase: 'idle', target: 0, runId: 0 }

/** @internal */
export function reduceGoto(state: Readonly<GotoState>, event: GotoEvent): GotoState | null {
	switch (event.type) {
		case 'goto': {
			const target = Math.max(0, Math.min(event.pageCount - 1, event.target))
			if (target === event.current) {
				return null
			}
			return { phase: 'stepping', target, runId: state.runId + 1 }
		}
		case 'settling': {
			if (event.runId !== state.runId || state.phase !== 'stepping') {
				return null
			}
			return { ...state, phase: 'settling' }
		}
		case 'settled': {
			if (event.runId !== state.runId || state.phase === 'idle') {
				return null
			}
			return { ...state, phase: 'idle' }
		}
		case 'cancel': {
			return state.phase === 'idle' ? null : { ...state, phase: 'idle' }
		}
		default: {
			return assertNever(event)
		}
	}
}
