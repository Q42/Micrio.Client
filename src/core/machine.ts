import type { Readable, Subscriber } from '$core/store'

/**
 * # Minimal typed state machine
 *
 * A component-level reducer with explicit phases, queued events and cancellable effects.
 * It is deliberately small: there is no statechart layer, no global registry and no
 * dependency. The state is a plain object whose `phase` discriminant makes the legal
 * combinations explicit; the reducer is a pure `(state, event) => next | null` function.
 *
 * Effects run after subscribers and are split by lifetime:
 *
 * - `effect` runs on every accepted transition. Its signal aborts on the next transition
 *   (or disposal), which suits one-shot async work such as a fetch or a public event.
 * - `enter[phase]` runs on entering a phase. Its signal survives same-phase transitions and
 *   aborts only when that phase is left (or the machine is disposed), which suits a ticker
 *   or an adapter listener.
 *
 * This is for component state, not hot paths: a machine per tile or a state object per
 * animation frame would cost more than the flags it replaces.
 *
 * @author Marcel Duin <marcel@micr.io>
 */

/** The only shape the runtime requires: a discriminant that effects can key on. */
export interface MachineState {
	readonly phase: string
}

/** Returns the next state, or `null` when the event does not apply. */
export type MachineReducer<S extends MachineState, E, C> = (state: Readonly<S>, event: E, context: C) => S | null

/** The arguments every effect receives. */
export interface MachineArgs<S extends MachineState, E, C> {
	readonly state: Readonly<S>
	readonly previous: Readonly<S>
	readonly event: E
	readonly context: C
	readonly signal: AbortSignal
}

/** Configuration for {@link createMachine}. */
export interface MachineOptions<S extends MachineState, E, C> {
	initial: S
	context: C
	reduce: MachineReducer<S, E, C>
	/** Runs after every accepted transition; signal aborts on the next transition. */
	effect?: (args: MachineArgs<S, E, C>) => void | Promise<void>
	/** Runs when entering a phase; signal aborts on leaving the phase or disposal. */
	enter?: Partial<Record<S['phase'], (args: MachineArgs<S, E, C>) => void | Promise<void>>>
}

/** The read-only machine surface. */
export interface Machine<S extends MachineState, E> extends Readable<S> {
	readonly $state: S
	send: (event: E) => void
	dispose: () => void
}

/**
 * Throws for a variant that an exhaustive switch forgot. Reducers use this so a new phase
 * or event fails type-checking instead of falling into a silent default.
 * @internal
 */
export function assertNever(value: never): never {
	throw new Error(`Unhandled machine variant: ${JSON.stringify(value)}`)
}

/** Reports an effect failure that the machine does not otherwise surface. @internal */
const report = (error: unknown): void => {
	console.error('[Micrio] Machine effect failed:', error)
}

/**
 * Creates a machine from a reducer and optional phase/transition effects.
 * @internal
 */
export function createMachine<S extends MachineState, E, C>(options: MachineOptions<S, E, C>): Machine<S, E> {
	let state = options.initial
	let disposed = false
	let processing = false
	let transitionAbort: AbortController | undefined
	let phaseAbort: AbortController | undefined

	const subscribers = new Set<Subscriber<S>>()
	const queue: E[] = []

	const run = (
		effect: ((args: MachineArgs<S, E, C>) => void | Promise<void>) | undefined,
		args: MachineArgs<S, E, C>,
	): void => {
		if (effect === undefined) {
			return
		}
		try {
			const result = effect(args)
			if (result instanceof Promise) {
				void result.catch((error: unknown) => {
					if (!disposed) {
						report(error)
					}
				})
			}
		} catch (error) {
			if (!disposed) {
				report(error)
			}
		}
	}

	const transition = (event: E): void => {
		const previous = state
		const next = options.reduce(previous, event, options.context)
		if (next === null || Object.is(next, previous)) {
			return
		}

		const phaseChanged = previous.phase !== next.phase
		transitionAbort?.abort()
		transitionAbort = new AbortController()
		if (phaseChanged) {
			phaseAbort?.abort()
			phaseAbort = new AbortController()
		}

		state = next

		// Snapshot: a subscriber may add/remove another subscriber while being notified.
		for (const subscriber of Array.from(subscribers)) {
			subscriber(next)
		}

		const transitionArgs: MachineArgs<S, E, C> = {
			state: next,
			previous,
			event,
			context: options.context,
			signal: transitionAbort.signal,
		}

		if (phaseChanged && phaseAbort !== undefined) {
			// The constraint widens `phase` to string; the state union's literal key is exact.
			const phase = next.phase as S['phase']
			run(options.enter?.[phase], {
				...transitionArgs,
				signal: phaseAbort.signal,
			})
		}
		run(options.effect, transitionArgs)
	}

	return {
		get $state(): S {
			return state
		},
		subscribe(runSubscriber: Subscriber<S>): () => void {
			if (disposed) {
				runSubscriber(state)
				return () => {}
			}
			subscribers.add(runSubscriber)
			runSubscriber(state)
			return () => {
				subscribers.delete(runSubscriber)
			}
		},
		send(event: E): void {
			if (disposed) {
				return
			}
			queue.push(event)
			if (processing) {
				return
			}
			processing = true
			try {
				while (queue.length > 0) {
					const next = queue[0]
					queue.shift()
					transition(next)
				}
			} finally {
				processing = false
			}
		},
		dispose(): void {
			if (disposed) {
				return
			}
			disposed = true
			queue.length = 0
			subscribers.clear()
			transitionAbort?.abort()
			transitionAbort = undefined
			phaseAbort?.abort()
			phaseAbort = undefined
		},
	}
}
