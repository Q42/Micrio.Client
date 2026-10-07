import { afterEach, describe, expect, it, vi } from 'vitest'
import { archive } from '$utils/archive'

/** Builds one 32-byte MDP header entry: 20 bytes of name, 12 bytes of octal size. */
function entry(name: string, size: number): Uint8Array {
	const h = new Uint8Array(32)
	const n = new TextEncoder().encode(name)
	h.set(n.subarray(0, 20), 0)
	const s = new TextEncoder().encode(size.toString(8).padStart(11, '0'))
	h.set(s.subarray(0, 11), 20)
	return h
}

/** Concatenates headers plus `data` bytes per file, mirroring the tightly-packed archive layout. */
function makeArchive(files: { name: string; data?: Uint8Array }[]): ArrayBuffer {
	const chunks: Uint8Array[] = []
	let total = 0
	for (const f of files) {
		const data = f.data ?? new Uint8Array(0)
		const h = entry(f.name, data.byteLength)
		chunks.push(h, data)
		total += h.byteLength + data.byteLength
	}
	const out = new Uint8Array(total)
	let o = 0
	for (const c of chunks) {
		out.set(c, o)
		o += c.byteLength
	}
	return out.buffer
}

/** Minimal `XMLHttpRequest` stand-in that answers `send()` immediately. */
class FakeXhr extends EventTarget {
	responseType = ''
	readyState = 1
	status = 200
	response: unknown = undefined
	body: ArrayBuffer | undefined = undefined
	static statusCode = 200

	open() {
		this.readyState = 1
	}
	getResponseHeader() {
		return null
	}
	send() {
		this.readyState = 4
		this.status = FakeXhr.statusCode
		this.response = FakeXhr.statusCode === 200 ? this.body : undefined
		this.dispatchEvent(new Event('load'))
	}
}

/** Auto-responds to every XHR with the given body/status on `send()`. */
function stubXhr(body: ArrayBuffer | undefined, status = 200) {
	FakeXhr.statusCode = status
	const Fake = FakeXhr as unknown as { new (): FakeXhr }
	vi.stubGlobal(
		'XMLHttpRequest',
		class extends Fake {
			constructor() {
				super()
				this.body = body
			}
		},
	)
}

/** Unique archive id per test: the loaded body cache is private and cannot be reset. */
let n = 0
const archiveId = () => `rqFkjZz${n++}/base`

afterEach(() => {
	archive.db.clear()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('Archive.load', () => {
	it('indexes every entry by full path with offset and length', async () => {
		stubXhr(
			makeArchive([
				{ name: 'a/0_0.webp', data: new Uint8Array(4) },
				{ name: 'b/1_1.webp', data: new Uint8Array(8) },
			]),
		)
		const id = archiveId()
		const base = id.replace('/base', '')
		await archive.load('https://r2.micr.io/', id)
		expect([...archive.db.keys()]).toEqual([
			`https://r2.micr.io/${base}/a/0_0.webp`,
			`https://r2.micr.io/${base}/b/1_1.webp`,
		])
		// header (32) + 0 payload bytes before the first file
		expect(archive.db.get(`https://r2.micr.io/${base}/a/0_0.webp`)).toEqual([id, 32, 4])
		expect(archive.db.get(`https://r2.micr.io/${base}/b/1_1.webp`)).toEqual([id, 68, 8])
	})

	it('strips a leading ./ from entry names', async () => {
		const id = archiveId()
		const base = id.replace('/base', '')
		stubXhr(makeArchive([{ name: './mXApNjq/8/0_0.webp', data: new Uint8Array(2) }]))
		await archive.load('https://r2.micr.io/', id)
		expect(archive.db.has(`https://r2.micr.io/${base}/mXApNjq/8/0_0.webp`)).toBe(true)
	})

	it('stops at the all-zero terminator block', async () => {
		const id = archiveId()
		const body = makeArchive([{ name: 'a/0_0.webp', data: new Uint8Array(1) }])
		const withTrailer = new Uint8Array(body.byteLength + 64)
		withTrailer.set(new Uint8Array(body), 0)
		stubXhr(withTrailer.buffer)
		await archive.load('https://r2.micr.io/', id)
		expect(archive.db.size).toBe(1)
	})

	it('ignores a truncated trailing header', async () => {
		const id = archiveId()
		const body = makeArchive([{ name: 'a/0_0.webp', data: new Uint8Array(1) }])
		const padded = new Uint8Array(body.byteLength + 10)
		padded.set(new Uint8Array(body), 0)
		stubXhr(padded.buffer)
		await archive.load('https://r2.micr.io/', id)
		expect(archive.db.size).toBe(1)
	})

	it('ignores entries with a zero size', async () => {
		const id = archiveId()
		const base = id.replace('/base', '')
		stubXhr(makeArchive([{ name: 'zero/0_0.webp' }, { name: 'ok/0_0.webp', data: new Uint8Array(3) }]))
		await archive.load('https://r2.micr.io/', id)
		expect([...archive.db.keys()]).toEqual([`https://r2.micr.io/${base}/ok/0_0.webp`])
	})

	it('does not fetch a second time for the same archive id', async () => {
		const id = archiveId()
		stubXhr(makeArchive([{ name: 'a/0_0.webp', data: new Uint8Array(1) }]))
		await archive.load('https://r2.micr.io/', id)
		// A second load for the same id must short-circuit before touching XHR:
		// stub the constructor with a class that records construction instead.
		const XhrSpy = vi.fn()
		vi.stubGlobal('XMLHttpRequest', XhrSpy)
		await archive.load('https://r2.micr.io/', id)
		expect(XhrSpy).not.toHaveBeenCalled()
	})

	it('surfaces a failed request as a rejection and indexes nothing', async () => {
		const id = archiveId()
		stubXhr(makeArchive([{ name: 'a/0_0.webp', data: new Uint8Array(1) }]), 404)
		await expect(archive.load('https://r2.micr.io/', id)).rejects.toBeUndefined()
		expect(archive.db.size).toBe(0)
	})
})

describe('Archive lookups', () => {
	it('rejects for an unknown image id', async () => {
		await expect(archive._getImageById('nope')).rejects.toThrow('No image found in archive for ID: nope')
	})

	it('rejects for an unknown file path', async () => {
		await expect(archive.get('https://r2.micr.io/nope.json')).rejects.toThrow('Could not get blob')
	})
})
