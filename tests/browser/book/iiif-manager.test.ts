import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IIIFTextureManager } from '$book/rendering/iiif-manager'
import type { PaperRenderer } from '$book/rendering/renderer'
import type { Models } from '$types/models'
import { mockJson, requested, restoreNetwork } from '../../helpers/network'

/**
 * A stand-in for the parts of `PaperRenderer` the IIIF manager talks to: its
 * canvas (for sizing decisions), its hi-res texture slots and its blend arrays.
 * A real renderer would work too, but it would drag WebGL into every assertion.
 */
function fakeRenderer(canvasWidth = 1024, canvasHeight = 1024) {
	const blends: { page: number; front: [number, number]; back: [number, number] }[] = []
	const textures: { page: number; side: 0 | 1; slot: 0 | 1 }[] = []
	const evictions: { page: number; side: 0 | 1; slot: 0 | 1 }[] = []
	const canvas = { width: canvasWidth, height: canvasHeight } as HTMLCanvasElement
	const renderer = {
		_getCanvas: () => canvas,
		_setPageHiResTexture: (page: number, side: 0 | 1, slot: 0 | 1) => {
			textures.push({ page, side, slot })
		},
		_evictPageHiRes: (page: number, side: 0 | 1, slot: 0 | 1) => {
			evictions.push({ page, side, slot })
		},
		_setPageBlend: (page: number, frontA: number, frontB: number, backA: number, backB: number) => {
			blends.push({ page, front: [frontA, frontB], back: [backA, backB] })
		},
	} as unknown as PaperRenderer
	return { renderer, canvas, blends, textures, evictions }
}

/** The last element matching a predicate, without an intermediate array. */
function lastMatching<T>(list: T[], predicate: (item: T) => boolean): T | undefined {
	for (let i = list.length - 1; i >= 0; i--) {
		const item = list[i]
		if (item !== undefined && predicate(item)) {
			return item
		}
	}
	return undefined
}

/** One image info with a known id and original width. */
const image = (id: string, width = 2048): Models.ImageInfo.ImageInfo =>
	({ id, width, height: width }) as Models.ImageInfo.ImageInfo

/**
 * A book of `pages` pages (2 images each), every image `width` wide. The layout
 * mirrors `computePageLayout`: page p holds images 2p and 2p+1.
 */
function book(pages: number, width = 2048): { images: Models.ImageInfo.ImageInfo[]; pageIdxes: number[][] } {
	const images = Array.from({ length: pages * 2 }, (_, i) => image(`IIIF${i}`, width))
	const pageIdxes = Array.from({ length: pages }, (_, p) => [p * 2, p * 2 + 1])
	return { images, pageIdxes }
}

describe('IIIFTextureManager', () => {
	let fake: ReturnType<typeof fakeRenderer>
	let manager: IIIFTextureManager
	let frames: number

	beforeEach(() => {
		fake = fakeRenderer()
		manager = new IIIFTextureManager(fake.renderer, 'https://iiif.test')
		manager._onRequestFrame = () => {
			frames++
		}
		frames = 0
		// Every IIIF image request answers with a tiny blob
		mockJson(/iiif\.test/, {})
		vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: () => {} }))
	})

	afterEach(() => {
		restoreNetwork()
		vi.unstubAllGlobals()
	})

	/** Boots the manager for a book and returns its per-side state through a frame. */
	const init = (pages = 2, width = 2048) => {
		const { images, pageIdxes } = book(pages, width)
		manager._init(images, pages, pageIdxes)
		return { images, pageIdxes }
	}

	it('marks the visible sides pending without requesting a frame or a download', () => {
		init(2)
		// Pending is work, but network work must not keep the render loop alive
		expect(manager._onFrame(0, 0, 2.2)).toBe(true)
		expect(frames).toBe(0)
		expect(requested).toHaveLength(0)
	})

	it('marks only the sides inside the preload range as pending', () => {
		init(3)
		manager._onFrame(0, 0, 2.2)
		// Spread center 0 preloads offsets -1..1, so pages 0 and 1
		expect(requested).toHaveLength(0)
		manager._onFrame(500, 0, 2.2)
		// Page 0 is the spread itself (distance 0), page 1 is one away
		expect(requested.some((u) => u.includes('IIIF0/'))).toBe(true)
	})

	it('builds the IIIF url with the debounced level and the image id', async () => {
		const { images } = init(2)
		manager._onFrame(0, 0, 2.2)
		manager._onFrame(500, 0, 2.2)
		await vi.waitFor(() => {
			expect(requested[0]).toBe(`https://iiif.test/${images[0]?.id}/full/!512,/0/default.webp`)
		})
	})

	it('waits out the spread debounce before requesting the page', () => {
		init(2)
		manager._onFrame(0, 0, 2.2)
		manager._onFrame(499, 0, 2.2)
		expect(requested).toHaveLength(0)
		manager._onFrame(500, 0, 2.2)
		expect(requested.length).toBeGreaterThan(0)
	})

	it('debounces a neighbour for longer than the spread itself', () => {
		init(3)
		// Page 1 is one page away: 500 + 2000·1 ms
		manager._onFrame(0, 0, 2.2)
		manager._onFrame(1000, 0, 2.2)
		expect(requested.some((u) => u.includes('IIIF2/'))).toBe(false)
		manager._onFrame(2600, 0, 2.2)
		expect(requested.some((u) => u.includes('IIIF2/'))).toBe(true)
	})

	it('picks a higher level when the page is large on screen', async () => {
		const big = fakeRenderer(4096, 2048)
		const zoomed = new IIIFTextureManager(big.renderer, 'https://iiif.test')
		const { images, pageIdxes } = book(2)
		zoomed._init(images, 2, pageIdxes)
		zoomed._onFrame(0, 0, 2.2)
		// A camera radius of 1.1 doubles the zoom factor: 4096/2 · 2 = 4096 px
		zoomed._onFrame(500, 0, 1.1)
		await vi.waitFor(() => {
			expect(requested[0]).toContain('!2048,')
		})
	})

	it('never asks for a level wider than the source image', async () => {
		// `#chooseWidth` used to compare a desired width against `originalWidth`
		// while gating on the *current level*, so a first load (level 0) of a tiny
		// source still requested the 2048 tile
		const small = fakeRenderer(4096, 2048)
		const zoomed = new IIIFTextureManager(small.renderer, 'https://iiif.test')
		const { images, pageIdxes } = book(2, 300)
		zoomed._init(images, 2, pageIdxes)
		zoomed._onFrame(0, 0, 2.2)
		zoomed._onFrame(500, 0, 0.05)
		await vi.waitFor(() => {
			expect(requested[0]).toContain('!300,')
		})
	})

	it('resets a pending side when it leaves the preload range', () => {
		init(4)
		manager._onFrame(0, 0, 2.2)
		expect(manager._hasPendingWork()).toBe(true)
		// Jump to the far end: everything near page 0 leaves the range
		manager._onFrame(1000, 3, 2.2)
		manager._onFrame(2000, 3, 2.2)
		expect(requested.every((u) => !u.includes('IIIF0/'))).toBe(true)
	})

	it('fades the downloaded texture in and stops working when the fade is done', async () => {
		const one = fakeRenderer(400, 400)
		const single = new IIIFTextureManager(one.renderer, 'https://iiif.test')
		let frameRequests = 0
		single._onRequestFrame = () => {
			frameRequests++
		}
		// A one-page book: exactly one page side downloads per texture
		const { images } = book(2)
		single._init(images, 1, [[0, 1]])

		// `#fadeStartTime` comes from `performance.now()`, so the frames that assert
		// on a fade have to advance that same clock, not a synthetic one
		const start = performance.now()
		single._onFrame(start, 0, 2.2)
		single._onFrame(start + 500, 0, 2.2)
		// Both sides of the page land in slot A, and each finished download asks
		// for a frame so the fade can be drawn
		await vi.waitFor(() => {
			expect(one.textures).toHaveLength(2)
		})
		expect(one.textures[0]).toEqual({ page: 0, side: 0, slot: 0 })
		expect(frameRequests).toBe(2)

		// Mid-fade the active slot blends up from 0
		expect(single._onFrame(performance.now() + 250, 0, 2.2)).toBe(true)
		const mid = one.blends.at(-1)
		expect(mid?.front[0]).toBeGreaterThan(0)
		expect(mid?.front[0]).toBeLessThan(1)

		// Once the fade has completed there is no work left at all
		expect(single._onFrame(performance.now() + 1000, 0, 2.2)).toBe(false)
		expect(one.blends.at(-1)?.front[0]).toBe(1)
		expect(single._hasPendingWork()).toBe(false)
	})

	it('cross-fades an upgraded level through the other slot and evicts the old one', async () => {
		const big = fakeRenderer(400, 400)
		const zoomed = new IIIFTextureManager(big.renderer, 'https://iiif.test')
		const { images, pageIdxes } = book(2)
		zoomed._init(images, 2, pageIdxes)

		// First load at 512 with a zoomed-out camera: the page's front and back
		// both fill slot A
		const start = performance.now()
		zoomed._onFrame(start, 0, 2.2)
		zoomed._onFrame(start + 500, 0, 2.2)
		await vi.waitFor(() => {
			expect(big.textures.filter((t) => t.side === 0)).toHaveLength(1)
		})
		zoomed._onFrame(performance.now() + 600, 0, 2.2)
		const fronts = big.textures.filter((t) => t.side === 0)
		expect(fronts).toHaveLength(1)
		expect(fronts[0]?.slot).toBe(0)

		// Zooming in makes the page larger than 512, so a higher level is wanted
		zoomed._onFrame(performance.now() + 1400, 0, 0.3)
		zoomed._onFrame(performance.now() + 2000, 0, 0.3)
		await vi.waitFor(() => {
			expect(big.textures.filter((t) => t.side === 0).length).toBeGreaterThan(1)
		})
		// The upgrade went into slot B while slot A is still the active one
		expect(lastMatching(big.textures, (t) => t.side === 0)?.slot).toBe(1)

		// Finishing the cross-fade evicts the slot it replaced. Several upgrades can
		// be in flight for the same page, so the final blend of *every* texture is
		// pinned here, not just the last one.
		zoomed._onFrame(performance.now() + 600, 0, 0.3)
		expect(big.evictions.some((e) => e.side === 0)).toBe(true)
		expect(big.blends.at(-1)?.front).toEqual([0, 0])
	})

	it('evicts the GPU textures of pages far away from the spread', async () => {
		const many = fakeRenderer(4096, 2048)
		const zoomed = new IIIFTextureManager(many.renderer, 'https://iiif.test')
		const { images, pageIdxes } = book(10)
		zoomed._init(images, 10, pageIdxes)

		// Load only the far page's texture, while it is the spread
		zoomed._onFrame(0, 7, 2.2)
		zoomed._onFrame(500, 7, 2.2)
		await vi.waitFor(() => {
			expect(many.textures.some((t) => t.page === 7)).toBe(true)
		})

		// Moving to page 0 puts page 7 (distance 7) beyond the eviction distance
		zoomed._onFrame(1000, 0, 2.2)
		expect(many.evictions.some((e) => e.page === 7)).toBe(true)
	})

	it('drops a texture that resolves after its page stopped downloading', async () => {
		init(2)
		manager._onFrame(0, 0, 2.2)
		manager._onFrame(500, 0, 2.2)
		// Leave the range before the fetch settles, so the state goes back to idle
		manager._onFrame(510, 1, 2.2)
		await vi.waitFor(() => {
			expect(requested.length).toBeGreaterThan(0)
		})
		manager._onFrame(1000, 1, 2.2)
		// The late texture is not applied
		expect(fake.textures.some((t) => t.page === 0)).toBe(false)
	})

	it('retries after a failed request instead of staying stuck', async () => {
		mockJson(/iiif\.test/, { error: 'nope' }, 500)
		init(2)
		manager._onFrame(0, 0, 2.2)
		manager._onFrame(500, 0, 2.2)
		await vi.waitFor(() => {
			expect(requested.length).toBeGreaterThan(0)
		})
		// The failure reset it to idle, so the next in-range frame re-arms it
		manager._onFrame(1000, 0, 2.2)
		expect(manager._hasPendingWork()).toBe(true)
	})
})
