import { describe, expect, it } from 'vitest'
import { embedPresentation, type EmbedPresentationInput } from '$embed/presentation'

const base: EmbedPresentationInput = {
	isBook3d: false,
	imageAsHtml: false,
	forceGL: true,
	isSmall: false,
	hasSrc: true,
	hasSubImage: true,
	hasVideo: false,
	videoControls: false,
	videoTransparent: false,
	clickAction: false,
	frameSrc: false,
	hasMarker: false,
}

describe('embedPresentation', () => {
	it('uses GL for a capable image', () => {
		expect(embedPresentation(base).mode).toBe('gl')
	})

	it('uses HTML when asked or for a book', () => {
		expect(embedPresentation({ ...base, imageAsHtml: true }).mode).toBe('html')
		expect(embedPresentation({ ...base, isBook3d: true }).mode).toBe('html')
	})

	it('adds an overlay for a click action and flags a raw video', () => {
		expect(embedPresentation({ ...base, clickAction: true }).mode).toBe('gl+overlay')
		expect(embedPresentation({ ...base, hasVideo: true }).rawVideo).toBe(true)
	})
})
