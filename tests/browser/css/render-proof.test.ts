import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { uiBundle } from '../../fixtures/ui'
import { waitFor } from '../../helpers/viewer'
import { expectFillsViewport, mountUi, style, toolbarMenu } from './helpers'
import { MOBILE, TABLET, useViewport } from './setup'
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
 */

/** `.vitest/render-proof/<name>.png`, relative to this test file. */
const PROOF_DIR = '../../../.vitest/render-proof'

/** Waits out a transition, then captures the iframe as it currently stands. */
async function capture(name: string): Promise<string> {
	// The mobile sheet (0.3s), the logo and panel fades (0.25s) all land well inside this.
	await new Promise((resolve) => {
		setTimeout(resolve, 400)
	})
	const path = await page.screenshot({ save: true, path: `${PROOF_DIR}/${name}.png` })
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
