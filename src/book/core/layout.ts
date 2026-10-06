import type { Models } from '$types/models'
import { DEFAULT_ASPECT } from './settings'

/**
 * The page layout of a book: how the images are paired onto physical pages and
 * the aspect ratios each page (and each face) is initialised with.
 */
export interface PageLayout {
	/** Number of physical pages: `ceil(images.length / 2)`. */
	pageCnt: number
	/** The image indices displayed on each page: `[0]`, then `[1, 2]`, `[3, 4]`, … */
	pageIdxes: number[][]
	/** The number of images in the book. */
	totalImagePages: number
	/** The geometry width of every page (a single shared value, see below). */
	computedPageWidths: Float32Array
	/** The page aspect (height / width) every page's geometry is built with. */
	aspectsForInit: Float32Array
	/** Per-page front face aspect (height / width) of the front image. */
	frontAspects: Float32Array
	/** Per-page back face aspect, falling back to the front's when there is no back image. */
	backAspects: Float32Array
	/** The book-wide average aspect every page is built with. */
	avgAspect: number
}

/**
 * Pairs the book's images onto pages and computes the aspect ratios each page is
 * initialised with.
 *
 * Page 0 holds image 0 alone; every following page holds the pair `2p-1, 2p`, so
 * the covers are the outer pages of the book. Images with no usable dimensions
 * (`width`/`height` <= 0, or missing) contribute the default aspect instead of
 * skewing the average.
 *
 * Note that every page shares one geometry (the book-wide average aspect) and
 * `computedPageWidths` is therefore the same constant for every page; per-image
 * aspects are honoured by rendering each texture in its own region of the page
 * (see `computeTexRegion`) rather than by resizing the page.
 */
export function computePageLayout(images: Models.ImageInfo.ImageInfo[]): PageLayout {
	const pageCnt = Math.ceil(images.length / 2)
	const totalImagePages = images.length

	const pageIdxes: number[][] = [[0]]
	for (let p = 1; p < pageCnt; p++) {
		const first = 2 * p - 1
		const last = 2 * p
		if (last < images.length) {
			pageIdxes.push([first, last])
		} else {
			pageIdxes.push([first])
		}
	}

	let totalAspect = 0
	let aspectCount = 0
	const frontAspects = new Float32Array(pageCnt)
	const backAspects = new Float32Array(pageCnt)

	for (let p = 0; p < pageCnt; p++) {
		const front = images[p * 2]
		const back = images[p * 2 + 1]
		const frontAsp =
			front !== undefined && front.width > 0 && front.height > 0 ? front.height / front.width : DEFAULT_ASPECT
		const backAsp = back !== undefined && back.width > 0 && back.height > 0 ? back.height / back.width : frontAsp
		frontAspects[p] = frontAsp
		backAspects[p] = backAsp

		if (front !== undefined && front.width > 0 && front.height > 0) {
			totalAspect += frontAsp
			aspectCount++
		}
		if (back !== undefined && back.width > 0 && back.height > 0) {
			totalAspect += backAsp
			aspectCount++
		}
	}

	const avgAspect = aspectCount > 0 ? totalAspect / aspectCount : DEFAULT_ASPECT
	const refArea = avgAspect

	// Every page shares the same geometry (the book-wide average aspect); per-page
	// aspects are honored by rendering each texture in its own region of the page
	// instead of resizing the geometry.
	const computedPageWidths = new Float32Array(pageCnt).fill(Math.sqrt(refArea / avgAspect))
	const aspectsForInit = new Float32Array(pageCnt).fill(avgAspect)

	return {
		pageCnt,
		pageIdxes,
		totalImagePages,
		computedPageWidths,
		aspectsForInit,
		frontAspects,
		backAspects,
		avgAspect,
	}
}

/**
 * The sub-rectangle of a page's UV space in which a texture with `texAspect`
 * (height / width) is drawn without distortion on a page of aspect `pageAspect`.
 * Returns `[uMin, vMin, fU, fV]`; the leftover page space is transparent.
 *
 * The image is always anchored to the book's spine. When `spineAtHigh` is true
 * the spine lies at sampled u = 1 (a single-grid page's back face, sampled
 * mirrored), so the image's far edge sits on the spine (`uMin = 1 - fU`).
 * Otherwise the spine lies at sampled u = 0 and the image's near edge sits on it
 * (`uMin = 0`). Vertically the image stays centered.
 */
export function computeTexRegion(
	texAspect: number,
	pageAspect: number,
	spineAtHigh: boolean,
): [number, number, number, number] {
	const fU = Math.min(1, pageAspect / Math.max(1e-4, texAspect))
	const fV = Math.min(1, texAspect / Math.max(1e-4, pageAspect))
	const uMin = spineAtHigh ? 1 - fU : 0
	const vMin = (1 - fV) / 2
	return [uMin, vMin, fU, fV]
}
