import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import { embed, frameEmbed, glEmbed, imageEmbed, videoEmbed } from '../../fixtures/embeds'
import {
	contentOf,
	containerOf,
	fakeImage,
	mockHost,
	mountEmbed,
	setCurrent,
	type FakeImage,
} from '../../helpers/embed'
import type { Viewer } from '../../helpers/viewer'

/**
 * `<micrio-embed>` in a book3d album.
 *
 * A book3d album has its own WebGL renderer, so the embed module forces
 * `#printGL` off: every book3d embed is an HTML overlay placed by
 * `transform: matrix3d(...)`, produced by the `camera._getMatrixOverride` that
 * `src/book/main.ts` installs for drawn pages. That override is the seam these
 * tests drive — the album itself (`openBook`) is not mounted, because the
 * book3d branch of *this module* is fully reachable with the override stubbed
 * and the album harness costs a WebGL context per test.
 *
 * `#isBook3d` is read from `micrio.$current.album.info.type` at mount, so the
 * fake image is attached as the host's current image first.
 */
function book3dImage(overrides: Partial<FakeImage> = {}): FakeImage {
	const image = fakeImage(overrides)
	image.album = {
		info: { type: 'book3d' },
		numPages: 1,
		currentIndex: 0,
		prev() {},
		next() {},
		goto: () => Promise.resolve(image as unknown as MicrioImage),
	}
	return image
}

let host: Viewer
const mounted: HTMLElement[] = []

beforeEach(() => {
	host = mockHost()
})

function mountBook(data: Models.ImageData.Embed, image: FakeImage): HTMLElement {
	setCurrent(host, image)
	const el = mountEmbed({ embed: data, image }, host.el)
	mounted.push(el)
	return el
}

afterEach(() => {
	for (const el of mounted) {
		el.remove()
	}
	mounted.length = 0
	host.destroy()
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('book3d embeds', () => {
	it('never renders a book3d embed inside WebGL', () => {
		const image = book3dImage()
		const el = mountBook(glEmbed(), image)
		expect(image.addEmbed).not.toHaveBeenCalled()
		expect(image._embeds).toHaveLength(0)
		// A micrioId-only embed degrades to an inert hotspot button.
		expect(contentOf(el)?.tagName).toBe('BUTTON')
	})

	it('keeps the embed hidden for the 500 ms placement delay', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		image.camera.getMatrix.mockReturnValue(new Float32Array(16).fill(0.5))
		const el = mountBook(frameEmbed(), image)
		const c = containerOf(el) as HTMLElement

		expect(c.style.display).toBe('none')
		expect(c.style.transform).toBe('')
		vi.advanceTimersByTime(500)
		expect(c.style.display).toBe('')
		expect(c.style.transform).toMatch(/^matrix3d\(/)
	})

	it('cancels the placement delay when destroyed', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		image.camera.getMatrix.mockReturnValue(new Float32Array(16).fill(0.5))
		const el = mountBook(frameEmbed(), image)
		const c = containerOf(el) as HTMLElement
		el.remove()
		vi.advanceTimersByTime(1000)
		expect(c.style.transform).toBe('')
	})

	it('hides the overlay when the page matrix is empty', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		// What `_getMatrixOverride` returns for a page that is not facing the camera.
		image.camera.getMatrix.mockReturnValue(new Float32Array())
		const el = mountBook(frameEmbed(), image)
		vi.advanceTimersByTime(500)
		expect((containerOf(el) as HTMLElement).style.display).toBe('none')
	})

	it('passes the area-scaled matrix width, rotations and non-uniform scale', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		mountBook(frameEmbed({ scale: 2, rotX: 0.1, rotY: 0.2, rotZ: 0.3, scaleX: 2, scaleY: 3 }), image)
		vi.advanceTimersByTime(500)
		const [args] = image.camera.getMatrix.mock.calls as [number[]]
		expect(args[0]).toBeCloseTo(0.375)
		expect(args[1]).toBeCloseTo(0.375)
		// #matrixScale = area width * embed.scale; #contentWidth = area width * image width.
		expect(args[2]).toBe(0.5)
		expect(args[3]).toBe(128)
		expect(args.slice(4, 7)).toEqual([0.1, 0.2, 0.3])
		expect(args[8]).toBe(2)
		expect(args[9]).toBe(3)
	})

	it('uses the asset width as the content width for a src image embed', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		mountBook(imageEmbed({ width: 300 }), image)
		vi.advanceTimersByTime(500)
		expect((image.camera.getMatrix.mock.calls[0] as number[])[3]).toBe(300)
	})

	it('uses the button default content width of 100', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		mountBook(embed(), image)
		vi.advanceTimersByTime(500)
		expect((image.camera.getMatrix.mock.calls[0] as number[])[3]).toBe(100)
	})

	it('sizes a book3d video embed from its area cap', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		const el = mountBook(videoEmbed({}, { controls: true }), image)
		const video = el.querySelector('video')
		// The area is a quarter of a 512px image (128px) and the video is 640x360,
		// so the cap is the area width and the height follows the aspect ratio.
		expect(video?.getAttribute('width')).toBe('128')
		expect(video?.getAttribute('height')).toBe('72')
	})

	it('sizes a book3d video embed from the video when it is narrower than the area', () => {
		vi.useFakeTimers()
		const image = book3dImage()
		const el = mountBook(videoEmbed({}, { controls: true, width: 64, height: 36 }), image)
		const video = el.querySelector('video')
		expect(video?.getAttribute('width')).toBe('64')
		expect(video?.getAttribute('height')).toBe('36')
		// The rendered width is still the area width (the video is scaled up), so the
		// book matrix keeps normalising against the area width.
		expect(video?.style.transform).toBe('scale(2)')
	})
})
