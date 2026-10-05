import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '../../src/types/models'
import { jsonCache } from '../../src/utils/fetch'

type Bundle = Models.ImageBundle.BundleResponse
type DataLoaderModule = typeof import('../../src/utils/dataLoader')

const bundle = (overrides: Partial<Bundle> = {}): Bundle => ({
	images: [
		{
			id: 'rqFkjZz',
			info: { id: 'rqFkjZz', width: 2048, height: 2048, path: 'https://r2.micr.io/', version: '6.1.11', isWebP: true },
			data: {
				markers: [{ id: 'm1', x: 0.5, y: 0.5 }],
			},
			settings: { noLogo: true },
		},
	],
	...overrides,
})

/** Fresh module instance per test: every cache in `dataLoader` is module-level. */
async function freshLoader(): Promise<DataLoaderModule> {
	vi.resetModules()
	jsonCache.clear()
	return await import('../../src/utils/dataLoader')
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	jsonCache.clear()
})

function respond(body: unknown, status = 200) {
	fetchMock.mockResolvedValue({
		status,
		json: () => Promise.resolve(body),
	} as Response)
}

describe('DataLoader bundles', () => {
	it('fetches the versioned bundle URL once and serves every field', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()

		const entry = await DataLoader._getBundleImage('rqFkjZz')
		expect(entry?.id).toBe('rqFkjZz')
		expect(entry?.settings).toEqual({ noLogo: true })
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
			/^https:\/\/viewer\.micr\.io\/rqFkjZz\/bundle\.json\?v=\d+\.\d+\.\d+$/,
		)
	})

	it('serves repeated lookups from the cache', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('rqFkjZz')
		await DataLoader._getBundleImage('rqFkjZz')
		await DataLoader._getData('rqFkjZz')
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('de-duplicates concurrent requests for the same id', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		const [a, b] = await Promise.all([DataLoader._getBundleImage('rqFkjZz'), DataLoader._getBundleImage('rqFkjZz')])
		expect(a).toBe(b)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('returns undefined (and does not cache) for a failed bundle, then retries', async () => {
		respond({}, 404)
		const { DataLoader } = await freshLoader()
		expect(await DataLoader._getBundleImage('rqFkjZz')).toBeUndefined()

		respond(bundle())
		const entry = await DataLoader._getBundleImage('rqFkjZz')
		expect(entry?.id).toBe('rqFkjZz')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('short-circuits empty and absolute-URL ids without fetching', async () => {
		const { DataLoader } = await freshLoader()
		expect(await DataLoader._getBundleImage('')).toBeUndefined()
		expect(await DataLoader._getBundleImage('https://example.com/info.json')).toBeUndefined()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('caches all images from a multi-image bundle', async () => {
		respond(
			bundle({
				images: [
					{ id: 'aaa1111', info: { id: 'aaa1111', width: 10, height: 10, path: 'https://r2.micr.io/', version: '6.1.0' } },
					{ id: 'bbb2222', info: { id: 'bbb2222', width: 20, height: 20, path: 'https://r2.micr.io/', version: '6.1.0' } },
				],
			}),
		)
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('aaa1111')
		expect(DataLoader._getBundleImageSync('bbb2222')?.info.width).toBe(20)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('sync lookup is empty until the async path has run', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		expect(DataLoader._getBundleImageSync('rqFkjZz')).toBeUndefined()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getBundleImageSync('rqFkjZz')?.id).toBe('rqFkjZz')
	})
})

describe('DataLoader external aliases', () => {
	it('also caches the primary image under the external/ alias key', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		const alias = 'external/aaa1111'
		const entry = await DataLoader._getBundleImage(alias)
		expect(entry?.id).toBe('rqFkjZz')
		// Both the real id and the alias resolve
		expect(DataLoader._getBundleImageSync('external/aaa1111')?.id).toBe('rqFkjZz')
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('external/aaa1111/bundle.json')
	})

	it('does not create an alias entry for a normal id', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getBundleImageSync('external/rqFkjZz')).toBeUndefined()
	})
})

describe('DataLoader organisation, spaces, album and tours', () => {
	it('exposes the organisation from the bundle', async () => {
		respond(
			bundle({
				organisation: { name: 'Acme', slug: 'acme', href: 'https://acme.test', branding: true },
			}),
		)
		const { DataLoader } = await freshLoader()
		expect(DataLoader._getOrganisation()).toBeUndefined()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getOrganisation()?.slug).toBe('acme')
	})

	it('caches spaces by id and ignores malformed entries', async () => {
		respond(
			bundle({
				spaces: [
					{
						id: 'space-1',
						data: {
							name: 'Zone 1',
							links: [],
							images: [
								{ id: 'rqFkjZz', x: 0, y: 0, z: 0, rotationY: 0 },
								{ id: 'other11', x: 1, y: 0, z: 0, rotationY: 0 },
							],
						},
					},
					{ id: 'empty-space', data: undefined as never },
				],
			}),
		)
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getSpaceData('space-1')?.images).toHaveLength(2)
		expect(DataLoader._getSpaceData('empty-space')).toBeUndefined()
		expect(DataLoader._getSpaceData('nope')).toBeUndefined()
	})

	it('caches the album by id', async () => {
		respond(bundle({ album: { id: 'album-1', type: 'swipe', settings: {} } }))
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getAlbum('album-1')?.type).toBe('swipe')
		expect(DataLoader._getAlbum('other')).toBeUndefined()
	})

	it('attaches bundle-level tours to every image in the bundle', async () => {
		const tours = [{ id: 'tour-1', steps: ['m1', 'm2'] }] as Models.ImageData.MarkerTour[]
		respond(
			bundle({
				tours,
				images: [
					{ id: 'aaa1111', info: { id: 'aaa1111', width: 10, height: 10, path: 'https://r2.micr.io/', version: '6.1.0' } },
					{ id: 'bbb2222', info: { id: 'bbb2222', width: 20, height: 20, path: 'https://r2.micr.io/', version: '6.1.0' } },
				],
			}),
		)
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('aaa1111')
		// fetchJson clones its payload, so compare by value, and both images share
		// the same cached tour array instance.
		expect(DataLoader._getBundleTours('aaa1111')).toEqual(tours)
		expect(DataLoader._getBundleTours('aaa1111')).toBe(DataLoader._getBundleTours('bbb2222'))
		expect(DataLoader._getBundleTours('unknown1')).toBeUndefined()
	})

	it('has no tours when the bundle carries none', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getBundleTours('rqFkjZz')).toBeUndefined()
	})
})

describe('DataLoader._getStepMarker', () => {
	it('resolves a tour step marker from its own image data', async () => {
		respond(
			bundle({
				images: [
					{
						id: 'step111',
						info: { id: 'step111', width: 100, height: 100, path: 'https://r2.micr.io/', version: '6.1.0' },
						data: {
							markers: [
								{ id: 'other', x: 0, y: 0 },
								{ id: 'focus', x: 0.25, y: 0.75 },
							],
						},
					},
				],
			}),
		)
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('step111')
		const marker = DataLoader._getStepMarker({ markerId: 'focus', micrioId: 'step111', duration: 3 })
		expect(marker?.x).toBe(0.25)
	})

	it('returns undefined for an unknown image or marker', async () => {
		respond(bundle())
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('rqFkjZz')
		expect(DataLoader._getStepMarker({ markerId: 'nope', micrioId: 'rqFkjZz', duration: 1 })).toBeUndefined()
		expect(DataLoader._getStepMarker({ markerId: 'm1', micrioId: 'other11', duration: 1 })).toBeUndefined()
	})

	it('returns undefined for an image whose data has no markers', async () => {
		respond(bundle({ images: [{ id: 'nomark00', info: { id: 'nomark00', width: 1, height: 1, path: 'https://r2.micr.io/', version: '6.1.0' }, data: {} }] }))
		const { DataLoader } = await freshLoader()
		await DataLoader._getBundleImage('nomark00')
		expect(DataLoader._getStepMarker({ markerId: 'x', micrioId: 'nomark00', duration: 1 })).toBeUndefined()
	})
})
