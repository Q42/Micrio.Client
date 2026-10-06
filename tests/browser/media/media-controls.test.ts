import { describe, expect, it, vi } from 'vitest'
import { createElement } from '$utils/dom'
import type { MicrioElement } from '$core/component'
import { mountTour, settle } from '../../helpers/tour'
import { tourBundle } from '../../fixtures/tours'

/**
 * `<micrio-media-controls>` is the tour playback UI: play/pause, mute, seek,
 * subtitles toggle and close. It is driven entirely by props from
 * `<micrio-media>`, so these tests mount it directly and assert the callbacks it
 * fires and the controls it renders for a given prop set.
 */
async function mountControls(props: Record<string, unknown>) {
	const viewer = await mountTour(tourBundle({}))
	const el = createElement('micrio-media-controls', { setProps: props, parent: viewer.el }) as MicrioElement
	await settle(3)
	return { viewer, el }
}

const timeText = (el: Element) => el.querySelector('aside > div > span')?.textContent
/** The class list of the first control, which encodes its current icon. */
const icon = (el: Element) => el.querySelector('micrio-button')?.className
const bar = (el: Element) => el.querySelector<HTMLElement>('[data-part="bar"]')

describe('media controls rendering', () => {
	it('renders the play button and time display by default', async () => {
		const { viewer, el } = await mountControls({ paused: true, duration: 10, currentTime: 3 })
		expect(el.querySelector<HTMLButtonElement>('micrio-button.play > button')).not.toBeNull()
		// Without getTimeDisplay the control falls back to its own mm:ss formatting
		expect(timeText(el)).toBeTruthy()
		viewer.destroy()
	})

	it('uses a custom getTimeDisplay verbatim', async () => {
		const { viewer, el } = await mountControls({
			paused: true,
			duration: 10,
			currentTime: 3,
			getTimeDisplay: (current: number, duration: number) => `CUSTOM ${current}/${duration}`,
		})
		expect(timeText(el)).toBe('CUSTOM 3/10')
		viewer.destroy()
	})

	it('shows the mute button only when there is audio', async () => {
		const withAudio = await mountControls({ paused: true, duration: 10, hasAudio: true })
		// The mute button carries the state class (`muted` / `unmuted`)
		expect(withAudio.el.querySelector('micrio-button.unmuted, micrio-button.muted')).not.toBeNull()
		withAudio.viewer.destroy()

		const withoutAudio = await mountControls({ paused: true, duration: 10, hasAudio: false })
		expect(withoutAudio.el.querySelectorAll('micrio-button').length).toBe(1)
		withoutAudio.viewer.destroy()
	})

	it('shows the subtitles button only when subtitles exist', async () => {
		const withSubs = await mountControls({ paused: true, duration: 10, subtitles: true })
		const withoutSubs = await mountControls({ paused: true, duration: 10 })
		expect(withSubs.el.querySelectorAll('micrio-button').length).toBe(
			withoutSubs.el.querySelectorAll('micrio-button').length + 1,
		)
		withSubs.viewer.destroy()
		withoutSubs.viewer.destroy()
	})

	it('shows the close button only when a close handler exists', async () => {
		const onclose = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 10, onclose })
		expect(el.querySelector<HTMLButtonElement>('micrio-button.close > button')).not.toBeNull()
		viewer.destroy()
	})

	it('reflects the paused and ended state on the play button', async () => {
		const playing = await mountControls({ paused: false, duration: 10, currentTime: 2 })
		const paused = await mountControls({ paused: true, duration: 10, currentTime: 2 })
		const ended = await mountControls({ paused: true, ended: true, duration: 10, currentTime: 10 })

		// Each state renders a distinct play/pause icon class
		expect(icon(ended.el)).not.toBe(icon(playing.el))
		expect(icon(paused.el)).not.toBe(icon(playing.el))
		playing.viewer.destroy()
		paused.viewer.destroy()
		ended.viewer.destroy()
	})
})

describe('media controls interaction', () => {
	it('calls onplaypause when the play button is clicked', async () => {
		const onplaypause = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 10, onplaypause })

		el.querySelector<HTMLButtonElement>('micrio-button.play > button')?.click()
		expect(onplaypause).toHaveBeenCalledTimes(1)
		viewer.destroy()
	})

	it('calls onmute when the mute button is clicked', async () => {
		const onmute = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 10, hasAudio: true, onmute })

		const mute = el.querySelector<HTMLButtonElement>('micrio-button.unmuted > button, micrio-button.muted > button')
		mute?.click()
		expect(onmute).toHaveBeenCalledTimes(1)
		viewer.destroy()
	})

	it('calls onclose from the close button', async () => {
		const onclose = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 10, onclose })

		el.querySelector<HTMLButtonElement>('micrio-button.close > button')?.click()
		expect(onclose).toHaveBeenCalledTimes(1)
		viewer.destroy()
	})

	it('maps a drag on the progress bar to a seek time', async () => {
		const onseek = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 20, onseek })

		const bars = el.querySelector<HTMLElement>('[data-part="bars"]')
		if (!bars) {
			throw new Error('no progress bar')
		}
		// jsdom-less Chromium reports no client rects for an unlaid-out element, so
		// stub the geometry the handler measures against.
		vi.spyOn(bars, 'getClientRects').mockReturnValue([
			{ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) },
		] as unknown as DOMRectList)

		bars.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, button: 0, bubbles: true }))
		expect(onseek).toHaveBeenCalledTimes(1)
		expect(onseek.mock.calls[0]?.[0]).toBeCloseTo(10, 5)

		globalThis.dispatchEvent(new MouseEvent('mouseup'))
		viewer.destroy()
	})

	it('seeks to zero when the duration is unknown', async () => {
		const onseek = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, onseek })
		const bars = el.querySelector<HTMLElement>('[data-part="bars"]')
		if (!bars) {
			throw new Error('no progress bar')
		}
		vi.spyOn(bars, 'getClientRects').mockReturnValue([
			{ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) },
		] as unknown as DOMRectList)

		bars.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, button: 0, bubbles: true }))
		expect(onseek).toHaveBeenCalledWith(0)
		globalThis.dispatchEvent(new MouseEvent('mouseup'))
		viewer.destroy()
	})

	it('ignores a non-primary mouse button on the bar', async () => {
		const onseek = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 10, onseek })
		const bars = el.querySelector<HTMLElement>('[data-part="bars"]')
		if (!bars) {
			throw new Error('no progress bar')
		}
		vi.spyOn(bars, 'getClientRects').mockReturnValue([
			{ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) },
		] as unknown as DOMRectList)

		bars.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, button: 2, bubbles: true }))
		expect(onseek).not.toHaveBeenCalled()
		viewer.destroy()
	})

	it('updates the bar width as the current time changes', async () => {
		const { viewer, el } = await mountControls({ paused: true, duration: 10, currentTime: 2 })
		expect(bar(el)?.style.width).toBe('20%')

		;(el as unknown as { _setProps: (p: unknown) => void })._setProps({ paused: true, duration: 10, currentTime: 8 })
		await settle(2)
		expect(bar(el)?.style.width).toBe('80%')
		viewer.destroy()
	})

	it('keeps working when partial props arrive during playback', async () => {
		// `media.ts#updateControls` re-sends only the time-related props. The state
		// change rebuilds the play button (play -> pause) and the callback has to be
		// re-attached from the merged props, not lost with the old element.
		const onplaypause = vi.fn()
		const { viewer, el } = await mountControls({ paused: true, duration: 10, currentTime: 2, onplaypause })

		;(el as unknown as { _setProps: (p: unknown) => void })._setProps({ paused: false, currentTime: 4 })
		await settle(2)

		const pauseBtn = el.querySelector<HTMLButtonElement>('micrio-button.pause > button')
		expect(pauseBtn).not.toBeNull()
		pauseBtn?.click()
		expect(onplaypause).toHaveBeenCalledTimes(1)

		// A second, display-identical update reuses the element and keeps the handler
		;(el as unknown as { _setProps: (p: unknown) => void })._setProps({ paused: true, currentTime: 6 })
		await settle(2)
		el.querySelector<HTMLButtonElement>('micrio-button.play > button')?.click()
		expect(onplaypause).toHaveBeenCalledTimes(2)
		viewer.destroy()
	})
})
