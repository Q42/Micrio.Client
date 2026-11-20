import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { HTMLMicrioElement } from '$core/element'

/**
 * The WebGL side of the hybrid SOG overlay: the screen-space alpha mask and the
 * texture refresh the overlay uses.
 *
 * These are four small `@internal` methods, so the suite keeps one GL context for
 * the whole file (a detached `<micr-io>`, never printed) and asserts the uniforms
 * that end up on the program rather than pixels — the mask is what the photo shader
 * samples, so the enabled flag, the mask unit and the drawing-buffer size are the
 * contract. The upload itself is visible as the texture bound on unit 1.
 */

let micrio: HTMLMicrioElement

beforeAll(() => {
	micrio = document.createElement('micr-io') as HTMLMicrioElement
	micrio.setAttribute('style', 'width: 64px; height: 64px; display: block;')
	micrio._webgl._init()
})

afterAll(() => {
	micrio._webgl._dispose(true)
})

function gl(): WebGL2RenderingContext {
	const context = micrio._webgl.gl
	if (!(context instanceof WebGL2RenderingContext)) {
		throw new Error('no webgl2 context')
	}
	return context
}

function currentProgram(): { gl: WebGL2RenderingContext; program: WebGLProgram } {
	const context = gl()
	const program = context.getParameter(context.CURRENT_PROGRAM)
	if (!(program instanceof WebGLProgram)) {
		throw new Error('no current program')
	}
	return { gl: context, program }
}

function uniform(name: string): unknown {
	const { gl: context, program } = currentProgram()
	const location = context.getUniformLocation(program, name)
	if (!location) {
		throw new Error(`no ${name} uniform`)
	}
	return context.getUniform(program, location)
}

function paintedCanvas(): HTMLCanvasElement {
	const canvas = document.createElement('canvas')
	canvas.width = 4
	canvas.height = 4
	const context = canvas.getContext('2d')
	if (!context) {
		throw new Error('no 2d context')
	}
	context.fillStyle = '#fff'
	context.fillRect(0, 0, 4, 4)
	return canvas
}

describe('WebGL alpha mask', () => {
	it('uploads the mask and enables it on the next draw', () => {
		const source = paintedCanvas()
		micrio._webgl._setMask(source)
		micrio._webgl._setMaskEnabled(true)
		micrio._webgl._drawStart()

		expect(uniform('maskEnabled')).toBe(1)
		expect(uniform('uMask')).toBe(1)
		expect(Array.from(uniform('uMaskSize') as Float32Array)).toEqual([
			gl().drawingBufferWidth,
			gl().drawingBufferHeight,
		])

		// The source was uploaded into the mask unit, not the tile unit.
		gl().activeTexture(gl().TEXTURE1)
		expect(gl().getParameter(gl().TEXTURE_BINDING_2D)).toBeInstanceOf(WebGLTexture)
		gl().activeTexture(gl().TEXTURE0)
		expect(gl().getError()).toBe(gl().NO_ERROR)
	})

	it('turns the mask off again for the next draw', () => {
		micrio._webgl._setMaskEnabled(false)
		micrio._webgl._drawStart()

		expect(uniform('maskEnabled')).toBe(0)
		expect(gl().getError()).toBe(gl().NO_ERROR)
	})

	it('enables a blank mask when no source has been set', () => {
		micrio._webgl._setMask()
		micrio._webgl._setMaskEnabled(true)
		micrio._webgl._drawStart()

		expect(uniform('maskEnabled')).toBe(1)
		gl().activeTexture(gl().TEXTURE1)
		expect(gl().getParameter(gl().TEXTURE_BINDING_2D)).toBeInstanceOf(WebGLTexture)
		gl().activeTexture(gl().TEXTURE0)
		expect(gl().getError()).toBe(gl().NO_ERROR)
	})

	it('clears the visible buffer and refreshes a texture', () => {
		micrio._webgl._clear()
		expect(gl().getError()).toBe(gl().NO_ERROR)

		const texture = micrio._webgl._getTexture(paintedCanvas())
		micrio._webgl._updateTexture(texture, paintedCanvas())

		expect(gl().isTexture(texture)).toBe(true)
		expect(gl().getError()).toBe(gl().NO_ERROR)
	})
})
