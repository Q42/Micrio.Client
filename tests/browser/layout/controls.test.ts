import { describe, it } from 'vitest'
import { markerTour, openUi, uiBundle } from '../../fixtures/ui'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * `<micrio-controls>` builds itself from the current image's settings — the language
 * switcher, social sharing and fullscreen come from `readInfo`, which is only reachable
 * through the settings subscription the `current` store re-establishes per image.
 */

/** The controls' language menu, which only exists while the image offers a culture switch. */
const langMenu = (el: Element) => el.querySelector('micrio-controls menu')

describe('controls — image settings', () => {
	it("follows the new image's settings while a marker tour is running", async () => {
		const first = uiBundle({ revision: { en: 1, nl: 1 } })
		const { viewer } = await openUi(first)
		await waitFor(() => langMenu(viewer.el) !== null, 4000, 'the language menu')

		// A tour that keeps a step on this image; the marker id resolves to nothing, so the
		// only thing it changes is that a marker tour is running.
		viewer.el.state.tour.set(markerTour(['ghost']))
		await settle(2)

		// A marker tour used to skip the new image's settings subscription entirely, so the
		// controls kept the *previous* image's culture switch.
		const second = uiBundle({ revision: { en: 1, nl: 1 }, settings: { ui: { controls: { cultureSwitch: false } } } })
		await viewer.open(second.bundle)
		await waitFor(() => langMenu(viewer.el) === null, 4000, 'the language menu to go')
		viewer.destroy()
	})
})
