import { describe, expect, it } from 'vitest'
import { computePageLayout, computeTexRegion } from '$book/core/layout'
import { DEFAULT_ASPECT } from '$book/core/settings'
import type { Models } from '$types/models'

/** A minimal image info with a usable size; only what the layout reads. */
const info = (width = 800, height = 600): Models.ImageInfo.ImageInfo =>
	({ id: `i${width}x${height}`, width, height }) as Models.ImageInfo.ImageInfo

const images = (n: number, size: (i: number) => [number, number] = () => [800, 600]) =>
	Array.from({ length: n }, (_, i) => info(...size(i)))

describe('computePageLayout — page pairing', () => {
	it('pairs from index 0: the first page is the front cover alone, then [1,2], [3,4], …', () => {
		// 5 images → [0], [1,2], [3,4]
		expect(computePageLayout(images(5)).pageIdxes).toEqual([[0], [1, 2], [3, 4]])
		// 4 images → [0], [1,2] — the fourth image is the back of page 1
		expect(computePageLayout(images(4)).pageIdxes).toEqual([[0], [1, 2]])
		// 3 images → [0], [1,2]
		expect(computePageLayout(images(3)).pageIdxes).toEqual([[0], [1, 2]])
	})

	it('handles the degenerate one- and two-image books', () => {
		expect(computePageLayout(images(1)).pageCnt).toBe(1)
		expect(computePageLayout(images(1)).pageIdxes).toEqual([[0]])
		expect(computePageLayout(images(2)).pageIdxes).toEqual([[0]])
		// An empty book still produces a layout; page 0 has no front image
		const empty = computePageLayout([])
		expect(empty.pageCnt).toBe(0)
		expect(empty.pageIdxes).toEqual([[0]])
		expect(empty.totalImagePages).toBe(0)
	})

	it('reports pageCnt as ceil(images / 2) and totalImagePages as the image count', () => {
		for (const n of [1, 2, 3, 4, 5, 9, 10]) {
			const layout = computePageLayout(images(n))
			expect(layout.pageCnt).toBe(Math.ceil(n / 2))
			expect(layout.totalImagePages).toBe(n)
			expect(layout.pageIdxes).toHaveLength(layout.pageCnt)
			expect(layout.frontAspects).toHaveLength(layout.pageCnt)
			expect(layout.backAspects).toHaveLength(layout.pageCnt)
		}
	})
})

describe('computePageLayout — aspects', () => {
	it('uses height / width for each face', () => {
		const sizes: [number, number][] = [
			[400, 200],
			[200, 400],
			[300, 300],
		]
		const layout = computePageLayout(images(3, (i) => sizes[i]))
		expect(layout.frontAspects[0]).toBeCloseTo(0.5, 12)
		expect(layout.backAspects[0]).toBeCloseTo(2, 12)
		expect(layout.frontAspects[1]).toBeCloseTo(1, 12)
	})

	it('falls back to the default aspect for a missing or unusable size', () => {
		expect(computePageLayout(images(1, () => [0, 600])).frontAspects[0]).toBeCloseTo(DEFAULT_ASPECT, 5)
		expect(computePageLayout(images(1, () => [800, 0])).frontAspects[0]).toBeCloseTo(DEFAULT_ASPECT, 5)
		expect(computePageLayout(images(1, () => [-800, -600])).frontAspects[0]).toBeCloseTo(DEFAULT_ASPECT, 5)
	})

	it('a page with no back image inherits the front aspect for its back face', () => {
		// 3 images → page 1 = [1, 2] has both; but page 0 and page 1 are separate:
		// image 2 is the back of page 1, so image 3 would be page 2's front
		const sizes: [number, number][] = [
			[100, 500],
			[100, 400],
			[100, 300],
		]
		const layout = computePageLayout(images(3, (i) => sizes[i]))
		expect(layout.backAspects[1]).toBeCloseTo(3, 12)
		// An odd book's last page has no back image
		const odd = computePageLayout(images(3, () => [100, 250]))
		expect(odd.backAspects[1]).toBeCloseTo(2.5, 12)
	})

	it('averages only the usable images, ignoring the fallbacks', () => {
		// 2 usable images at 0.5 and 1.5, one unusable that contributes only DEFAULT_ASPECT
		const layout = computePageLayout([info(400, 200), info(400, 600), info(0, 0)])
		// (0.5 + 1.5) / 2 — the unusable image is not in the average
		expect(layout.avgAspect).toBeCloseTo(1, 5)
		expect(layout.aspectsForInit[0]).toBeCloseTo(1, 5)
		expect(layout.aspectsForInit[1]).toBeCloseTo(1, 5)
	})

	it('falls back to the default aspect when nothing has a usable size', () => {
		const layout = computePageLayout(images(4, () => [0, 0]))
		expect(layout.avgAspect).toBeCloseTo(DEFAULT_ASPECT, 5)
	})

	it('every page gets the same geometry width, so per-page aspects never resize a page', () => {
		// This is deliberate (regions do the per-image fitting) but worth pinning:
		// `refArea === avgAspect`, so the width is always sqrt(1) === 1.
		const layout = computePageLayout(images(5, (i) => [400, 200 + i * 100]))
		for (const width of layout.computedPageWidths) {
			expect(width).toBe(1)
		}
		expect(new Set(layout.computedPageWidths).size).toBe(1)
	})
})

describe('computeTexRegion', () => {
	it('stretches the texture over the whole page when the aspects match', () => {
		expect(computeTexRegion(1.5, 1.5, false)).toEqual([0, 0, 1, 1])
		expect(computeTexRegion(1.5, 1.5, true)).toEqual([0, 0, 1, 1])
	})

	it('a wide image on a tall page is letterboxed vertically and anchored to the spine', () => {
		// texAspect 0.5 (wide), pageAspect 2 (tall): fU = 1, fV = 0.25, so the image
		// spans the full width and a quarter of the height, centred
		const [uMin, vMin, fU, fV] = computeTexRegion(0.5, 2, false)
		expect([uMin, fU]).toEqual([0, 1])
		expect(vMin).toBeCloseTo(0.375, 12)
		expect(fV).toBeCloseTo(0.25, 12)
	})

	it('a tall image on a wide page is letterboxed horizontally and hugs the spine', () => {
		// texAspect 2, pageAspect 0.5: fU = 0.25, fV = 1
		expect(computeTexRegion(2, 0.5, false)).toEqual([0, 0, 0.25, 1])
		// A spine on the mirrored high-u side moves the image to the far edge
		expect(computeTexRegion(2, 0.5, true)).toEqual([0.75, 0, 0.25, 1])
	})

	it('clamps both fill fractions to 1 and keeps the region inside [0,1]', () => {
		for (const [tex, page] of [
			[0.001, 100],
			[100, 0.001],
			[1e-9, 1e9],
			[1e9, 1e-9],
		]) {
			const [uMin, vMin, fU, fV] = computeTexRegion(tex, page, true)
			expect(fU).toBeGreaterThanOrEqual(0)
			expect(fU).toBeLessThanOrEqual(1)
			expect(fV).toBeGreaterThanOrEqual(0)
			expect(fV).toBeLessThanOrEqual(1)
			expect(uMin).toBeGreaterThanOrEqual(0)
			expect(uMin + fU).toBeLessThanOrEqual(1 + 1e-12)
			expect(vMin).toBeGreaterThanOrEqual(0)
			expect(vMin + fV).toBeLessThanOrEqual(1 + 1e-12)
		}
	})

	it('guards a zero texture aspect instead of producing Infinity', () => {
		const [uMin, vMin, fU, fV] = computeTexRegion(0, 1.5, false)
		expect(fU).toBe(1)
		expect(fV).toBe(0)
		expect(Number.isFinite(uMin)).toBe(true)
		expect(vMin).toBeCloseTo(0.5, 12)
		expect(Number.isNaN(vMin)).toBe(false)
	})
})
