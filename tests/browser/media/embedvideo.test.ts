import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import { get, writable, type Writable } from '$core/store'
import type { Engine } from '$render/engine'
import { cloudflareStreamUrl } from '$media/hls-adapter'
import { GLEmbedVideo } from '$media/embedvideo'
import type { Models } from '$types/models'
import { videoAsset, type VideoExtra } from '../../fixtures/embeds'

/**
 * `GLEmbedVideo` — the controller for a video embed rendered *inside* WebGL.
 *
 * It owns a single `<video>` used as a texture source, so its whole contract is
 * driven by two things: the sub-image's `visible` store and media-element events.
 * Both are faked here (the store is a plain writable; the media events are
 * dispatched by hand), and timers are faked so the visibility debounce and the
 * `loopAfter` restart are deterministic. `HTMLMediaElement.prototype.play` is
 * already stubbed by the browser setup.
 *
 * `hideWhenPaused`, `loop`/`loopAfter` and the HLS path are the branches the
 * media suites do not reach (they only cover `<micrio-media>`).
 */
interface EngineStub {
	_setImageVideoPlaying: ReturnType<typeof vi.fn>
	_fadeImage: ReturnType<typeof vi.fn>
	render: ReturnType<typeof vi.fn>
}

interface ImageStub {
	id: string
	_video: HTMLVideoElement | undefined
	visible: Writable<boolean>
	video: Writable<HTMLVideoElement | undefined>
}

const globals = globalThis as Record<string, unknown>

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	for (const name of ['Hls']) {
		Reflect.deleteProperty(globals, name)
	}
	document.body.replaceChildren()
})

function setup(
	video: VideoExtra = {},
	embed: Partial<Models.ImageData.Embed> = {},
	paused = false,
): { gl: GLEmbedVideo; image: ImageStub; engine: EngineStub; moved: ReturnType<typeof vi.fn> } {
	const image: ImageStub = { id: 'img', _video: undefined, visible: writable(false), video: writable() }
	const engine: EngineStub = {
		_setImageVideoPlaying: vi.fn(),
		_fadeImage: vi.fn(),
		render: vi.fn(),
	}
	const moved = vi.fn()
	const embedData: Models.ImageData.Embed = {
		area: [0, 0, 1, 1],
		width: 640,
		height: 360,
		...embed,
		video: videoAsset({ src: 'https://example.test/v.webm', ...video }),
	}
	const gl = new GLEmbedVideo(engine as unknown as Engine, image as unknown as MicrioImage, embedData, paused, moved)
	return { gl, image, engine, moved }
}

/** Flips the sub-image visible and runs the (debounced) load. */
function show(image: ImageStub): void {
	image.visible.set(true)
	vi.advanceTimersByTime(200)
}

describe('GLEmbedVideo loading', () => {
	it('does not create the element until the sub-image is visible', () => {
		const { gl } = setup()
		vi.advanceTimersByTime(500)
		expect(gl._vid).toBeUndefined()
	})

	it('creates a cross-origin, muted, inline video element from the asset', () => {
		const { gl, image } = setup({ muted: true })
		show(image)
		const vid = gl._vid
		expect(vid).toBeInstanceOf(HTMLVideoElement)
		expect(vid?.crossOrigin).toBe('anonymous')
		expect(vid?.playsInline).toBe(true)
		expect(vid?.muted).toBe(true)
		expect(vid?.getAttribute('src')).toBe('https://example.test/v.webm')
		expect(vid?.getAttribute('width')).toBe('640')
		expect(vid?.getAttribute('height')).toBe('360')
	})

	it('logs and bails out when the asset has no source', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { gl, image } = setup({ src: '' })
		show(image)
		expect(gl._vid).toBeUndefined()
		expect(error.mock.calls[0]?.[0]).toContain('No video source')
	})

	it('routes a stream id through the HLS player instead of the raw src', async () => {
		const calls: string[] = []
		const destroy = vi.fn()
		class FakeHls {
			loadSource(src: string): void {
				calls.push(`load:${src}`)
			}
			attachMedia(): void {
				calls.push('attach')
			}
			destroy = destroy
		}
		globals.Hls = FakeHls

		const { gl, image } = setup({ streamId: 'abc123' })
		show(image)
		await Promise.resolve()

		expect(calls).toContain(`load:${cloudflareStreamUrl('abc123')}`)
		expect(calls).toContain('attach')
		expect(gl._vid?.getAttribute('src')).toBeNull()

		gl._unmount()
		expect(destroy).toHaveBeenCalled()
	})
})

describe('GLEmbedVideo playback state', () => {
	it('reports play and pause to the engine', () => {
		const { gl, image, engine } = setup()
		show(image)
		const vid = gl._vid

		vid?.dispatchEvent(new Event('play'))
		expect(engine._setImageVideoPlaying).toHaveBeenCalledWith(image, true)
		expect(vid?.dataset.playing).toBe('1')

		vid?.dispatchEvent(new Event('pause'))
		expect(engine._setImageVideoPlaying).toHaveBeenLastCalledWith(image, false)
		expect(vid?.dataset.playing).toBeUndefined()
	})

	it('fades the image when hideWhenPaused is set', () => {
		const { gl, image, engine } = setup({}, { hideWhenPaused: true })
		show(image)
		gl._vid?.dispatchEvent(new Event('play'))
		expect(engine._fadeImage).toHaveBeenCalledWith(image, 1)
		gl._vid?.dispatchEvent(new Event('pause'))
		expect(engine._fadeImage).toHaveBeenLastCalledWith(image, 0)
	})

	it('publishes the video to the image after its first real frame', () => {
		const { gl, image, engine } = setup()
		show(image)
		const vid = gl._vid as HTMLVideoElement
		;(vid as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback = (cb) => {
			cb()
			return 1
		}
		vid.dispatchEvent(new Event('playing'))
		expect(get(image.video)).toBe(vid)
		expect(engine.render).toHaveBeenCalled()
	})

	it('restarts a loopAfter video only after the configured delay', () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
		const { gl, image } = setup({ loop: true, loopAfter: 2 })
		show(image)
		const vid = gl._vid as HTMLVideoElement
		expect(vid.loop).toBe(false)
		vid.dispatchEvent(new Event('ended'))
		expect(play).not.toHaveBeenCalled()
		vi.advanceTimersByTime(2000)
		expect(play).toHaveBeenCalled()
	})

	it('keeps a non-autoplaying element off-DOM after its first frame', async () => {
		const { gl, image } = setup({ autoplay: false })
		show(image)
		const vid = gl._vid as HTMLVideoElement
		expect(vid.parentNode).toBe(document.body)
		vid.dispatchEvent(new Event('canplay'))
		await Promise.resolve()
		await Promise.resolve()
		expect(vid.parentNode).toBeNull()
	})
})

describe('GLEmbedVideo teardown', () => {
	it('pauses the element and stops reacting to visibility', () => {
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
		const { gl, image } = setup()
		show(image)
		gl._unmount()
		expect(pause).toHaveBeenCalled()
		play.mockClear()
		image.visible.set(true)
		vi.advanceTimersByTime(500)
		expect(play).not.toHaveBeenCalled()
	})

	it('cancels a pending visibility pause', () => {
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
		const { gl, image } = setup()
		show(image)
		image.visible.set(false)
		gl._cancelTimeout()
		vi.advanceTimersByTime(50)
		expect(pause).not.toHaveBeenCalled()
	})
})
