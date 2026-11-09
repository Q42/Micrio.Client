import { describe, expect, it, vi } from 'vitest'
import { assertNever, createMachine, type MachineState } from '$core/machine'

type Phase = 'idle' | 'running' | 'done'

interface State extends MachineState {
	phase: Phase
	n: number
}

type Event = { type: 'go' } | { type: 'tick' } | { type: 'finish' } | { type: 'ignore' }

const reduce = (state: Readonly<State>, event: Event): State | null => {
	switch (event.type) {
		case 'go': {
			return state.phase === 'idle' ? { ...state, phase: 'running', n: 1 } : null
		}
		case 'tick': {
			return state.phase === 'running' ? { ...state, n: state.n + 1 } : null
		}
		case 'finish': {
			return state.phase === 'running' ? { ...state, phase: 'done' } : null
		}
		case 'ignore': {
			// A same-reference return is a no-op, like null.
			return state
		}
		default: {
			return assertNever(event)
		}
	}
}

const create = (
	opts: {
		historyLimit?: number
		effect?: Parameters<typeof createMachine<State, Event, undefined>>[0]['effect']
		enter?: Parameters<typeof createMachine<State, Event, undefined>>[0]['enter']
		onError?: (error: unknown, event: Event) => void
	} = {},
) =>
	createMachine<State, Event, undefined>({
		initial: { phase: 'idle', n: 0 },
		context: undefined,
		reduce,
		...opts,
	})

describe('createMachine', () => {
	it('emits the current state on subscribe and updates on accepted events only', () => {
		const machine = create()
		const seen: State[] = []
		machine.subscribe((state) => seen.push(state))

		machine.send({ type: 'go' })
		machine.send({ type: 'tick' })
		machine.send({ type: 'ignore' })
		machine.send({ type: 'go' })

		expect(seen).toEqual([
			{ phase: 'idle', n: 0 },
			{ phase: 'running', n: 1 },
			{ phase: 'running', n: 2 },
		])
		expect(machine.$state).toEqual({ phase: 'running', n: 2 })
		machine.dispose()
	})

	it('queues reentrant events in order', () => {
		const machine = create()
		machine.subscribe((state) => {
			if (state.n === 1) {
				machine.send({ type: 'tick' })
			}
		})

		machine.send({ type: 'go' })

		expect(machine.$state).toEqual({ phase: 'running', n: 2 })
		expect(machine.history.map((t) => t.event.type)).toEqual(['go', 'tick'])
		machine.dispose()
	})

	it('runs a transition effect after subscribers and aborts its signal on the next transition', () => {
		const order: string[] = []
		let lastSignal: AbortSignal | undefined
		const machine = create({
			effect: ({ signal, previous, state, event }) => {
				lastSignal = signal
				order.push(`${previous.phase}->${state.phase}:${event.type}`)
			},
		})
		machine.subscribe(() => order.push('subscriber'))
		order.length = 0

		machine.send({ type: 'go' })
		expect(order).toEqual(['subscriber', 'idle->running:go'])
		expect(lastSignal?.aborted).toBe(false)

		machine.send({ type: 'tick' })
		const tickSignal = lastSignal
		expect(order).toEqual(['subscriber', 'idle->running:go', 'subscriber', 'running->running:tick'])
		expect(tickSignal?.aborted).toBe(false)

		machine.send({ type: 'finish' })
		expect(tickSignal?.aborted).toBe(true)
		machine.dispose()
	})

	it('runs a phase enter effect once per phase and aborts it on the phase change', () => {
		let phaseSignal: AbortSignal | undefined
		const entered: Phase[] = []
		const machine = create({
			enter: {
				running: ({ signal }) => {
					phaseSignal = signal
					entered.push('running')
				},
				done: () => {
					entered.push('done')
				},
			},
		})

		machine.send({ type: 'go' })
		const runningSignal = phaseSignal
		machine.send({ type: 'tick' })
		expect(entered).toEqual(['running'])
		expect(runningSignal?.aborted).toBe(false)

		machine.send({ type: 'finish' })
		expect(entered).toEqual(['running', 'done'])
		expect(runningSignal?.aborted).toBe(true)
		machine.dispose()
	})

	it('aborts both effects on dispose and ignores later events', () => {
		let transitionSignal: AbortSignal | undefined
		let phaseSignal: AbortSignal | undefined
		const machine = create({
			effect: ({ signal }) => {
				transitionSignal = signal
			},
			enter: {
				running: ({ signal }) => {
					phaseSignal = signal
				},
			},
		})
		machine.send({ type: 'go' })

		machine.dispose()
		machine.send({ type: 'tick' })

		expect(transitionSignal?.aborted).toBe(true)
		expect(phaseSignal?.aborted).toBe(true)
		expect(machine.$state).toEqual({ phase: 'running', n: 1 })
		expect(machine.history).toHaveLength(0)
		machine.dispose()
	})

	it('routes async effect failures to onError', async () => {
		const onError = vi.fn()
		const machine = create({
			effect: async () => {
				await Promise.resolve()
				throw new Error('effect failed')
			},
			onError,
		})

		machine.send({ type: 'go' })
		await Promise.resolve()
		await Promise.resolve()

		expect(onError).toHaveBeenCalledWith(expect.any(Error), { type: 'go' })
		machine.dispose()
	})

	it('keeps a bounded history', () => {
		const machine = create({ historyLimit: 2 })
		machine.send({ type: 'go' })
		machine.send({ type: 'tick' })
		machine.send({ type: 'tick' })

		expect(machine.history).toHaveLength(2)
		expect(machine.history.map((t) => t.state.n)).toEqual([2, 3])
		machine.dispose()
	})
})
