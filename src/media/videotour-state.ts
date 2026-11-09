import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export type VideoTourPhase = 'idle' | 'playing' | 'paused' | 'ended'

/** One clock, one segment and one phase for a video tour. @internal */
export interface VideoTourState extends MachineState {
	phase: VideoTourPhase
	segment: number
	startedAt: number
	pausedAt: number
	runId: number
}

/** @internal */
export interface VideoTourContext {
	readonly duration: number
}

/** @internal */
export type VideoTourEvent =
	| { type: 'play'; now: number }
	| { type: 'pause'; now: number }
	| { type: 'seek'; ms: number; now: number; resume: boolean }
	| { type: 'segment'; index: number }
	| { type: 'finish' }
	| { type: 'rewind' }
	| { type: 'destroy' }

/** @internal */
export const videoTourInitial: VideoTourState = {
	phase: 'idle',
	segment: -1,
	startedAt: 0,
	pausedAt: 0,
	runId: 0,
}

/** @internal */
export function reduceVideoTour(
	state: Readonly<VideoTourState>,
	event: VideoTourEvent,
	context: VideoTourContext,
): VideoTourState | null {
	switch (event.type) {
		case 'play': {
			if (state.phase === 'playing') {
				return null
			}
			if (state.phase === 'paused' && state.pausedAt > 0) {
				return { ...state, phase: 'playing', startedAt: event.now - state.pausedAt, pausedAt: 0 }
			}
			return { ...state, phase: 'playing', segment: -1, startedAt: event.now, pausedAt: 0, runId: state.runId + 1 }
		}
		case 'pause': {
			if (state.phase !== 'playing' || state.startedAt === 0) {
				return null
			}
			const elapsed = event.now - state.startedAt
			if (elapsed >= context.duration * 1000) {
				return { ...state, phase: 'idle', segment: -1, startedAt: 0, pausedAt: 0, runId: state.runId + 1 }
			}
			return { ...state, phase: 'paused', startedAt: 0, pausedAt: elapsed }
		}
		case 'seek': {
			const ms = Math.max(0, Math.min(context.duration * 1000, event.ms))
			if (ms >= context.duration * 1000) {
				return { ...state, phase: 'ended', startedAt: 0, pausedAt: 0, runId: state.runId + 1 }
			}
			if (event.resume) {
				return { ...state, phase: 'playing', startedAt: event.now - ms, pausedAt: 0, runId: state.runId + 1 }
			}
			return { ...state, phase: 'paused', startedAt: 0, pausedAt: ms, runId: state.runId + 1 }
		}
		case 'segment': {
			return event.index === state.segment ? null : { ...state, segment: event.index }
		}
		case 'finish': {
			return state.phase === 'ended' ? null : { ...state, phase: 'ended', startedAt: 0, pausedAt: 0 }
		}
		case 'rewind':
		case 'destroy': {
			return state.phase === 'idle' && state.segment === -1 && state.startedAt === 0 && state.pausedAt === 0
				? null
				: { ...state, phase: 'idle', segment: -1, startedAt: 0, pausedAt: 0, runId: state.runId + 1 }
		}
		default: {
			return assertNever(event)
		}
	}
}
