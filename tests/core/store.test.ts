import { describe, expect, it, vi } from 'vitest'
import { defer, get, lazy, skipFirst, tick, writable, type Writable } from '../../src/core/store'

describe('writable', () => {
	it('emits the current value synchronously on subscribe', () => {
		const store = writable(1)
		const seen: number[] = []
		const unsub = store.subscribe((v) => seen.push(v))
		expect(seen).toEqual([1])
		unsub()
	})

	it('emits undefined for a store created without a value', () => {
		const store = writable<string | undefined>()
		const seen: (string | undefined)[] = []
		const unsub = store.subscribe((v) => seen.push(v))
		unsub()
		expect(seen).toEqual([undefined])
	})

	it('notifies every subscriber on set, in subscription order', () => {
		const store = writable('a')
		const order: string[] = []
		const un1 = store.subscribe(() => order.push('first'))
		const un2 = store.subscribe(() => order.push('second'))
		order.length = 0
		store.set('b')
		expect(order).toEqual(['first', 'second'])
		un1()
		order.length = 0
		store.set('c')
		expect(order).toEqual(['second'])
		un2()
	})

	it('stops notifying after unsubscribe, which is idempotent', () => {
		const store = writable(0)
		const fn = vi.fn()
		const unsub = store.subscribe(fn)
		fn.mockClear()
		unsub()
		unsub()
		store.set(1)
		expect(fn).not.toHaveBeenCalled()
	})

	it('snapshots the subscriber set, so self-unsubscribing does not skip later subscribers', () => {
		const store = writable(0)
		const second = vi.fn()
		const holder: { unsub: () => void } = { unsub: () => {} }
		const first = vi.fn(() => {
			holder.unsub()
		})
		holder.unsub = store.subscribe(first)
		const unsubSecond = store.subscribe(second)
		first.mockClear()
		second.mockClear()
		store.set(1)
		// `first` removed itself during notification; `second` must still run.
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
		store.set(2)
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(2)
		unsubSecond()
	})

	it('includes a subscriber added during the initial emission in later notifications', () => {
		const store = writable(0)
		const late = vi.fn()
		let once = false
		store.subscribe(() => {
			// Subscribing from inside the synchronous initial emission is how
			// dependent stores are wired up in the client.
			if (once) {
				return
			}
			once = true
			store.subscribe(late)
		})
		late.mockClear()
		// `late` was already registered by the time the first set() snapshots.
		store.set(1)
		expect(late).toHaveBeenCalledTimes(1)
	})

	it('de-duplicates the same function subscribed twice (Set semantics)', () => {
		const store = writable(0)
		const fn = vi.fn()
		const un1 = store.subscribe(fn)
		const un2 = store.subscribe(fn)
		fn.mockClear()
		store.set(1)
		// One entry in the Set -> one call; the first unsubscribe already removes it.
		expect(fn).toHaveBeenCalledTimes(1)
		un1()
		fn.mockClear()
		store.set(2)
		expect(fn).not.toHaveBeenCalled()
		un2()
	})

	it('update() receives the current value and stores the return value', () => {
		const store = writable({ n: 1 })
		const seen: { n: number }[] = []
		const unsub = store.subscribe((v) => seen.push(v))
		store.update((v) => ({ n: v.n + 1 }))
		unsub()
		expect(seen).toEqual([{ n: 1 }, { n: 2 }])
	})

	it('notifies during a nested set before continuing the outer notification', () => {
		const store = writable(0)
		const order: number[] = []
		let nested = false
		store.subscribe((v) => {
			order.push(v)
			if (!nested && v === 1) {
				nested = true
				store.set(2)
			}
		})
		order.length = 0
		store.set(1)
		expect(order).toEqual([1, 2])
	})
})

describe('get', () => {
	it('reads a store synchronously without leaving a subscription behind', () => {
		const store = writable(42)
		expect(get(store)).toBe(42)
		store.set(43)
		expect(get(store)).toBe(43)
	})

	it('returns undefined for an unset store', () => {
		expect(get(writable<string>())).toBeUndefined()
	})

	it('reads a Writable passed as a plain subscribe-only object', () => {
		const store: Writable<number> = writable(7)
		const reader: { subscribe: Writable<number>['subscribe'] } = store
		expect(get(reader)).toBe(7)
	})
})

describe('tick', () => {
	it('resolves after the current synchronous block', async () => {
		let resolved = false
		void tick().then(() => {
			resolved = true
		})
		expect(resolved).toBe(false)
		await tick()
		expect(resolved).toBe(true)
	})
})

describe('defer', () => {
	it('coalesces rapid calls into one microtask and keeps the last value', async () => {
		const fn = vi.fn()
		const d = defer<number>(fn)
		d(1)
		d(2)
		d(3)
		expect(fn).not.toHaveBeenCalled()
		await tick()
		expect(fn).toHaveBeenCalledTimes(1)
		expect(fn).toHaveBeenCalledWith(3)
		await tick()
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('can fire again on the next microtask after a flush', async () => {
		const fn = vi.fn()
		const d = defer<number>(fn)
		d(1)
		await tick()
		d(2)
		await tick()
		expect(fn.mock.calls).toEqual([[1], [2]])
	})
})

describe('skipFirst', () => {
	it('swallows exactly the first emission', () => {
		const fn = vi.fn()
		const s = skipFirst<number>(fn)
		s(1)
		expect(fn).not.toHaveBeenCalled()
		s(2)
		s(3)
		expect(fn.mock.calls).toEqual([[2], [3]])
	})
})

describe('lazy', () => {
	it('skips the initial emission and coalesces the rest', async () => {
		const fn = vi.fn()
		const l = lazy<number>(fn)
		l(0) // initial store emission, skipped
		await tick()
		l(1)
		l(2)
		await tick()
		expect(fn.mock.calls).toEqual([[2]])
	})

	it('skips the whole first coalesced batch, not just the first raw value', async () => {
		// `lazy` = defer(skipFirst(fn)): the skip happens after coalescing, so
		// emissions made in the same microtask as the initial one are dropped too.
		const fn = vi.fn()
		const l = lazy<number>(fn)
		l(0) // initial store emission
		l(1)
		l(2)
		await tick()
		expect(fn).not.toHaveBeenCalled()
		l(3)
		await tick()
		expect(fn.mock.calls).toEqual([[3]])
	})

	it('skips only once, even across microtask boundaries', async () => {
		const fn = vi.fn()
		const l = lazy<number>(fn)
		l(0)
		await tick()
		l(1)
		await tick()
		l(2)
		await tick()
		expect(fn.mock.calls).toEqual([[1], [2]])
	})
})
