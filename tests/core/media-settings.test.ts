import { describe, expect, it } from 'vitest'
import type { MicrioImage } from '../../src/core/image'
import type { Models } from '../../src/types/models'
import { imageHasAudio, mutedVolume, startVolume, volumeFor } from '../../src/utils/media-settings'

/**
 * The volume rules three places share: the `volume` store the layout provides, the Web
 * Audio master gain, and the playlist's own element volume. They read only `$settings`
 * and `$data`, so a plain stub is enough.
 */
function stubImage(
	settings: Models.ImageInfo.Settings = {},
	markers: Models.ImageData.Marker[] = [],
	music?: Models.ImageData.ImageData['music'],
): MicrioImage {
	return {
		$settings: settings,
		$data: { markers, ...(music ? { music } : {}) },
	} as unknown as MicrioImage
}

const marker = (positionalAudio?: Models.Assets.AudioLocation): Models.ImageData.Marker => ({
	id: 'm1',
	x: 0.5,
	y: 0.5,
	...(positionalAudio ? { positionalAudio } : {}),
})

/** The smallest shape `imageHasAudio` looks at. */
const positional = { src: 'https://example.test/a.mp3' } as Models.Assets.AudioLocation

const music = (items: Models.Assets.Audio[]): Models.ImageData.ImageData['music'] => ({ items, loop: true })

const track = { title: 't', src: 'https://example.test/t.mp3' } as Models.Assets.Audio

describe('volume settings', () => {
	it('defaults to full volume playing and silence muted', () => {
		const image = stubImage()
		expect(startVolume(image)).toBe(1)
		expect(mutedVolume(image)).toBe(0)
		expect(volumeFor(image, false)).toBe(1)
		expect(volumeFor(image, true)).toBe(0)
	})

	it('reads the configured levels', () => {
		const image = stubImage({ startVolume: 0.3, mutedVolume: 0.6 })
		expect(volumeFor(image, false)).toBeCloseTo(0.3, 6)
		expect(volumeFor(image, true)).toBeCloseTo(0.6, 6)
	})

	it('clamps a level outside 0-1', () => {
		expect(volumeFor(stubImage({ startVolume: 2 }), false)).toBe(1)
		expect(volumeFor(stubImage({ startVolume: -1 }), false)).toBe(0)
		expect(volumeFor(stubImage({ mutedVolume: 5 }), true)).toBe(1)
		expect(volumeFor(stubImage({ mutedVolume: -5 }), true)).toBe(0)
	})

	it('falls back to the default for a non-finite level', () => {
		// A stale or hand-written setting must not write a NaN/Infinity gain
		expect(volumeFor(stubImage({ startVolume: Number.NaN }), false)).toBe(1)
		expect(volumeFor(stubImage({ mutedVolume: Number.POSITIVE_INFINITY }), true)).toBe(0)
	})
})

describe('whether an image has audio', () => {
	it('is false for an image with neither music nor positional audio', () => {
		expect(imageHasAudio(stubImage())).toBe(false)
		expect(imageHasAudio(stubImage({}, [marker()]))).toBe(false)
		// An empty playlist is not audio either
		expect(imageHasAudio(stubImage({}, [], music([])))).toBe(false)
	})

	it('is true for music and for a positional marker', () => {
		expect(imageHasAudio(stubImage({}, [], music([track])))).toBe(true)
		expect(imageHasAudio(stubImage({}, [marker(positional)]))).toBe(true)
	})
})
