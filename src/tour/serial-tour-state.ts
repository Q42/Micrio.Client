import { assertNever, type MachineState } from '$core/machine'

/**
 * One run of a serial marker tour.
 *
 * `runId` is the only staleness token: every open (natural advance, chapter jump, replay)
 * increments it, and every async completion carries the run it belongs to. `finished` and
 * `closed` are distinct because a `cannotClose` tour stays on its last step.
 *
 * @internal
 */
export type SerialPhase = 'closed' | 'opening' | 'playing' | 'paused' | 'blocked' | 'finished' | 'broken'

/** @internal */
export interface SerialState extends MachineState {
	phase: SerialPhase
	step: number
	runId: number
	elapsed: number
	hasMedia: boolean
	/** The media transport, which is paused until a media step actually plays. */
	transport: 'paused' | 'playing' | 'blocked'
	error?: string
}

/** @internal */
export interface SerialContext {
	readonly durations: readonly number[]
	readonly cannotClose: boolean
}

/** @internal */
export type SerialEvent =
	| { type: 'open'; step: number }
	| { type: 'opened'; runId: number; hasMedia: boolean }
	| { type: 'media'; runId: number; hasMedia: boolean }
	| { type: 'time'; elapsed: number }
	| { type: 'tick' }
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'blocked' }
	| { type: 'ended' }
	| { type: 'next' }
	| { type: 'close' }
	| { type: 'replay' }
	| { type: 'error'; error: string }

/** @internal */
export const serialInitial: SerialState = {
	phase: 'closed',
	step: 0,
	runId: 0,
	elapsed: 0,
	hasMedia: false,
	transport: 'paused',
}

const finish = (state: Readonly<SerialState>, context: SerialContext, error?: string): SerialState => {
	let phase: SerialPhase
	if (error !== undefined) {
		phase = 'broken'
	} else if (context.cannotClose) {
		phase = 'finished'
	} else {
		phase = 'closed'
	}
	return {
		...state,
		phase,
		...(error === undefined ? {} : { error }),
	}
}

/** Advances to the next step, or ends the run on the last one. @internal */
const advance = (state: Readonly<SerialState>, context: SerialContext): SerialState => {
	const next = state.step + 1
	if (next >= context.durations.length) {
		return finish(state, context)
	}
	return {
		...state,
		phase: 'opening',
		step: next,
		runId: state.runId + 1,
		elapsed: 0,
		hasMedia: false,
	}
}

/** @internal */
export function reduceSerial(
	state: Readonly<SerialState>,
	event: SerialEvent,
	context: SerialContext,
): SerialState | null {
	switch (event.type) {
		case 'open': {
			const step = Math.max(0, Math.min(context.durations.length - 1, event.step))
			return {
				...state,
				phase: 'opening',
				step,
				runId: state.runId + 1,
				elapsed: 0,
				hasMedia: false,
				transport: 'paused',
				error: undefined,
			}
		}
		case 'opened': {
			if (event.runId !== state.runId) {
				return null
			}
			if (!event.hasMedia && state.step >= context.durations.length - 1) {
				return finish({ ...state, hasMedia: false }, context)
			}
			return {
				...state,
				phase: 'playing',
				hasMedia: event.hasMedia,
				// A step without media is timed by the tour clock immediately; a media step
				// waits for its own play event before its transport starts.
				transport: event.hasMedia ? 'paused' : 'playing',
			}
		}
		case 'media': {
			if (event.runId !== state.runId || event.hasMedia === state.hasMedia) {
				return null
			}
			return { ...state, hasMedia: event.hasMedia }
		}
		case 'time': {
			if (event.elapsed === state.elapsed) {
				return null
			}
			return { ...state, elapsed: event.elapsed }
		}
		case 'tick': {
			if (state.phase !== 'playing' || state.transport !== 'playing' || state.hasMedia) {
				return null
			}
			const elapsed = state.elapsed + 0.25
			const duration = context.durations[state.step] ?? 0
			if (duration > 0 && elapsed >= duration) {
				return advance(state, context)
			}
			return { ...state, elapsed }
		}
		case 'play': {
			if (state.phase === 'playing' && state.transport === 'playing') {
				return null
			}
			return { ...state, phase: 'playing', transport: 'playing' }
		}
		case 'pause': {
			if (state.phase !== 'playing' || state.transport === 'paused') {
				return null
			}
			return { ...state, phase: 'paused', transport: 'paused' }
		}
		case 'blocked': {
			if (state.phase === 'blocked' && state.transport === 'blocked') {
				return null
			}
			return { ...state, phase: 'blocked', transport: 'blocked' }
		}
		case 'ended': {
			if (state.phase === 'finished' || state.phase === 'closed' || state.phase === 'broken') {
				return null
			}
			return advance(state, context)
		}
		case 'next': {
			return advance(state, context)
		}
		case 'close': {
			return state.phase === 'closed' ? null : finish(state, { ...context, cannotClose: false })
		}
		case 'replay': {
			return {
				...state,
				phase: 'opening',
				step: 0,
				runId: state.runId + 1,
				elapsed: 0,
				hasMedia: false,
				transport: 'paused',
				error: undefined,
			}
		}
		case 'error': {
			return state.phase === 'broken' ? null : finish(state, context, event.error)
		}
		default: {
			return assertNever(event)
		}
	}
}
