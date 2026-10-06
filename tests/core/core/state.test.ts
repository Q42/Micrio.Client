import { describe, expect, it, vi } from 'vitest'
import { State } from '$core/state'
import type { Writable } from '$core/store'
import { get, writable } from '$core/store'

interface MarkerLike {
	id: string
	x: number
	y: number
}

interface Dispatched {
	type: string
	detail: unknown
}

/**
 * The smallest surface `State.Image` touches on a `MicrioImage`:
 * `engine.micrio` with callback arrays, an event dispatcher, and the global marker store.
 */
interface StubMicrio {
	_onZoom: ((d: unknown) => void)[]
	_onMove: ((d: unknown) => void)[]
	events: { _dispatch: (type: string, detail: unknown) => void }
	state: { marker: Writable<MarkerLike | undefined>; $marker: MarkerLike | undefined }
}

/**
 * A stand-in for a `MicrioImage`. `State.Image` only reaches for
 * `image.engine.micrio` plus the zoom/move callbacks, the event dispatcher and
 * the global marker store.
 *
 * The owner back-reference is a getter returning the engine object, which keeps
 * the object graph holdable as plain own properties (no cycles to mirror).
 */
function stubImage() {
	const dispatched: Dispatched[] = []
	const marker: Writable<MarkerLike | undefined> = writable()
	const micrio: StubMicrio = {
		_onZoom: [],
		_onMove: [],
		events: {
			_dispatch: (type: string, detail: unknown) => dispatched.push({ type, detail }),
		},
		state: { marker, $marker: undefined },
	}
	const engine: { micrio: StubMicrio } = { micrio }
	const image = { engine } as unknown as ConstructorParameters<typeof State.Image>[0]
	marker.subscribe((m) => {
		micrio.state.$marker = m
	})
	return { image, micrio, engine, dispatched, marker }
}

describe('State.Main', () => {
	it('mirrors store values onto the private getters', () => {
		const state = new State.Main()
		const tour = { id: 't' } as never
		const marker = { id: 'm' } as never
		expect(state.$tour).toBeUndefined()
		expect(state.$marker).toBeUndefined()
		state.tour.set(tour)
		state.marker.set(marker)
		expect(state.$tour).toBe(tour)
		expect(state.$marker).toBe(marker)
	})

	it('ignores string values written into the stores', () => {
		const state = new State.Main()
		state.tour.set('not-a-tour' as unknown as never)
		state.marker.set('not-a-marker' as unknown as never)
		expect(state.$tour).toBeUndefined()
		expect(state.$marker).toBeUndefined()
	})

	it('starts with empty media state', () => {
		const state = new State.Main()
		expect(state.mediaState.size).toBe(0)
		state.mediaState.set('a', { currentTime: 1.5, paused: true })
		expect(state.mediaState.get('a')).toEqual({ currentTime: 1.5, paused: true })
	})
})

describe('State.Image', () => {
	it('ignores an unset view', () => {
		const { image, dispatched } = stubImage()
		const state = new State.Image(image)
		state.view.set(undefined)
		expect(state.$view).toBeUndefined()
		expect(dispatched).toEqual([])
	})

	it('dispatches zoom and move for a first view', () => {
		const { image, dispatched } = stubImage()
		const state = new State.Image(image)
		state.view.set([0, 0, 1, 1])
		expect(dispatched.map((d) => d.type)).toEqual(['zoom', 'move'])
		expect(dispatched[0]?.detail).toMatchObject({ view: [0, 0, 1, 1], image })
	})

	it('does not re-dispatch for an identical view', () => {
		const { image, dispatched } = stubImage()
		const state = new State.Image(image)
		const view: [number, number, number, number] = [0.1, 0.2, 0.5, 0.5]
		state.view.set(view.slice() as typeof view)
		dispatched.length = 0
		state.view.set(view.slice() as typeof view)
		expect(dispatched).toEqual([])
	})

	it('dispatches move but not zoom when only the position changes', () => {
		const { image, dispatched } = stubImage()
		const state = new State.Image(image)
		state.view.set([0, 0, 0.5, 0.5])
		dispatched.length = 0
		state.view.set([0.25, 0.25, 0.5, 0.5])
		expect(dispatched.map((d) => d.type)).toEqual(['move'])
	})

	it('dispatches zoom when the size changes beyond the epsilon', () => {
		const { image, dispatched } = stubImage()
		const state = new State.Image(image)
		state.view.set([0, 0, 0.5, 0.5])
		dispatched.length = 0
		state.view.set([0, 0, 0.6, 0.5])
		expect(dispatched.map((d) => d.type)).toEqual(['zoom', 'move'])
	})

	it('suppresses a zoom change below the 1e-5 threshold', () => {
		const { image, dispatched } = stubImage()
		const state = new State.Image(image)
		state.view.set([0, 0, 0.5, 0.5])
		dispatched.length = 0
		// (dW + dH) is 1e-6 in total, below the 1e-5 threshold
		state.view.set([0, 0, 0.5 + 5e-7, 0.5 + 5e-7])
		expect(dispatched.map((d) => d.type)).toEqual(['move'])
	})

	it('calls registered zoom/move callbacks as well as dispatching events', () => {
		const { image, micrio } = stubImage()
		const zoom = vi.fn()
		const move = vi.fn()
		micrio._onZoom.push(zoom)
		micrio._onMove.push(move)
		const state = new State.Image(image)
		state.view.set([0, 0, 1, 1])
		expect(zoom).toHaveBeenCalledTimes(1)
		expect(move).toHaveBeenCalledTimes(1)
	})
})

describe('State.Image markers', () => {
	it('exposes an object marker and propagates it to the global state', () => {
		const { image, micrio } = stubImage()
		const state = new State.Image(image)
		const marker: MarkerLike = { id: 'm1', x: 0.5, y: 0.5 }
		state.marker.set(marker)
		expect(state.$marker).toBe(marker)
		expect(micrio.state.$marker).toBe(marker)
	})

	it('resolves a string marker id to undefined locally', () => {
		const { image } = stubImage()
		const state = new State.Image(image)
		state.marker.set('some-id')
		expect(state.$marker).toBeUndefined()
	})

	it('only clears the global marker when it was the active one', () => {
		const { image, micrio } = stubImage()
		const state = new State.Image(image)
		const a: MarkerLike = { id: 'a', x: 0, y: 0 }
		const b: MarkerLike = { id: 'b', x: 1, y: 1 }
		state.marker.set(a)
		// Another image opened marker b
		micrio.state.$marker = b
		state.marker.set(undefined)
		expect(state.$marker).toBeUndefined()
		expect(micrio.state.$marker).toBe(b)

		// Now this image closes its own marker
		micrio.state.$marker = a
		state.marker.set(a)
		state.marker.set(undefined)
		expect(micrio.state.$marker).toBeUndefined()
	})

	it('treats an empty string as a clear', () => {
		const { image, micrio } = stubImage()
		const state = new State.Image(image)
		const a: MarkerLike = { id: 'a', x: 0, y: 0 }
		state.marker.set(a)
		state.marker.set('')
		expect(state.$marker).toBeUndefined()
		expect(micrio.state.$marker).toBeUndefined()
	})

	it('starts on layer 0 without a view', () => {
		const { image } = stubImage()
		const state = new State.Image(image)
		expect(get(state.layer)).toBe(0)
		expect(state.$view).toBeUndefined()
	})
})
