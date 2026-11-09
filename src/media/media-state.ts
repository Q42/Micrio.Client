import { assertNever, type MachineState } from '$core/machine'

/**
 * Playback phases of a media element, independent of which player backend produced them.
 *
 * `seeking` is only entered from `playing`: a paused seek stays paused so its controls are
 * not disabled waiting for a `seeked` event a paused iframe player never sends.
 *
 * @internal
 */
export type MediaPhase = 'idle' | 'ready' | 'playing' | 'seeking' | 'paused' | 'blocked' | 'ended' | 'error'

/** The player that owns the element currently being driven. @internal */
export type MediaBackend = 'element' | 'youtube' | 'vimeo' | 'hls' | 'tour'

/** @internal */
export interface MediaState extends MachineState {
	phase: MediaPhase
	backend: MediaBackend
	currentTime: number
	duration: number
	muted: boolean
}

/** @internal */
export type MediaEvent =
	| {
			type: 'sync'
			currentTime: number
			duration: number
			paused: boolean
			seeking: boolean
			ended: boolean
			muted: boolean
	  }
	| { type: 'time'; currentTime?: number; duration?: number }
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'seeking' }
	| { type: 'seeked' }
	| { type: 'ended' }
	| { type: 'blocked' }
	| { type: 'error' }
	| { type: 'mute'; muted: boolean }

/** @internal */
export const mediaInitial = (backend: MediaBackend, muted: boolean): MediaState => ({
	phase: 'idle',
	backend,
	currentTime: 0,
	duration: 0,
	muted,
})

/** @internal */
export function reduceMedia(state: Readonly<MediaState>, event: MediaEvent): MediaState | null {
	switch (event.type) {
		case 'sync': {
			// The native element reports everything at once; derive one phase from it.
			let phase: MediaPhase
			if (event.ended) {
				phase = 'ended'
			} else if (event.seeking && (state.phase === 'playing' || state.phase === 'seeking')) {
				phase = 'seeking'
			} else if (event.paused) {
				if (state.phase === 'blocked') {
					phase = 'blocked'
				} else if (state.phase === 'idle' || state.phase === 'error') {
					phase = 'ready'
				} else {
					phase = 'paused'
				}
			} else {
				phase = 'playing'
			}
			return {
				...state,
				phase,
				currentTime: event.currentTime,
				duration: event.duration,
				muted: event.muted,
			}
		}
		case 'time': {
			const currentTime = event.currentTime ?? state.currentTime
			const duration = event.duration ?? state.duration
			if (currentTime === state.currentTime && duration === state.duration) {
				return null
			}
			return { ...state, currentTime, duration }
		}
		case 'play': {
			if (state.phase === 'playing') {
				return null
			}
			return { ...state, phase: 'playing' }
		}
		case 'pause': {
			if (state.phase === 'playing' || state.phase === 'seeking') {
				return { ...state, phase: 'paused' }
			}
			return null
		}
		case 'seeking': {
			return state.phase === 'playing' ? { ...state, phase: 'seeking' } : null
		}
		case 'seeked': {
			return state.phase === 'seeking' ? { ...state, phase: 'playing' } : null
		}
		case 'ended': {
			return state.phase === 'ended' ? null : { ...state, phase: 'ended' }
		}
		case 'blocked': {
			return state.phase === 'blocked' ? null : { ...state, phase: 'blocked' }
		}
		case 'error': {
			return state.phase === 'error' ? null : { ...state, phase: 'error' }
		}
		case 'mute': {
			return event.muted === state.muted ? null : { ...state, muted: event.muted }
		}
		default: {
			return assertNever(event)
		}
	}
}
