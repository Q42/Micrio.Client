/**
 * Browser test setup: registers the `<micr-io>` custom element once per test file,
 * and resets the page between tests.
 *
 * The element is registered through the production entry point so the exact same
 * wiring as a real page (`customElements.define` + `VERSION`) is exercised.
 */
import { afterEach, beforeEach } from 'vitest'

import '../../src/main'
import { restoreNetwork } from '../helpers/network'

beforeEach(() => {
	document.body.replaceChildren()
	document.head.querySelectorAll('link[data-test-style]').forEach((el) => el.remove())
	localStorage.clear()
})

afterEach(() => {
	document.body.replaceChildren()
	restoreNetwork()
	localStorage.clear()
})
