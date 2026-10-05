import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicrioError } from '../../src/core/error'
import { fetchJson, jsonCache } from '../../src/utils/fetch'

const ok = (body: unknown): Response =>
	({
		status: 200,
		json: () => Promise.resolve(body),
	}) as Response

/** A promise plus the resolver that settles it, for asserting in-flight de-duplication. */
function deferred<T>() {
	const ref: { settle: (value: T) => void } = { settle: () => {} }
	const promise = new Promise<T>((resolve) => {
		ref.settle = resolve
	})
	return {
		promise,
		settle: (value: T) => {
			ref.settle(value)
		},
	}
}

afterEach(() => {
	jsonCache.clear()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('fetchJson', () => {
	it('fetches, caches and returns the parsed JSON', async () => {
		const fetchMock = vi.fn().mockResolvedValue(ok({ a: 1 }))
		vi.stubGlobal('fetch', fetchMock)

		expect(await fetchJson<{ a: number }>('https://x/y')).toEqual({ a: 1 })
		expect(await fetchJson<{ a: number }>('https://x/y')).toEqual({ a: 1 })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('returns a clone, so mutating the result cannot poison the cache', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ nested: { n: 1 } })))
		const first = await fetchJson<{ nested: { n: number } }>('https://x/clone')
		expect(first).toBeDefined()
		if (!first) {
			throw new Error('unreachable')
		}
		first.nested.n = 99
		const second = await fetchJson<{ nested: { n: number } }>('https://x/clone')
		expect(second?.nested.n).toBe(1)
	})

	it('shares one in-flight request between concurrent callers', async () => {
		const body = deferred<unknown>()
		const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: () => body.promise } as Response)
		vi.stubGlobal('fetch', fetchMock)

		const a = fetchJson('https://x/inflight')
		const b = fetchJson('https://x/inflight')
		body.settle({ done: true })
		expect(await a).toEqual({ done: true })
		expect(await b).toEqual({ done: true })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('bypasses the cache and appends a cache-buster with noCache', async () => {
		const fetchMock = vi.fn().mockResolvedValue(ok({ n: 1 }))
		vi.stubGlobal('fetch', fetchMock)
		await fetchJson('https://x/nc')
		await fetchJson('https://x/nc', true)
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://x/nc')
		expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/^https:\/\/x\/nc\?[\d.]+$/)
		// noCache results are not stored
		expect(jsonCache.has('https://x/nc')).toBe(true)
	})

	it('appends the cache-buster correctly when the URI already has a query', async () => {
		const fetchMock = vi.fn().mockResolvedValue(ok({}))
		vi.stubGlobal('fetch', fetchMock)
		await fetchJson('https://x/q?v=1', true)
		expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/x\/q\?v=1&[\d.]+$/)
	})

	it('throws a MicrioError carrying the status for a non-200 response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 } as Response))
		await expect(fetchJson('https://x/missing')).rejects.toBeInstanceOf(MicrioError)
		await expect(fetchJson('https://x/missing')).rejects.toMatchObject({ statusCode: 404 })
	})

	it('does not cache a failure and retries on the next call', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ status: 500 } as Response)
			.mockResolvedValueOnce(ok({ recovered: true }))
		vi.stubGlobal('fetch', fetchMock)

		await expect(fetchJson('https://x/flaky')).rejects.toBeInstanceOf(MicrioError)
		expect(jsonCache.has('https://x/flaky')).toBe(false)
		expect(await fetchJson('https://x/flaky')).toEqual({ recovered: true })
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('propagates a network rejection and clears the in-flight entry', async () => {
		const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok({ ok: 1 }))
		vi.stubGlobal('fetch', fetchMock)
		await expect(fetchJson('https://x/offline')).rejects.toThrow('offline')
		expect(await fetchJson('https://x/offline')).toEqual({ ok: 1 })
	})
})
