import { describe, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { afterFrame } from '$utils/dom'
import { openBook } from '../../fixtures/book'
import { uiBundle } from '../../fixtures/ui'
import { waitFor } from '../../helpers/viewer'
import { expectFillsViewport, mountUi, style, toolbarMenu } from './helpers'
import { DESKTOP, MOBILE, TABLET, WIDE, useViewport } from './setup'
import type { Viewer } from '../../helpers/viewer'

/**
 * Visual proof, not a regression baseline.
 *
 * Every other file in this suite asserts on numbers — computed styles, boxes, hit tests.
 * Those are the tests that should fail when a rule breaks, but they are a poor answer to
 * "how do I know the stylesheets were even in the page?". This file renders the client at
 * each viewport the suite covers, waits for its transitions to land, and writes a real PNG
 * of the result, so a run leaves something a human can open.
 *
 * The images overwrite in place at `.vitest/render-proof/`, one per viewport, and survive
 * between runs: a `test:css` run clears the directory first (the config only does that for
 * this project, so the normal suite cannot delete them), and every other command leaves them
 * alone. They are deliberately **not** baselines — nothing compares them, so they cannot fail
 * a build on a font-rendering or WebGL difference. See TESTING.md for why pixel regression is
 * left out and what these are for.
 *
 * Each capture waits for the fade/slide it shows. A screenshot taken mid-transition is
 * exactly the sort of artefact that makes a proof file useless.
 *
 * The book adds one capture per viewport on top of that, and it is the only one that is
 * *deliberately* mid-motion: a page held in the air mid-turn, because a book at rest is just
 * two rectangles. It is a real album open in a real viewer, so the Micrio chrome is in the
 * shot with it — see `captureBooks` for the two things that makes necessary.
 */

/** What a spread's shadow scores before the turn is worth capturing. */
const FOLD_TRIGGER = 18_000

/** How long to keep sampling a turn for (ms). */
const TURN_DEADLINE = 2500

/** `.vitest/render-proof`, from the project root (`commands.writeFile` resolves there). */
const PROOF_DIR = '.vitest/render-proof'

/**
 * A drawn page, because the book harness's default thumbnail is a flat 8×6 beige
 * rectangle: a page turn is only legible if the page has an edge to bend. 8×6 matches the
 * rest of the book suite (the texture is stretched, not tiled), with a border ring so the
 * curl reads, a dark header and a few text lines.
 */
async function pageBytes(): Promise<Uint8Array> {
	const canvas = new OffscreenCanvas(8, 6)
	const ctx = canvas.getContext('2d')
	if (!ctx) {
		throw new Error('no 2d context for the page texture')
	}
	ctx.fillStyle = '#fbf7ee'
	ctx.fillRect(0, 0, 8, 6)
	ctx.fillStyle = '#d8cbb2'
	// The page edges: the border is what makes a mid-turn page read as a turning page.
	ctx.fillRect(0, 0, 1, 6)
	ctx.fillRect(7, 0, 1, 6)
	ctx.fillRect(0, 0, 8, 1)
	ctx.fillRect(0, 5, 8, 1)
	ctx.fillStyle = '#3b3630'
	ctx.fillRect(1, 1, 4, 1)
	ctx.fillStyle = '#a99e8b'
	ctx.fillRect(1, 3, 6, 1)
	ctx.fillRect(1, 4, 5, 1)
	const blob = await canvas.convertToBlob({ type: 'image/webp' })
	return new Uint8Array(await blob.arrayBuffer())
}

/** Waits out a transition, then captures the iframe as it currently stands. */
async function capture(name: string): Promise<string> {
	// The mobile sheet (0.3s), the logo and panel fades (0.25s) all land well inside this.
	await new Promise((resolve) => {
		setTimeout(resolve, 400)
	})
	const path = await page.screenshot({ save: true, path: `../../../${PROOF_DIR}/${name}.png` })
	expect(path).toContain(`${name}.png`)
	return path
}

/** Mounts a UI viewer that fills the iframe, with the toolbar rendered. */
async function openApp(): Promise<Viewer> {
	const viewer = await mountUi(uiBundle({ revision: { en: 1, nl: 1 } }))
	await waitFor(() => viewer.el.querySelector('micrio-toolbar > menu') !== null, 4000, 'the toolbar menu')
	expectFillsViewport(viewer.el)
	return viewer
}

describe('render proof', () => {
	it('captures the desktop bar, the mobile sheet, the tablet layout and a wide window', async () => {
		const desktop = await openApp()
		expect(style(toolbarMenu(desktop) as HTMLElement, 'position')).toBe('absolute')
		await capture('desktop')
		desktop.destroy()

		await useViewport(MOBILE)
		const mobile = await openApp()
		// The sheet is what a phone actually shows, so sit it in its open state. The click goes
		// through the toolbar's own toggle (`micrio-toolbar > micrio-button`), not the first
		// button in the tree — the logo link is one.
		mobile.el.querySelector<HTMLButtonElement>('micrio-toolbar > micrio-button button')?.click()
		await waitFor(() => toolbarMenu(mobile)?.classList.contains('shown') === true, 4000, 'the sheet to open')
		await capture('mobile-sheet')
		mobile.destroy()

		await useViewport(TABLET)
		const tablet = await openApp()
		await capture('tablet')
		tablet.destroy()

		// A window much wider than tall, where the popover's `min-aspect-ratio` branch applies.
		await useViewport({ width: 1280, height: 600 })
		const wide = await openApp()
		await capture('wide-landscape')
		wide.destroy()
	})
})

/** Writes a captured screenshot, given as base64 PNG, into the proof directory. */
async function writeProof(name: string, base64: string): Promise<void> {
	await commands.writeFile(`${PROOF_DIR}/${name}.png`, base64, 'base64')
}
/**
 * How much of the spread's region is in shadow.
 *
 * A flat page is one flat colour and scores almost nothing; a lifted page is lit from an
 * angle, and its fold and the gap under it are the darkest thing on screen. That makes "has
 * the fold developed yet" a property of the frame rather than a stopwatch guess.
 */
async function curlScore(base64: string): Promise<number> {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
	const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const ctx = canvas.getContext('2d')
	if (!ctx) {
		return 0
	}
	ctx.drawImage(bitmap, 0, 0)
	// The middle band, where the spread sits: the logo and the control bar are outside it.
	const { data } = ctx.getImageData(
		Math.round(bitmap.width * 0.1),
		Math.round(bitmap.height * 0.3),
		Math.round(bitmap.width * 0.8),
		Math.round(bitmap.height * 0.6),
	)
	let dark = 0
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] > 10 && (data[i] + data[i + 1] + data[i + 2]) / 3 < 200) {
			dark++
		}
	}
	return dark
}

/** One screenshot every turn, until the fold has developed (or the deadline passes). */
async function sampleUntilFolded(deadline: number, best = '', bestScore = 0): Promise<string> {
	if (bestScore >= FOLD_TRIGGER || performance.now() > deadline) {
		return best
	}
	const shot = (await page.screenshot({ save: false })) as string
	const score = await curlScore(shot)
	return sampleUntilFolded(deadline, score > bestScore ? shot : best, Math.max(bestScore, score))
}

/**
 * Turns the book one page and returns the screenshot of it mid-turn.
 *
 * The gap between `album.next()` and the page actually moving is not fixed — the gallery puts
 * a `BookViewer` on the element and that viewer's own frame loop starts the cascade — and the
 * page is only in the air for a fraction of the animation, so a fixed delay is not enough.
 * Sampling until the fold is big enough lands the capture in that fraction at every viewport.
 */
async function captureTurn(book: Awaited<ReturnType<typeof openBook>>): Promise<string> {
	book.viewer.el.$current?.album?.next()
	const shot = await sampleUntilFolded(performance.now() + TURN_DEADLINE)
	const score = await curlScore(shot)
	expect(score).toBeGreaterThan(FOLD_TRIGGER)
	return shot
}

/** The viewports the book is captured at, one PNG each. */
const BOOK_VIEWPORTS = [
	['desktop', DESKTOP],
	['mobile', MOBILE],
	['tablet', TABLET],
	['wide', WIDE],
] as const

/** Captures one book turn per viewport. */
async function captureBooks(pages: Uint8Array, index = 0): Promise<void> {
	const entry = BOOK_VIEWPORTS[index]
	if (entry === undefined) {
		return
	}
	const [name, size] = entry
	await useViewport(size)
	// Sized at mount: the book renderer takes its drawing buffer from the canvas box when it
	// is constructed, so styling the host afterwards would leave it at the fixture's 800×600.
	const book = await openBook({ count: 4, pageBytes: pages, style: 'width: 100vw; height: 100vh; display: block;' })
	await afterFrame()
	await writeProof(`book-page-turn-${name}`, await captureTurn(book))
	book.viewer.destroy()
	return captureBooks(pages, index + 1)
}

describe('render proof: the 3D book', () => {
	it('captures a turning page for every viewport, with the chrome around it', async () => {
		await captureBooks(await pageBytes())
	})
})
