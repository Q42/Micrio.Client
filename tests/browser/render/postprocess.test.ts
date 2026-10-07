import { describe, expect, it, vi } from 'vitest'
import { PostProcessor } from '$render/postprocess'
import { ErrorCodes, MicrioError } from '$core/error'
import type { HTMLMicrioElement } from '$core/element'
import type { WebGL } from '$render/webgl'

/**
 * The one render suite that needs **no viewer and no `<micr-io>` GL context**.
 *
 * `PostProcessor` takes a WebGL context as a plain argument, so it can be exercised against a
 * throwaway `<canvas>` at 64x64. That keeps this file off Chromium's context budget entirely:
 * the id-less `<micr-io>` below never runs `#print()`, so its own `_webgl.gl` stays `null` and
 * is used only for its pure `_getShader` compiler.
 *
 * `webgl.ts`'s own init/frame/watermark paths are covered in `canvas.test.ts` (a real viewer);
 * what is asserted here is the postprocessor contract and its OOM/link failure paths.
 */

/** A valid fullscreen pass. `u_time` is sampled per pixel so the optimiser cannot drop it. */
const SHADER = `precision mediump float;
varying vec2 v_texCoord;
uniform float u_time;
void main() {
	gl_FragColor = vec4(v_texCoord, 0.5 + 0.5 * sin(u_time), 1.0);
}`

/** A shader that cannot compile, for the link-error path. */
const BROKEN_SHADER = `precision mediump float;
varying vec2 v_texCoord;
void main() { gl_FragColor = vec4(notAThing, 0.0, 0.0, 1.0); }`

/**
 * `PostProcessor` gets its context through the element's own WebGL controller rather than a
 * throwaway canvas: `_getShader` (which the constructor calls) reads `_webgl.gl` and throws
 * "WebGL context is not initialized" when it is null, so a private context would not exercise
 * the real code path. Creating the context on the *element's* canvas also means the element can
 * be reused for every test in the file — one GL context for the whole suite.
 */
function makeGl(): { gl: WebGL2RenderingContext; micrio: HTMLMicrioElement } {
	const micrio = document.createElement('micr-io') as HTMLMicrioElement
	micrio.setAttribute('style', 'width: 64px; height: 64px; display: block;')
	document.body.append(micrio)

	micrio._webgl._init()
	const { gl } = micrio._webgl
	if (!(gl instanceof WebGL2RenderingContext)) {
		throw new Error('headless Chromium did not hand out a webgl2 context')
	}
	return { gl, micrio }
}

/** Forces every `new Image()` to report the given natural size and load immediately. */
function stubImageLoad(): () => void {
	const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
	Object.defineProperty(HTMLImageElement.prototype, 'src', {
		configurable: true,
		set(value: string) {
			void value
			Object.defineProperty(this, 'naturalWidth', { configurable: true, value: 32 })
			Object.defineProperty(this, 'naturalHeight', { configurable: true, value: 16 })
			queueMicrotask(() => this.dispatchEvent(new Event('load')))
		},
		get() {
			return ''
		},
	})
	return () => {
		if (original) {
			Object.defineProperty(HTMLImageElement.prototype, 'src', original)
		} else {
			delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)['src']
		}
	}
}

/** Runs `fn` and returns the `MicrioError` code it threw, or fails loudly if it did not throw. */
function errorCodeOf(fn: () => unknown): string | undefined {
	try {
		fn()
	} catch (error) {
		return error instanceof MicrioError ? error.code : undefined
	}
	throw new Error('expected the call to throw')
}

/** Removes the element (and with it the GL context) a test created. */
function release(micrio: HTMLMicrioElement): void {
	micrio._webgl._dispose(true)
	micrio.remove()
}

describe('PostProcessor', () => {
	it('builds a complete framebuffer, texture, quad buffer and program', () => {
		const { gl, micrio } = makeGl()
		const post = new PostProcessor(gl, micrio, SHADER)

		expect(post._frameBuffer).toBeInstanceOf(WebGLFramebuffer)
		expect(gl.isFramebuffer(post._frameBuffer)).toBe(true)
		// A constructor that returns at all means `checkFramebufferStatus` was complete: an
		// incomplete attachment is a thrown Error, not a silently broken instance.
		expect(gl.getError()).toBe(gl.NO_ERROR)

		post._dispose()
		release(micrio)
	})

	it('renders the fullscreen quad to the default framebuffer', () => {
		const { gl, micrio } = makeGl()
		const post = new PostProcessor(gl, micrio, SHADER)

		const bindFramebuffer = vi.spyOn(gl, 'bindFramebuffer')
		const drawArrays = vi.spyOn(gl, 'drawArrays')

		post._render()

		// `_render` switches back to the screen framebuffer before drawing, otherwise the
		// postprocess pass would render into its own input texture.
		expect(bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, null)
		expect(drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
		expect(gl.getError()).toBe(gl.NO_ERROR)

		bindFramebuffer.mockRestore()
		drawArrays.mockRestore()
		post._dispose()
		release(micrio)
	})

	it('reallocates the framebuffer texture at the drawing buffer size on resize', () => {
		const { gl, micrio } = makeGl()
		const post = new PostProcessor(gl, micrio, SHADER)

		const texImage2D = vi.spyOn(gl, 'texImage2D')
		post._resize()
		expect(texImage2D).toHaveBeenCalled()
		// Recreated at the *current* drawing buffer dimensions
		const call = texImage2D.mock.calls.at(-1)
		expect(call?.[3]).toBe(gl.drawingBufferWidth)
		expect(call?.[4]).toBe(gl.drawingBufferHeight)
		expect(gl.getError()).toBe(gl.NO_ERROR)

		texImage2D.mockRestore()
		post._dispose()
		release(micrio)
	})

	it('_dispose releases every GL object it created', () => {
		const { gl, micrio } = makeGl()
		const post = new PostProcessor(gl, micrio, SHADER)
		const fb = post._frameBuffer

		const deleteFramebuffer = vi.spyOn(gl, 'deleteFramebuffer')
		const deleteTexture = vi.spyOn(gl, 'deleteTexture')
		const deleteBuffer = vi.spyOn(gl, 'deleteBuffer')
		const deleteProgram = vi.spyOn(gl, 'deleteProgram')

		post._dispose()

		expect(deleteFramebuffer).toHaveBeenCalledTimes(1)
		expect(deleteTexture).toHaveBeenCalledTimes(1)
		expect(deleteBuffer).toHaveBeenCalledTimes(1)
		expect(deleteProgram).toHaveBeenCalledTimes(1)
		// Deleting is what flips the WebGL bookkeeping; the object handle is just an id
		expect(gl.isFramebuffer(fb)).toBe(false)

		deleteFramebuffer.mockRestore()
		deleteTexture.mockRestore()
		deleteBuffer.mockRestore()
		deleteProgram.mockRestore()
		release(micrio)
	})

	it('throws an out-of-memory MicrioError when the program cannot be created', () => {
		const { gl, micrio } = makeGl()
		vi.spyOn(gl, 'createProgram').mockReturnValue(null as unknown as WebGLProgram)
		expect(() => new PostProcessor(gl, micrio, SHADER)).toThrowError(MicrioError)
		expect(errorCodeOf(() => new PostProcessor(gl, micrio, SHADER))).toBe(ErrorCodes.WEBGL_OUT_OF_MEMORY)
		vi.restoreAllMocks()
	})

	it('throws an out-of-memory MicrioError when the texture cannot be created', () => {
		const { gl, micrio } = makeGl()
		vi.spyOn(gl, 'createTexture').mockReturnValue(null as unknown as WebGLTexture)
		expect(errorCodeOf(() => new PostProcessor(gl, micrio, SHADER))).toBe(ErrorCodes.WEBGL_OUT_OF_MEMORY)
		vi.restoreAllMocks()
	})

	it('throws an out-of-memory MicrioError when the framebuffer cannot be created', () => {
		const { gl, micrio } = makeGl()
		vi.spyOn(gl, 'createFramebuffer').mockReturnValue(null as unknown as WebGLFramebuffer)
		expect(errorCodeOf(() => new PostProcessor(gl, micrio, SHADER))).toBe(ErrorCodes.WEBGL_OUT_OF_MEMORY)
		vi.restoreAllMocks()
	})

	it('throws an out-of-memory MicrioError when the quad buffer cannot be created', () => {
		const { gl, micrio } = makeGl()
		vi.spyOn(gl, 'createBuffer').mockReturnValue(null as unknown as WebGLBuffer)
		expect(errorCodeOf(() => new PostProcessor(gl, micrio, SHADER))).toBe(ErrorCodes.WEBGL_OUT_OF_MEMORY)
		vi.restoreAllMocks()
	})

	it('logs a link failure instead of throwing', () => {
		const { gl, micrio } = makeGl()
		// A failing link is tolerated (there is a TODO in the source): the constructor must
		// still produce a usable instance, and it must say so on the console.
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(gl, 'getProgramParameter').mockReturnValue(false)

		const post = new PostProcessor(gl, micrio, SHADER)
		expect(error).toHaveBeenCalledWith('Postprocess shader link error:', expect.anything())

		error.mockRestore()
		vi.restoreAllMocks()
		post._dispose()
		release(micrio)
	})

	it('surfaces a compile failure through the shared WebGL shader compiler', () => {
		const { gl, micrio } = makeGl()
		// `_getShader` is the element's own compiler, so a bad fragment shader surfaces as its
		// MicrioError rather than a silently broken program.
		expect(errorCodeOf(() => new PostProcessor(gl, micrio, BROKEN_SHADER))).toBe(ErrorCodes.WEBGL_SHADER_COMPILE)
	})

	it('throws when the framebuffer does not come out complete', () => {
		const { gl, micrio } = makeGl()
		vi.spyOn(gl, 'checkFramebufferStatus').mockReturnValue(gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT)
		expect(() => new PostProcessor(gl, micrio, SHADER)).toThrowError('Framebuffer not complete')
		vi.restoreAllMocks()
	})
})

/**
 * `WebGL._loadWatermark` / `#drawWatermark` are driven straight on `micrio._webgl` against the
 * same throwaway element. The watermark load is asynchronous (`img.onload`), so each test stubs
 * `Image.prototype.src` to fire the load synchronously and then dispatches once.
 */
describe('WebGL watermark', () => {
	it('ignores a watermark request before the GL context exists', () => {
		const micrio = document.createElement('micr-io') as HTMLMicrioElement
		document.body.append(micrio)
		// `_init()` was never called, so asking for a watermark must be a silent no-op rather
		// than a crash on a null context.
		expect(micrio._webgl.gl).toBeNull()
		expect(() => {
			micrio._webgl._loadWatermark('https://example.test/wm.svg')
		}).not.toThrow()
		micrio.remove()
	})

	it('loads the watermark once and draws it on _drawEnd', async () => {
		const restore = stubImageLoad()
		const { gl, micrio } = makeGl()
		const webgl = micrio._webgl as WebGL

		// `wmOpacity` only takes effect when it is truthy, so 0.5 exercises the branch.
		webgl._loadWatermark('https://example.test/wm.svg', 0.5)
		// Two microtask turns: one for the stubbed `src` to dispatch `load`, one for the
		// `.then` that creates the canvas texture.
		await Promise.resolve()
		await Promise.resolve()

		const drawArrays = vi.spyOn(gl, 'drawArrays')
		webgl._drawEnd()
		// One draw: the watermark quad, and nothing else (there is no postprocessor)
		expect(drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6)

		drawArrays.mockRestore()
		restore()
		release(micrio)
	})

	it('still fetches a watermark requested before the GL context exists', () => {
		// What the element does on every load: it builds the image (and so asks for the
		// watermark) *before* it creates the canvas and its context. Requesting the texture
		// only when a context happened to exist meant the image was never fetched at all.
		const srcs: string[] = []
		const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
		Object.defineProperty(HTMLImageElement.prototype, 'src', {
			configurable: true,
			set(value: string) {
				srcs.push(value)
			},
			get() {
				return srcs[srcs.length - 1] ?? ''
			},
		})

		const micrio = document.createElement('micr-io') as HTMLMicrioElement
		document.body.append(micrio)
		expect(micrio._webgl.gl).toBeNull()
		micrio._webgl._loadWatermark('https://example.test/wm.png')
		expect(srcs).toEqual(['https://example.test/wm.png'])

		if (original) {
			Object.defineProperty(HTMLImageElement.prototype, 'src', original)
		}
		micrio.remove()
	})

	it('uploads and draws a watermark that arrived before init', async () => {
		const restore = stubImageLoad()
		const micrio = document.createElement('micr-io') as HTMLMicrioElement
		micrio.setAttribute('style', 'width: 64px; height: 64px; display: block;')
		document.body.append(micrio)
		const webgl = micrio._webgl as WebGL

		// Requested with no context (as the image constructor does), loaded, and only then
		// does the context come up
		webgl._loadWatermark('https://example.test/wm.png')
		await Promise.resolve()
		await Promise.resolve()
		micrio._webgl._init()
		const { gl } = micrio._webgl
		if (!(gl instanceof WebGL2RenderingContext)) {
			throw new Error('headless Chromium did not hand out a webgl2 context')
		}

		const drawArrays = vi.spyOn(gl, 'drawArrays')
		webgl._drawEnd()
		expect(drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6)

		drawArrays.mockRestore()
		restore()
		release(micrio)
	})

	it('does not reload a watermark for the same URL', async () => {
		const restore = stubImageLoad()
		const { micrio } = makeGl()
		const webgl = micrio._webgl as WebGL

		const getTexture = vi.spyOn(webgl, '_getTexture')
		webgl._loadWatermark('https://example.test/wm.svg')
		await Promise.resolve()
		await Promise.resolve()
		expect(getTexture).toHaveBeenCalledTimes(1)

		// Second call with the same URL is a no-op: the image is already loaded/loading
		webgl._loadWatermark('https://example.test/wm.svg')
		await Promise.resolve()
		expect(getTexture).toHaveBeenCalledTimes(1)

		getTexture.mockRestore()
		restore()
		release(micrio)
	})
})
