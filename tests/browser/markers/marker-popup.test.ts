import { afterEach, describe, expect, it, vi } from 'vitest'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, waitForPopup, type OpenMarkers } from '../../fixtures/markers'
import { markerTour } from '../../fixtures/tours'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * `<micrio-marker-popup>` is created by the layout from `micrio.state.popup`, so every
 * test opens a marker through the state instead of constructing the element. When the
 * popup state clears, the layout leaves the element in place and the popup animates out:
 * its own subscription sets `destroying` and a `transitionend` on itself removes it.
 */

/** The mounted popup element. */
const popupOf = (opened: OpenMarkers) => opened.viewer.el.querySelector<HTMLElement>('micrio-marker-popup')

/** The real `<button>` of a labelled control inside the popup. */
const control = (opened: OpenMarkers, selector: string): HTMLButtonElement | null =>
	popupOf(opened)?.querySelector<HTMLButtonElement>(`${selector} button`) ?? null

afterEach(() => {
	vi.useRealTimers()
})

describe('marker popup structure', () => {
	it('renders an aside with a close button and the marker content', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		const popup = popupOf(opened)
		expect(popup?.querySelector(':scope > aside > micrio-button.close')).not.toBeNull()
		expect(control(opened, 'micrio-button.close')?.getAttribute('title')).toBe('Close this marker')
		expect(popup?.querySelector('micrio-marker-content')).not.toBeNull()
		opened.viewer.destroy()
	})

	it('focuses its last control after a frame', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		await settle(2)

		const last = popupOf(opened)?.querySelector<HTMLElement>('micrio-button:last-child > button')
		expect(last).not.toBeNull()
		expect(document.activeElement).toBe(last)
		opened.viewer.destroy()
	})

	it('omits the close button for an always-open marker', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { data: { alwaysOpen: true } })] }))
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		expect(popupOf(opened)?.querySelector('micrio-button.close')).toBeNull()
		opened.viewer.destroy()
	})

	it('carries the marker tags on the popup', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { tags: ['focus'] })] }))
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		expect(popupOf(opened)?.classList.contains('focus')).toBe(true)
		opened.viewer.destroy()
	})
})

describe('marker popup closing', () => {
	it('closes the marker when the close button is clicked', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		control(opened, 'micrio-button.close')?.click()
		await waitFor(() => opened.image().state.$marker === undefined, 6000, 'the marker cleared')
		opened.viewer.destroy()
	})

	it('animates out and removes itself on a transitionend', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		const popup = popupOf(opened)
		if (!popup) {
			throw new Error('no popup')
		}

		opened.viewer.el.state.popup.set(undefined)
		await waitFor(() => popup.classList.contains('destroying'), 4000, 'the destroying class')
		expect(popup.isConnected).toBe(true)

		popup.dispatchEvent(new Event('transitionend'))
		await waitFor(() => !popup.isConnected, 4000, 'the popup removed')
		expect(opened.viewer.el.querySelector('micrio-marker-popup')).toBeNull()
		opened.viewer.destroy()
	})

	it('replaces the popup when another marker opens', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		const first = popupOf(opened)

		await opened.openMarker('m2')
		await waitFor(() => popupOf(opened) !== null && popupOf(opened) !== first, 6000, 'the replacement popup')
		expect(first?.isConnected).toBe(false)
		opened.viewer.destroy()
	})

	it('re-renders in place when its marker prop changes', async () => {
		const fixture = markerBundle()
		const opened = await openMarkers(fixture)
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		const popup = popupOf(opened)
		const content = popup?.querySelector('micrio-marker-content')

		const second = opened.image().$data?.markers?.[1]
		if (!popup || !second) {
			throw new Error('no popup or second marker')
		}
		;(popup as unknown as { _setProps?: (p: unknown) => void })._setProps?.({ marker: second })
		await settle(2)

		expect(popup.querySelector('micrio-marker-content')).not.toBe(content)
		opened.viewer.destroy()
	})
})

describe('marker popup minimize', () => {
	it('collapses the content when the setting allows minimizing', async () => {
		const opened = await openMarkers(markerBundle({ settings: { _markers: { canMinimizePopup: true } } }))
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		const popup = popupOf(opened)
		expect(popup?.querySelector('micrio-button.down')).not.toBeNull()
		expect(control(opened, 'micrio-button.down')?.getAttribute('title')).toBe('Minimize')

		vi.useFakeTimers()
		control(opened, 'micrio-button.down')?.click()
		vi.advanceTimersByTime(150)

		expect(popup?.classList.contains('minimized')).toBe(true)
		expect(popup?.querySelector<HTMLElement>('micrio-marker-content h1')?.style.height).toBe('0px')

		// Clicking again expands the popup
		control(opened, 'micrio-button.down')?.click()
		expect(popup?.classList.contains('minimized')).toBe(false)
		opened.viewer.destroy()
	})

	it('offers no minimize button without the setting', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		expect(popupOf(opened)?.querySelector('micrio-button.down')).toBeNull()
		opened.viewer.destroy()
	})
})

describe('marker popup translation', () => {
	it('re-renders its control titles on a language switch', async () => {
		const fixture = markerBundle({
			markers: [marker('m1', { i18n: { en: { title: 'One' }, nl: { title: 'Een' } } })],
			langs: ['en', 'nl'],
			settings: { _markers: { canMinimizePopup: true } },
		})
		const opened = await openMarkers(fixture)
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		expect(control(opened, 'micrio-button.close')?.getAttribute('title')).toBe('Close this marker')

		opened.viewer.el.setAttribute('lang', 'nl')
		await waitFor(
			() => control(opened, 'micrio-button.close')?.getAttribute('title') === 'Sluit deze marker',
			6000,
			'the translated close button',
		)
		expect(control(opened, 'micrio-button.down')?.getAttribute('title')).toBe('Minimaliseer')
		opened.viewer.destroy()
	})
})

describe('marker popup during a marker tour', () => {
	it('advances the tour through the popup and stops it on the last step', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ steps: ['m1', 'm2'] })] })
		const tour = fixture.markerTours[0]
		if (!tour) {
			throw new Error('no tour')
		}
		const opened = await openMarkers(fixture)
		opened.viewer.el.state.tour.set(tour)
		await waitForPopup(opened.viewer.el)

		// Not on the last step: the popup's control advances the tour
		expect(control(opened, 'micrio-button.next')).not.toBeNull()
		expect(control(opened, 'micrio-button.close')).toBeNull()
		expect(control(opened, 'micrio-button.next')?.getAttribute('title')).toBe('Next step')

		control(opened, 'micrio-button.next')?.click()
		await waitFor(() => tour.currentStep === 1, 6000, 'the second step')

		// On the last step it closes (and with it, the tour)
		await waitFor(() => control(opened, 'micrio-button.close') !== null, 6000, 'the close control')
		control(opened, 'micrio-button.close')?.click()
		await waitFor(() => opened.viewer.el.state.$tour === undefined, 6000, 'the tour stopped')
		opened.viewer.destroy()
	})
})
