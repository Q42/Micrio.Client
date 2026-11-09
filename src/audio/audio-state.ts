import { assertNever, type MachineState } from '$core/machine'

/** The module-wide audio unlock phase. @internal */
export interface AudioState extends MachineState {
	phase: 'locked' | 'probing' | 'blocked' | 'unlocked'
}

/** @internal */
export type AudioEvent = { type: 'probe' } | { type: 'probe-ok' } | { type: 'probe-blocked' } | { type: 'gesture' }

/** @internal */
export const audioInitial: AudioState = { phase: 'locked' }

/** @internal */
export function reduceAudio(state: Readonly<AudioState>, event: AudioEvent): AudioState | null {
	switch (event.type) {
		case 'probe': {
			return state.phase === 'locked' ? { phase: 'probing' } : null
		}
		case 'probe-ok': {
			return state.phase === 'probing' ? { phase: 'unlocked' } : null
		}
		case 'probe-blocked': {
			return state.phase === 'probing' ? { phase: 'blocked' } : null
		}
		case 'gesture': {
			return state.phase === 'unlocked' ? null : { phase: 'unlocked' }
		}
		default: {
			return assertNever(event)
		}
	}
}
