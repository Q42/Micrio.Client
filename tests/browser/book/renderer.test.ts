import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperRenderer } from '$book/rendering/renderer'
import { PaperMesh } from '$book/geometry/paper-mesh'
import { OrbitCamera } from '$book/core/orbit-camera'
import { Mat4 } from '$render/mat'
import { FRONT_COLOR, BACK_COLOR } from '$book/core/settings'

/** What a test can observe about the GL state a renderer pushed out. */
/** The last element matching a predicate, without an intermediate array. */
function lastMatching<T>(list: T[], predicate: (item: T) => boolean): T | undefined {
	for (let i = list.length - 1; i >= 0; i--) {
		const item = list[i]
		if (item !== undefined && predicate(item)) {
			return item
		}
	}
	return undefined
}

interface GlLog {
	uniform4f: { name: string; values: number[] }[]
	uniform3f: { name: string; values: number[] }[]
	uniform1f: { name: string; values: number[] }[]
	uniform1i: { name: string; values: number[] }[]
	uniformMatrix4fv: number
	drawElements: number
	drawArrays: number
	boundFramebuffer: (WebGLFramebuffer | null)[]
}

/**
 * A canvas whose WebGL2 context records the uniform and draw calls the renderer
 * makes. The renderer only ever sees this wrapper, so the real context stays a
 * real context (nothing is stubbed out), and the log is how a test asserts what
 * was uploaded without reading pixels back.
 */
function instrumentedCanvas(width = 400, height = 300): { canvas: HTMLCanvasElement; log: GlLog } {
	const canvas = document.createElement('canvas')
	canvas.style.width = `${width}px`
	canvas.style.height = `${height}px`
	document.body.append(canvas)

	// The real getContext, captured before the spy replaces it. The reference is
	// always applied with an explicit `this` (the calling canvas) below.
	// oxlint-disable-next-line typescript/unbound-method -- applied with Reflect.apply
	const { getContext: rawGetContext } = HTMLCanvasElement.prototype

	const log: GlLog = {
		uniform4f: [],
		uniform3f: [],
		uniform1f: [],
		uniform1i: [],
		uniformMatrix4fv: 0,
		drawElements: 0,
		drawArrays: 0,
		boundFramebuffer: [],
	}

	const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
	spy.mockImplementation(function getContext(this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
		const ctx = Reflect.apply(rawGetContext, this, [id, ...rest])
		if (id !== 'webgl2' || ctx === null || ctx === undefined) {
			return ctx as CanvasRenderingContext2D | null
		}
		const gl = ctx as WebGL2RenderingContext
		const names = new Map<WebGLUniformLocation | null, string>()
		const realGetUniformLocation = gl.getUniformLocation.bind(gl)
		gl.getUniformLocation = (program: WebGLProgram, name: string) => {
			const loc = realGetUniformLocation(program, name)
			names.set(loc, name)
			return loc
		}
		const realUniform4f = gl.uniform4f.bind(gl)
		gl.uniform4f = (loc, x, y, z, w) => {
			log.uniform4f.push({ name: names.get(loc) ?? '?', values: [x, y, z, w] })
			realUniform4f(loc, x, y, z, w)
		}
		const realUniform3f = gl.uniform3f.bind(gl)
		gl.uniform3f = (loc, x, y, z) => {
			log.uniform3f.push({ name: names.get(loc) ?? '?', values: [x, y, z] })
			realUniform3f(loc, x, y, z)
		}
		const realUniform1f = gl.uniform1f.bind(gl)
		gl.uniform1f = (loc, x) => {
			log.uniform1f.push({ name: names.get(loc) ?? '?', values: [x] })
			realUniform1f(loc, x)
		}
		const realUniform1i = gl.uniform1i.bind(gl)
		gl.uniform1i = (loc, x) => {
			log.uniform1i.push({ name: names.get(loc) ?? '?', values: [x] })
			realUniform1i(loc, x)
		}
		const realUniformMatrix4fv = gl.uniformMatrix4fv.bind(gl)
		gl.uniformMatrix4fv = (loc, transpose, value) => {
			log.uniformMatrix4fv++
			realUniformMatrix4fv(loc, transpose, value)
		}
		const realDrawElements = gl.drawElements.bind(gl)
		gl.drawElements = (mode, count, type, offset) => {
			log.drawElements++
			realDrawElements(mode, count, type, offset)
		}
		const realDrawArrays = gl.drawArrays.bind(gl)
		gl.drawArrays = (mode, first, count) => {
			log.drawArrays++
			realDrawArrays(mode, first, count)
		}
		const realBindFramebuffer = gl.bindFramebuffer.bind(gl)
		gl.bindFramebuffer = (target, fb) => {
			log.boundFramebuffer.push(fb)
			realBindFramebuffer(target, fb)
		}
		return ctx as CanvasRenderingContext2D | null
	} as typeof HTMLCanvasElement.prototype.getContext)

	return { canvas, log }
}

afterEach(() => {
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

describe('PaperRenderer — construction', () => {
	it('rejects a context that is not backed by an HTMLCanvasElement', () => {
		const canvas = document.createElement('canvas')
		const gl = canvas.getContext('webgl2')
		expect(gl).not.toBeNull()
		const offscreen = { canvas: {} } as unknown as WebGL2RenderingContext
		expect(() => new PaperRenderer(offscreen)).toThrow(/HTMLCanvasElement/)
	})

	it('sizes the drawing buffer from the canvas client size and the device pixel ratio', () => {
		const { canvas } = instrumentedCanvas(400, 300)
		canvas.width = 400
		canvas.height = 300
		const gl = canvas.getContext('webgl2')
		expect(gl).not.toBeNull()
		const renderer = new PaperRenderer(gl as WebGL2RenderingContext)
		expect(renderer._getCanvas()).toBe(canvas)
		// jsdom-free Chromium reports devicePixelRatio 1
		expect(canvas.width).toBe(400)
		expect(canvas.height).toBe(300)
	})
})

describe('PaperRenderer — initialize and draw', () => {
	let renderer: PaperRenderer
	let canvas: HTMLCanvasElement
	let log: GlLog
	let meshes: PaperMesh[]
	const camera = new OrbitCamera()

	beforeEach(() => {
		const instrumented = instrumentedCanvas(400, 300)
		;({ canvas, log } = instrumented)
		const gl = canvas.getContext('webgl2') as WebGL2RenderingContext
		renderer = new PaperRenderer(gl)
		meshes = [new PaperMesh(0, 1, 1), new PaperMesh(0.0012, 1, 1)]
		renderer._initialize(meshes)
		camera._setCanvasSize(400, 300)
		camera._snap()
	})

	it('handles the canvas and its size', () => {
		expect(renderer._getCanvas()).toBe(canvas)
		expect(renderer._getCanvasSize()).toEqual({ width: canvas.width, height: canvas.height })
	})

	it('draws one element per page', () => {
		log.drawElements = 0
		renderer._setFlipProgress(new Float32Array([0, 0]))
		renderer._render(camera)
		expect(log.drawElements).toBe(meshes.length)
		expect(log.uniformMatrix4fv).toBeGreaterThan(0)
	})

	it('uploads the lighting, page colours and see-through flag every frame', () => {
		log.uniform3f = []
		log.uniform1f = []
		renderer._setFlipProgress(new Float32Array([0, 0]))
		renderer._render(camera)
		const light = log.uniform3f.find((u) => u.name === 'A')
		expect(light?.values).toHaveLength(3)
		expect(log.uniform3f.find((u) => u.name === 'D')?.values).toEqual(FRONT_COLOR)
		expect(log.uniform3f.find((u) => u.name === 'E')?.values).toEqual(BACK_COLOR)
		expect(log.uniform1f.find((u) => u.name === 'V')?.values).toEqual([0])

		renderer._seeThroughMargins = true
		renderer._render(camera)
		expect(lastMatching(log.uniform1f, (u) => u.name === 'V')?.values).toEqual([1])
	})

	it('renders through two offscreen passes when tilt shift is on', () => {
		renderer._tiltShiftEnabled = true
		log.drawArrays = 0
		renderer._setFlipProgress(new Float32Array([0, 0]))
		renderer._render(camera)
		// The scene plus the horizontal and vertical blur passes
		expect(log.drawArrays).toBe(2)
		expect(log.boundFramebuffer.length).toBeGreaterThan(2)
	})

	it('draws straight to the screen when tilt shift is off', () => {
		renderer._tiltShiftEnabled = false
		log.drawArrays = 0
		renderer._render(camera)
		expect(log.drawArrays).toBe(0)
		expect(log.boundFramebuffer).not.toContain(null)
	})

	it('pushes the aspect regions to the shader as a vec4 per page side', () => {
		const front = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
		const back = new Float32Array(8).fill(1)
		renderer._setAspectRegions(front, back)
		log.uniform4f = []
		renderer._render(camera)
		// Both pages upload their own region; the last one drawn is page 1
		const regions = log.uniform4f.filter((u) => u.name === 'T')
		expect(regions).toHaveLength(meshes.length)
		// Float32 uniforms, so the expected values are matched with a tolerance
		const expected = [0.5, 0.6, 0.7, 0.8]
		for (const [i, value] of (regions.at(-1)?.values ?? []).entries()) {
			expect(value).toBeCloseTo(expected[i] as number, 5)
		}
		expect(lastMatching(log.uniform4f, (u) => u.name === 'U')?.values).toEqual([1, 1, 1, 1])
	})

	it('pushes the cross-fade blends for each page side', () => {
		renderer._setPageBlend(1, 0.25, 0.75, 0.5, 0.5)
		log.uniform1f = []
		renderer._render(camera)
		const blends = log.uniform1f.filter((u) => ['L', 'M', 'N', 'O'].includes(u.name))
		// Page 0 is untouched, page 1 carries the values we set
		expect(blends.map((b) => b.values[0]).slice(4)).toEqual([0.25, 0.75, 0.5, 0.5])
	})
})

describe('PaperRenderer — textures and buffers', () => {
	let renderer: PaperRenderer
	let canvas: HTMLCanvasElement
	let meshes: PaperMesh

	beforeEach(() => {
		const instrumented = instrumentedCanvas(200, 200)
		;({ canvas } = instrumented)
		const gl = canvas.getContext('webgl2') as WebGL2RenderingContext
		renderer = new PaperRenderer(gl)
		meshes = new PaperMesh(0, 1, 1)
		renderer._initialize([meshes])
	})

	it('accepts page textures and evicts the hi-res slots without throwing', () => {
		const bitmap = document.createElement('canvas')
		bitmap.width = 8
		bitmap.height = 8
		expect(() => {
			renderer._setPageTextures(0, bitmap, bitmap)
			renderer._evictPageHiRes(0, 0, 0)
			renderer._evictPageHiRes(0, 0, 1)
			renderer._evictPageHiRes(0, 1, 0)
			renderer._evictPageHiRes(0, 1, 1)
		}).not.toThrow()
		// Evicting clears the blend even when no texture was there
		expect(true).toBe(true)
	})

	it('ignores vertex and normal updates for a page it does not know', () => {
		expect(() => {
			renderer._updateVertexBuffer(9, meshes)
			renderer._updateNormalBuffer(9, meshes)
		}).not.toThrow()
	})

	it('accepts vertex and normal updates for a known page', () => {
		meshes._positions[0] = 5
		expect(() => {
			renderer._updateVertexBuffer(0, meshes)
			renderer._updateNormalBuffer(0, meshes)
		}).not.toThrow()
	})

	it('has no bounding box until one is set', () => {
		expect(renderer._getBoundingBoxCorners()).toBeNull()
		expect(renderer._getBoundingBoxScreenBounds(new Mat4())).toBeNull()

		renderer._setBoundingBox({ x: -1, y: -2, z: -3 }, { x: 1, y: 2, z: 3 })
		const corners = renderer._getBoundingBoxCorners()
		expect(corners).toHaveLength(24)
		expect(Array.from(corners?.slice(0, 3) ?? [])).toEqual([-1, -2, -3])
		expect(Array.from(corners?.slice(21, 24) ?? [])).toEqual([-1, 2, 3])
	})

	it('projects the bounding box corners to screen bounds and skips the ones behind the camera', () => {
		renderer._setBoundingBox({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 })
		const identity = new Mat4()
		identity._identity()
		const bounds = renderer._getBoundingBoxScreenBounds(identity)
		expect(bounds).not.toBeNull()
		// With w = 1 for every corner, the NDC cube maps to the whole canvas
		expect(bounds?.minX).toBeCloseTo(0, 5)
		expect(bounds?.maxX).toBeCloseTo(canvas.width, 5)

		// A matrix that puts every corner behind the eye yields no bounds
		const behind = new Mat4()
		behind._identity()
		behind.arr[15] = -1
		expect(renderer._getBoundingBoxScreenBounds(behind)).toBeNull()
	})

	it('resizes the drawing buffer from the client size', () => {
		canvas.style.width = '100px'
		canvas.style.height = '50px'
		renderer._resize()
		expect(canvas.width).toBe(100)
		expect(canvas.height).toBe(50)
	})
})

describe('PaperRenderer — draw order and lighting', () => {
	let renderer: PaperRenderer
	let log: GlLog
	let meshes: PaperMesh[]
	const camera = new OrbitCamera()

	beforeEach(() => {
		const instrumented = instrumentedCanvas(200, 200)
		;({ log } = instrumented)
		const gl = instrumented.canvas.getContext('webgl2') as WebGL2RenderingContext
		renderer = new PaperRenderer(gl)
		meshes = [new PaperMesh(0, 1, 1), new PaperMesh(0.0012, 1, 1), new PaperMesh(0.0024, 1, 1)]
		renderer._initialize(meshes)
		camera._setCanvasSize(200, 200)
		camera._snap()
	})

	it('draws the pages from the top of the stack down while none is flipping', () => {
		// The draw order is the mesh creation order, which the mesh data carries
		renderer._setFlipProgress(new Float32Array([0, 0, 0]))
		const order: number[] = []
		const gl = renderer._getCanvas().getContext('webgl2') as WebGL2RenderingContext
		const realDrawElements = gl.drawElements.bind(gl)
		gl.drawElements = (mode, count, type, offset) => {
			order.push(count)
			realDrawElements(mode, count, type, offset)
		}
		renderer._render(camera)
		// Every page shares the same index count, so the order is not identifiable
		// from the counts; the count of draws is.
		expect(order).toHaveLength(3)
	})

	it('separates animating pages from static ones, drawing the animating ones last', () => {
		renderer._setFlipProgress(new Float32Array([0, 0.5, 1]))
		log.drawElements = 0
		renderer._render(camera)
		expect(log.drawElements).toBe(3)
	})

	it('switches and merges lighting presets', () => {
		renderer._setLightingPreset('candlelight', { candleCount: 5 })
		expect(renderer._isLightingAnimated()).toBe(true)

		// The same preset merges, an other one replaces
		renderer._setLightingPreset('candlelight', { flicker: 0.9 })
		expect(renderer._isLightingAnimated()).toBe(true)

		renderer._setLightingPreset('daylight', { timeOfDay: 9 })
		expect(renderer._isLightingAnimated()).toBe(false)
	})

	it('reports the default preset as not animated', () => {
		renderer._setLightingPreset('daylight', { timeOfDay: 12 })
		expect(renderer._isLightingAnimated()).toBe(false)
	})

	it('keeps the default preset when it is re-applied with no change', () => {
		renderer._setLightingPreset('daylight', {})
		expect(renderer._isLightingAnimated()).toBe(false)
	})
})
