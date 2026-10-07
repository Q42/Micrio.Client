import { describe, expect, it } from 'vitest'
import { createElement } from '$utils/dom'
import type { MicrioElement } from '$core/component'
import { captionsEnabled } from '$media/subtitles'
import { vtt } from '../../fixtures/tours'
import { mountTour, settle } from '../../helpers/tour'
import { mockText, requested } from '../../helpers/network'
import { baseInfo } from '../../fixtures/bundles'
import type { Models } from '$types/models'
import { waitFor } from '../../helpers/viewer'

const SUB_URL = 'https://r2.micr.io/test-subs.vtt'
/** `mockText` takes a pattern, not a URL: the matcher is a RegExp. */
const SUB_MATCH = /test-subs\.vtt/

/** A minimal image so the subtitles element has a `<micr-io>` ancestor to inject from. */
const subtitleBundle = (): Models.ImageBundle.BundleImage => ({
	id: 'subs000',
	info: baseInfo('subs000'),
	settings: {},
	data: {},
})

/**
 * `<micrio-subtitles>` fetches a WebVTT document and renders the cue matching the
 * media element's currentTime. The parser accepts `HH:MM:SS.mmm`, `MM:SS.mmm` and
 * the comma decimal separator that broadcast tools emit.
 */
async function mountSubtitles(src: string | undefined, opts: { autoFetch?: boolean } = {}) {
	const viewer = await mountTour(subtitleBundle())
	const mediaEl = createElement('audio', { parent: document.body })
	const el = createElement('micrio-subtitles', {
		setProps: { src, mediaEl },
		parent: viewer.el,
	}) as MicrioElement
	if (opts.autoFetch !== false) {
		await settle(3)
	}
	return { viewer, mediaEl, el }
}

describe('subtitles', () => {
	it('renders the cue containing the current time', async () => {
		mockText(SUB_MATCH, vtt())
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 2
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => el.textContent !== '', 4000, 'first cue')
		expect(el.textContent).toContain('First cue')

		mediaEl.currentTime = 4
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => (el.textContent ?? '').includes('Second cue'), 4000, 'second cue')
		expect(el.textContent).toContain('with two lines')
		viewer.destroy()
	})

	it('clears between cues', async () => {
		mockText(SUB_MATCH, vtt())
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 2
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => el.textContent !== '', 4000, 'first cue')

		// 3.2s falls in the gap between the first and second cue
		mediaEl.currentTime = 3.2
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => el.textContent === '', 4000, 'cue cleared')
		viewer.destroy()
	})

	it('parses a minute-only timestamp', async () => {
		mockText(SUB_MATCH, vtt())
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 7
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => (el.textContent ?? '').includes('Minute-only cue'), 4000, 'minute cue')
		viewer.destroy()
	})

	it('renders a cue whose timing line carries cue settings', async () => {
		// WebVTT allows settings after the end timestamp. Parsing the whole tail as part of it
		// turned the end into NaN, and a cue whose end never matched stayed invisible.
		mockText(SUB_MATCH, 'WEBVTT\n\n00:00:09.000 --> 00:00:11.000 align:start position:10%\nSettings cue\n')
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 10
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => (el.textContent ?? '').includes('Settings cue'), 4000, 'the cue with settings')
		viewer.destroy()
	})

	it('ignores malformed blocks and keeps the valid ones', async () => {
		mockText(SUB_MATCH, vtt({ malformed: true }))
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 2
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => (el.textContent ?? '').includes('First cue'), 4000, 'valid cue after junk')
		viewer.destroy()
	})

	it('joins multi-line cues', async () => {
		mockText(SUB_MATCH, vtt())
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 4
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => (el.textContent ?? '').includes('Second cue'), 4000, 'multi-line cue')
		expect(el.querySelector('p')?.textContent).toContain('\n')
		viewer.destroy()
	})

	it('hides cues while captions are disabled, and restores them', async () => {
		mockText(SUB_MATCH, vtt())
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)
		mediaEl.currentTime = 2
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await waitFor(() => el.textContent !== '', 4000, 'cue shown')

		captionsEnabled.set(false)
		await settle(2)
		expect(el.textContent).toBe('')
		expect(localStorage.getItem('micrio-captions-disable')).toBe('1')

		captionsEnabled.set(true)
		await settle(2)
		expect(el.textContent).toContain('First cue')
		expect(localStorage.getItem('micrio-captions-disable')).toBeNull()
		viewer.destroy()
	})

	it('renders nothing without a source', async () => {
		const noSrc: string | undefined = undefined
		const { viewer, el } = await mountSubtitles(noSrc)
		expect(el.textContent).toBe('')
		expect(el.childElementCount).toBe(0)
		viewer.destroy()
	})

	it('survives a failed fetch without throwing', async () => {
		// No route mocked: the helper's fetch 404s
		const { viewer, mediaEl, el } = await mountSubtitles(SUB_URL)

		mediaEl.currentTime = 2
		mediaEl.dispatchEvent(new Event('timeupdate'))
		await settle(4)
		expect(el.textContent).toBe('')
		viewer.destroy()
	})

	it('does not refetch when the same src is re-applied', async () => {
		mockText(SUB_MATCH, vtt())
		const { viewer, el } = await mountSubtitles(SUB_URL)
		await settle(2)
		const callsAfterMount = requested.filter((u) => u === SUB_URL).length

		;(el as unknown as { _setProps: (p: unknown) => void })._setProps({ src: SUB_URL, mediaEl: undefined })
		await settle(3)
		expect(requested.filter((u) => u === SUB_URL).length).toBe(callsAfterMount)
		viewer.destroy()
	})
})
