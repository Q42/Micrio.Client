import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable } from '$core/store'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import { Browser } from '$utils/browser'
import { IFRAME_ALLOW } from '$utils/dom'
import { marker } from '../../fixtures/bundles'
import { embed, frameEmbed, glEmbed, imageEmbed, videoEmbed } from '../../fixtures/embeds'
import {
	containerOf,
	contentOf,
	cssVar,
	dispatchChange,
	fakeImage,
	mockHost,
	mountEmbed,
	type FakeImage,
} from '../../helpers/embed'
import type { Viewer } from '../../helpers/viewer'

/**
 * `<micrio-embed>` — the 2D branch matrix.
 *
 * The element mounts against a mocked `MicrioImage` (see `helpers/embed.ts`), so
 * every decision here is deterministic and no WebGL context is created. The
 * real-camera / real-engine / real-layout behaviour lives in
 * `tests/browser/embed/embed-360.test.ts` and `image-embeds.test.ts`.
 *
 * Tests whose name starts with `KNOWN GAP` deliberately assert the *current*
 * (wrong) behaviour of a bug that has no test yet; when the gap closes, these
 * are the tests that must change (see TESTING.md).
 */

const initialUA = navigator.userAgent
const initialOSX = Browser.OSX

let host: Viewer
const mounted: HTMLElement[] = []

beforeEach(() => {
	host = mockHost()
})

afterEach(() => {
	for (const el of mounted) {
		el.remove()
	}
	mounted.length = 0
	host.destroy()
	vi.useRealTimers()
	vi.restoreAllMocks()
	Object.defineProperty(navigator, 'userAgent', { value: initialUA, configurable: true })
	Browser.OSX = initialOSX
})

/** Mounts an embed on a fresh fake image and returns both. */
function mountRaw(
	data: Models.ImageData.Embed,
	overrides: Partial<FakeImage> = {},
	markerData?: Models.ImageData.Marker,
): { el: HTMLElement; image: FakeImage } {
	const image = fakeImage(overrides)
	return { el: mountOn(image, data, markerData), image }
}

/** Mounts an embed on an already-built fake image (so stores can be primed first). */
function mountOn(image: FakeImage, data: Models.ImageData.Embed, markerData?: Models.ImageData.Marker): HTMLElement {
	const el = mountEmbed({ embed: data, image, marker: markerData }, host.el)
	mounted.push(el)
	return el
}

/** Primes the view pair and host viewport so `#shouldPause` sees a deterministic screen size (~0.33). */
function primeScreen(): FakeImage {
	host.el.canvas.viewport.width = 800
	host.el.canvas.viewport.height = 600
	const image = fakeImage()
	image.state.view.set([0, 0, 1, 1])
	image._viewport.set([0, 0, 800, 600])
	return image
}

/** Forces the `(dynamic-range: high)` media query, which decides the video GL fallback. */
const stubHdr = (matches: boolean): void => {
	vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches } as MediaQueryList)
}

/** `#noEvents` is true for every embed without an interaction hook. */
const hasNoEvents = (el: Element): boolean => containerOf(el)?.classList.contains('no-events') ?? false

describe('mounting', () => {
	it('renders nothing without props and does not throw', () => {
		const el = document.createElement('micrio-embed')
		host.el.append(el)
		mounted.push(el)
		expect(containerOf(el)).toBeNull()
	})

	it('mints a uuid onto the manifest object when the embed has none', () => {
		const data = embed({ src: 'about:blank' })
		expect(data.uuid).toBeUndefined()
		mountRaw(data)
		expect(data.uuid).toBeTruthy()
	})

	it('keeps an existing uuid', () => {
		const data = embed({ src: 'about:blank', uuid: 'fixed' })
		mountRaw(data)
		expect(data.uuid).toBe('fixed')
	})
})

describe('HTML content', () => {
	it('builds an <img> for a src embed with the placement ratio and scale', () => {
		const { el } = mountRaw(imageEmbed({ id: 'e1' }))
		const img = el.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('about:blank')
		expect(img?.getAttribute('alt')).toBe('Embed')
		expect(img?.dataset.scrollThrough).toBe('')
		expect(img?.style.getPropertyValue('--ratio')).toBe('1')
		expect(img?.style.getPropertyValue('--scale')).toBe('1.28')
		expect(containerOf(el)?.getAttribute('role')).toBe('figure')
		// Nothing to interact with -> the overlay lets pan/zoom through.
		expect(hasNoEvents(el)).toBe(true)
	})

	it('names the overlay e-<id>', () => {
		const { el } = mountRaw(imageEmbed({ id: 'e1' }))
		expect(containerOf(el)?.id).toBe('e-e1')
	})

	it('builds an inert <button> when the embed has no content', () => {
		host.el._lang.set('en')
		const { el } = mountRaw(embed({ title: 'Hotspot' }))
		const button = contentOf(el)
		expect(button?.tagName).toBe('BUTTON')
		expect(button?.getAttribute('aria-label')).toBe('embed-button')
		expect(button?.getAttribute('title')).toBe('Hotspot')
		expect(button?.style.getPropertyValue('--scale')).toBe('1.28')
	})

	it('falls back to the marker title for a button without its own title', () => {
		host.el._lang.set('en')
		const { el } = mountRaw(embed(), {}, marker('m1'))
		expect(contentOf(el)?.getAttribute('title')).toBe('Marker m1')
	})

	it('builds an iframe with pixel dimensions from the area and stays interactive', () => {
		const { el } = mountRaw(frameEmbed())
		const iframe = contentOf(el)
		expect(iframe?.tagName).toBe('IFRAME')
		expect(iframe?.getAttribute('src')).toBe('about:blank')
		expect(iframe?.getAttribute('width')).toBe('128')
		expect(iframe?.getAttribute('height')).toBe('128')
		expect(iframe?.getAttribute('allow')).toBe(IFRAME_ALLOW)
		expect(iframe?.hasAttribute('allowfullscreen')).toBe(true)
		expect(hasNoEvents(el)).toBe(false)
	})

	it('builds an HTML <video> with a figure when controls are requested', () => {
		const { el, image } = mountRaw(videoEmbed({ id: 'vid1' }, { controls: true }))
		const video = el.querySelector('video')
		expect(el.querySelector('figure')).not.toBeNull()
		expect(video?.getAttribute('width')).toBe('128')
		expect(video?.getAttribute('height')).toBe('72')
		expect(video?.hasAttribute('controls')).toBe(true)
		expect(video?.muted).toBe(false)
		expect(image.getEmbedMediaElement('vid1')).toBe(video)
	})

	it('caps a portrait video by its height', () => {
		const { el } = mountRaw(videoEmbed({}, { controls: true, width: 300, height: 600 }))
		const video = el.querySelector('video')
		expect(video?.getAttribute('width')).toBe('64')
		expect(video?.getAttribute('height')).toBe('128')
		// 128px of image width for 64px of video -> scaled up 2x through the figure transform.
		expect(video?.style.transform).toBe('scale(2)')
	})

	it('adds an H265 mp4 source for a transparent webm video', () => {
		const { el } = mountRaw(
			videoEmbed({}, { controls: true, transparent: true, hasH265: true, src: 'https://example.test/a.webm' }),
		)
		const source = el.querySelector('source')
		expect(source?.getAttribute('src')).toBe('https://example.test/a.mp4')
		expect(source?.getAttribute('type')).toBe('video/mp4;codecs=hvc1')
	})

	it('autoplays only when video.autoplay is set', () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
		mountRaw(videoEmbed({}, { controls: true }))
		expect(play).not.toHaveBeenCalled()
		mountRaw(videoEmbed({}, { controls: true, autoplay: true }))
		expect(play).toHaveBeenCalled()
	})

	it('restarts a loopAfter video after the configured delay', () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
		vi.useFakeTimers()
		const { el } = mountRaw(videoEmbed({}, { controls: true, loop: true, loopAfter: 2 }))
		const video = el.querySelector('video')
		expect(video?.loop).toBe(false)
		video?.dispatchEvent(new Event('ended'))
		expect(play).not.toHaveBeenCalled()
		vi.advanceTimersByTime(2000)
		expect(play).toHaveBeenCalled()
	})

	it('applies the embed opacity to the overlay and removes it at 1', () => {
		const { el } = mountRaw(imageEmbed({ opacity: 0.5 }))
		expect(cssVar(el, '--opacity')).toBe('0.5')
	})

	it('falls back to the area width for a video with malformed dimensions', () => {
		const { el } = mountRaw(videoEmbed({}, { controls: true, width: 0, height: 0 }))
		const video = el.querySelector('video')
		// A zero dimension would otherwise make both the cap and the aspect NaN.
		expect(video?.getAttribute('width')).toBe('128')
		expect(Number.isFinite(Number(video?.getAttribute('height')))).toBe(true)
	})
})

describe('WebGL render decision', () => {
	it('renders a large micrioId embed inside WebGL', () => {
		const { el, image } = mountRaw(glEmbed())
		expect(image.addEmbed).toHaveBeenCalledTimes(1)
		expect(containerOf(el)).toBeNull()
	})

	it('renders a small src image as HTML', () => {
		const { el, image } = mountRaw(glEmbed({ width: 300, height: 300, src: 'about:blank' }))
		expect(image.addEmbed).not.toHaveBeenCalled()
		expect(el.querySelector('img')).not.toBeNull()
	})

	it('renders a small embed without its own src inside WebGL', () => {
		const { image } = mountRaw(glEmbed({ width: 300, height: 300 }))
		expect(image.addEmbed).toHaveBeenCalledTimes(1)
	})

	it('honours data-embeds-inside-gl="true" by forcing WebGL', () => {
		host.el.dataset.embedsInsideGl = 'true'
		const { image } = mountRaw(glEmbed({ width: 300, height: 300, src: 'about:blank' }))
		expect(image.addEmbed).toHaveBeenCalledTimes(1)
	})

	it('honours data-embeds-inside-gl="false" by forcing HTML', () => {
		host.el.dataset.embedsInsideGl = 'false'
		const { el, image } = mountRaw(glEmbed())
		expect(image.addEmbed).not.toHaveBeenCalled()
		expect(containerOf(el)).not.toBeNull()
	})

	it('falls back to HTML for a non-HDR video in auto mode', () => {
		Browser.OSX = false
		stubHdr(false)
		const { el, image } = mountRaw(videoEmbed({}, { autoplay: false }))
		expect(image.addEmbed).not.toHaveBeenCalled()
		expect(el.querySelector('video')).not.toBeNull()
	})

	it('keeps a controls-less video in WebGL on an HDR setup', () => {
		Browser.OSX = true
		const { el, image } = mountRaw(videoEmbed({}, { autoplay: false }))
		expect(image.addEmbed).toHaveBeenCalledTimes(1)
		expect(containerOf(el)).toBeNull()
	})

	it('renders a transparent video as HTML', () => {
		const { el, image } = mountRaw(videoEmbed({}, { transparent: true, autoplay: false }))
		expect(image.addEmbed).not.toHaveBeenCalled()
		expect(el.querySelector('video')).not.toBeNull()
	})

	it('renders an SVG source as HTML with explicit dimensions', () => {
		const { el } = mountRaw(glEmbed({ src: 'about:blank/icon.svg', width: 200, height: 200 }))
		const img = el.querySelector('img')
		expect(img?.getAttribute('width')).toBe('200')
		expect(img?.getAttribute('height')).toBe('200')
		// #readPlacement appends the SVG height after the ratio/scale pair.
		expect(img?.style.height).toBe('200px')
		expect(img?.style.getPropertyValue('--scale')).toBe('0.64')
	})

	it('forces HTML on an iOS 14 user agent in auto mode', () => {
		Object.defineProperty(navigator, 'userAgent', {
			value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
			configurable: true,
		})
		const { image } = mountRaw(glEmbed())
		expect(image.addEmbed).not.toHaveBeenCalled()
	})
})

describe('WebGL placement', () => {
	it('passes the embed data, rotations and options to image.addEmbed', () => {
		const { image } = mountRaw(glEmbed({ uuid: 'u1', opacity: 0.5, rotX: 0.1, rotY: 0.2, rotZ: 0.3 }))
		const [info, settings, area, opts] = image.addEmbed.mock.calls[0] as [
			Record<string, unknown>,
			Record<string, unknown>,
			Models.Camera.View,
			Record<string, unknown>,
		]
		expect(info.id).toBe('subimg1')
		expect(info.title).toBe('u1')
		expect(info.path).toBe('https://r2.micr.io/')
		expect(info.isSingle).toBe(false)
		expect(info.isVideo).toBe(false)
		expect(settings._360).toEqual({ rotX: 0.1, rotY: 0.2, rotZ: 0.3 })
		expect(area).toEqual([0.25, 0.25, 0.25, 0.25])
		expect(opts.opacity).toBe(0.5)
		expect(opts.asImage).toBe(false)
		expect(image.engine.render).toHaveBeenCalled()
	})

	it('fades in at 0.01 when the embed hides while paused', () => {
		const { image } = mountRaw(glEmbed({ opacity: 0.5, hideWhenPaused: true }))
		const [, , , opts] = image.addEmbed.mock.calls[0] as [unknown, unknown, unknown, { opacity: number }]
		expect(opts.opacity).toBe(0.01)
	})

	it('reuses an already-placed WebGL image for the same uuid', () => {
		const data = glEmbed({ uuid: 'u1', rotX: 0.1, rotY: 0.2, rotZ: 0.3 })
		const image = fakeImage()
		const gl = {
			_placed: true,
			uuid: 'gl0',
			$info: { title: 'u1' },
			camera: { setArea: vi.fn(), setRotation: vi.fn() },
		}
		image._embeds.push(gl)
		mountOn(image, data)
		expect(image.addEmbed).not.toHaveBeenCalled()
		expect(gl.camera.setArea).toHaveBeenCalledWith(data.area)
		expect(gl.camera.setRotation).toHaveBeenCalledWith(0.1, 0.2, 0.3)
		expect(image.engine._fadeImage).toHaveBeenCalledWith(gl, 1)
	})

	it('keeps an interactive overlay alongside the WebGL image', () => {
		const { el, image } = mountRaw(glEmbed({ clickAction: 'markerId', clickTarget: 'm-2' }))
		expect(image.addEmbed).toHaveBeenCalledTimes(1)
		const container = containerOf(el)
		expect(container).not.toBeNull()
		container?.dispatchEvent(new MouseEvent('click'))
		expect(get(image.state.marker)).toBe('m-2')
	})

	it('KNOWN GAP: the parent tile base path overrides the embed’s own path and isSingle', () => {
		const { image } = mountRaw(glEmbed({ path: 'https://other.test/', isSingle: true }))
		const [info] = image.addEmbed.mock.calls[0] as [Record<string, unknown>]
		// `#printInsideGL` spreads the embed and then overwrites `path`/`isSingle`.
		expect(info.path).toBe('https://r2.micr.io/')
		expect(info.isSingle).toBe(false)
	})

	it('KNOWN GAP: rebuilding an embed leaks its WebGL sub-image', () => {
		const image = fakeImage()
		mountOn(image, glEmbed())
		expect(image._embeds).toHaveLength(1)
		// A fresh embed object has no uuid, so the lookup in #printInsideGL misses
		// and a second MicrioImage is created; _onDestroy only fades the first.
		mountOn(image, glEmbed())
		expect(image._embeds).toHaveLength(2)
	})
})

describe('click actions', () => {
	it('opens the marker of a clickable-area embed on click', () => {
		const { el, image } = mountRaw(imageEmbed(), {}, marker('area-1'))
		containerOf(el)?.dispatchEvent(new MouseEvent('click'))
		expect(get(image.state.marker)).toBe('area-1')
	})

	it('opens the configured marker for clickAction="markerId"', () => {
		const { el, image } = mountRaw(imageEmbed({ clickAction: 'markerId', clickTarget: 'm-9' }))
		containerOf(el)?.dispatchEvent(new MouseEvent('click'))
		expect(get(image.state.marker)).toBe('m-9')
	})

	it('wraps an href embed in an anchor and suppresses the marker', () => {
		const { el, image } = mountRaw(imageEmbed({ clickAction: 'href', clickTarget: '#target', clickTargetBlank: true }))
		const container = containerOf(el)
		expect(container?.tagName).toBe('A')
		expect(container?.getAttribute('href')).toBe('#target')
		expect(container?.getAttribute('target')).toBe('_blank')
		// keydown, not click: a synthetic click on a real <a> navigates the test page.
		container?.dispatchEvent(new KeyboardEvent('keydown'))
		expect(get(image.state.marker)).toBeUndefined()
	})

	it('lets a content embed without an interaction hook swallow nothing', () => {
		const { el, image } = mountRaw(imageEmbed())
		containerOf(el)?.dispatchEvent(new MouseEvent('click'))
		expect(get(image.state.marker)).toBeUndefined()
	})

	it('detaches the overlay click handler on destroy', () => {
		const { el, image } = mountRaw(imageEmbed(), {}, marker('area-1'))
		const container = containerOf(el) as HTMLElement
		el.remove()
		container.dispatchEvent(new MouseEvent('click'))
		expect(get(image.state.marker)).toBeUndefined()
	})

	it('keeps a single overlay when the element is re-connected', () => {
		const { el } = mountRaw(imageEmbed())
		el.remove()
		host.el.append(el)
		expect(el.querySelectorAll(':scope > div, :scope > a')).toHaveLength(1)
		expect(el.querySelectorAll('img')).toHaveLength(1)
	})
})

describe('2D placement', () => {
	it('positions the overlay from the view/viewport pair', () => {
		const image = fakeImage()
		image.state.view.set([0, 0, 1, 1])
		image._viewport.set([0, 0, 800, 600])
		const el = mountOn(image, imageEmbed())
		expect(cssVar(el, '--x')).toBe('300px')
		expect(cssVar(el, '--y')).toBe('225px')
		expect(cssVar(el, '--s')).toBe('1.5625')
	})

	it('falls back to the camera coordinate transform without a usable view', () => {
		const image = fakeImage()
		image.camera._getXYDirect.mockReturnValue([11, 22, 3])
		const el = mountOn(image, imageEmbed())
		expect(cssVar(el, '--x')).toBe('11px')
		expect(cssVar(el, '--y')).toBe('22px')
		expect(cssVar(el, '--s')).toBe('3')
	})

	it('does not rewrite an unchanged placement', () => {
		const image = fakeImage()
		image.state.view.set([0, 0, 1, 1])
		image._viewport.set([0, 0, 800, 600])
		const el = mountOn(image, imageEmbed())
		const setProperty = vi.spyOn((containerOf(el) as HTMLElement).style, 'setProperty')
		image.state.view.set([0, 0, 1, 1])
		expect(setProperty).not.toHaveBeenCalled()
	})

	it('never writes placement while the engine is not ready', () => {
		const image = fakeImage()
		image.engine.ready = false
		const el = mountOn(image, imageEmbed())
		expect(cssVar(el, '--x')).toBe('')
		expect(containerOf(el)?.style.transform).toBe('')
	})

	it('applies the initial grid-inactive state at mount', () => {
		const focused = writable<MicrioImage | undefined>(fakeImage() as unknown as MicrioImage)
		const shown = writable<MicrioImage[]>([])
		const image = fakeImage({ grid: { _focussed: focused, _markersShown: shown } })
		const el = mountOn(image, imageEmbed())
		// Applied after #buildDOM, even though the stores emit before it exists.
		expect(containerOf(el)?.classList.contains('inactive')).toBe(true)
		shown.set([image as unknown as MicrioImage])
		expect(containerOf(el)?.classList.contains('inactive')).toBe(false)
		focused.set(undefined)
		shown.set([])
		expect(containerOf(el)?.classList.contains('inactive')).toBe(false)
	})
})

describe('change event', () => {
	it('merges the detail and re-applies the position immediately', () => {
		const { el } = mountRaw(imageEmbed())
		dispatchChange(el, { opacity: 0.5 })
		expect(cssVar(el, '--opacity')).toBe('0.5')
	})

	it('tolerates a change event without a usable detail', () => {
		const { el } = mountRaw(imageEmbed())
		const setProperty = vi.spyOn((containerOf(el) as HTMLElement).style, 'setProperty')
		dispatchChange(el)
		expect(setProperty).not.toHaveBeenCalled()
	})

	it('resizes and repositions the content it wraps', () => {
		const image = fakeImage()
		image.state.view.set([0, 0, 1, 1])
		image._viewport.set([0, 0, 800, 600])
		const el = mountOn(image, embed())
		const button = contentOf(el) as HTMLElement
		expect(button.style.getPropertyValue('--scale')).toBe('1.28')
		dispatchChange(el, { area: [0.5, 0.5, 0.5, 0.5] })
		// Both the overlay centre and the wrapped content follow the new area.
		expect(cssVar(el, '--x')).toBe('600px')
		expect(button.style.getPropertyValue('--scale')).toBe('2.56')
	})

	it('resizes an iframe embed', () => {
		const { el } = mountRaw(frameEmbed())
		const iframe = contentOf(el)
		expect(iframe?.getAttribute('width')).toBe('128')
		dispatchChange(el, { area: [0.5, 0.5, 0.5, 0.5] })
		expect(iframe?.getAttribute('width')).toBe('256')
		expect(iframe?.getAttribute('height')).toBe('256')
	})

	it('resizes an HTML video embed', () => {
		const { el } = mountRaw(videoEmbed({}, { controls: true }))
		const video = el.querySelector('video')
		expect(video?.getAttribute('width')).toBe('128')
		dispatchChange(el, { area: [0.5, 0.5, 0.5, 0.5] })
		expect(video?.getAttribute('width')).toBe('256')
		expect(video?.getAttribute('height')).toBe('144')
	})

	it('repositions a WebGL embed through its camera', () => {
		const { el, image } = mountRaw(glEmbed({ uuid: 'u1' }))
		const gl = image._embeds[0]
		dispatchChange(el, { area: [0.5, 0.5, 0.2, 0.2], rotY: 0.5 })
		expect(gl.camera.setArea).toHaveBeenCalledWith([0.5, 0.5, 0.2, 0.2])
		expect(gl.camera.setRotation).toHaveBeenCalledWith(0, 0.5, 0)
	})
})

describe('pause-on-zoom', () => {
	it('pauses a video embed that is smaller than its threshold', () => {
		const image = primeScreen()
		const el = mountOn(image, videoEmbed({}, { controls: true, pauseWhenSmallerThan: 100 }))
		expect(el.querySelector('figure')?.classList.contains('paused')).toBe(true)
	})

	it('pauses a video embed that is larger than its threshold', () => {
		const image = primeScreen()
		const el = mountOn(image, videoEmbed({}, { controls: true, pauseWhenLargerThan: 0.001 }))
		expect(el.querySelector('figure')?.classList.contains('paused')).toBe(true)
	})

	it('resumes and restarts a hidden video when it is shown again', () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
		const setCurrentTime = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
		const image = primeScreen()
		image.$settings.embedRestartWhenShown = true
		mountOn(image, videoEmbed({}, { controls: true, pauseWhenSmallerThan: 0.001 }))
		expect(play).toHaveBeenCalled()
		expect(setCurrentTime).toHaveBeenCalledWith(0)
	})

	it('does not pause on an un-hooked 0x0 host viewport', () => {
		// canvas.viewport is 0x0 until the element is resized; the screen size stays
		// 0 instead of becoming Infinity, so no threshold is crossed.
		host.el.canvas.viewport.width = 0
		host.el.canvas.viewport.height = 0
		const { el } = mountRaw(videoEmbed({}, { controls: true, pauseWhenLargerThan: 1e9 }))
		expect(el.querySelector('figure')?.classList.contains('paused')).toBe(false)
	})
})

describe('HTML video edge cases', () => {
	it('keeps a controlled video overlay interactive', () => {
		const { el } = mountRaw(videoEmbed({}, { controls: true }))
		// No `.no-events`: pointer-events stay auto so the native controls work.
		expect(hasNoEvents(el)).toBe(false)
		expect(el.querySelector('video')?.hasAttribute('controls')).toBe(true)
	})

	it('still lets pan/zoom through a controls-less video overlay', () => {
		Browser.OSX = false
		stubHdr(false)
		const { el } = mountRaw(videoEmbed({}, { autoplay: false }))
		// Rendered as HTML (non-HDR fallback) but with nothing to click.
		expect(el.querySelector('video')).not.toBeNull()
		expect(hasNoEvents(el)).toBe(true)
	})

	it('adds the hide-when-paused class to an HTML video overlay', () => {
		const { el } = mountRaw(videoEmbed({ hideWhenPaused: true }, { controls: true }))
		expect(containerOf(el)?.classList.contains('hide-when-paused')).toBe(true)
	})

	it('stops the HTML video when the embed is destroyed', () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
		const { el } = mountRaw(videoEmbed({}, { controls: true, autoplay: true }))
		expect(play).toHaveBeenCalled()
		pause.mockClear()
		el.remove()
		// A detached media element would otherwise keep decoding and playing.
		expect(pause).toHaveBeenCalled()
	})
})
