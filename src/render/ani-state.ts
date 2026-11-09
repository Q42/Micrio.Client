import { assertNever, type MachineState } from '$core/machine'

/** The channel an animation runs on. @internal */
export type AniChannel = 'view' | 'zoom'

/** @internal */
export interface AniState extends MachineState {
	phase: 'idle' | 'view' | 'zoom' | 'paused'
	channel: AniChannel
}

/** @internal */
export type AniEvent =
	| { type: 'start-view' }
	| { type: 'start-zoom' }
	| { type: 'pause' }
	| { type: 'resume' }
	| { type: 'finish' }
	| { type: 'stop' }

/** @internal */
export const aniInitial: AniState = { phase: 'idle', channel: 'view' }

/** @internal */
export function reduceAni(state: Readonly<AniState>, event: AniEvent): AniState | null {
	switch (event.type) {
		case 'start-view': {
			return state.phase === 'view' ? null : { ...state, phase: 'view', channel: 'view' }
		}
		case 'start-zoom': {
			return state.phase === 'zoom' ? null : { ...state, phase: 'zoom', channel: 'zoom' }
		}
		case 'pause': {
			if (state.phase !== 'view' && state.phase !== 'zoom') {
				return null
			}
			return { ...state, phase: 'paused' }
		}
		case 'resume': {
			return state.phase === 'paused' ? { ...state, phase: state.channel } : null
		}
		case 'finish':
		case 'stop': {
			return state.phase === 'idle' ? null : { ...state, phase: 'idle' }
		}
		default: {
			return assertNever(event)
		}
	}
}
