import { PaperMesh } from '../geometry/paper-mesh';
import { Mat4 } from '../core/mat4';
import { OrbitCamera } from '../core/orbit-camera';
import {
	FRONT_COLOR, BACK_COLOR,
	TILT_SHIFT_ENABLED, TILT_SHIFT_FOCUS_CENTER, TILT_SHIFT_FOCUS_WIDTH,
	TILT_SHIFT_BLUR_RADIUS, TILT_SHIFT_BLUR_FALLOFF,
	PAGE_THICKNESS,
	LIGHTING_PRESET,
} from '../core/settings';
import { computeLighting, getPresets } from './lighting';
import { computeWeightFactor, computePageSpineY } from '../animation/spine-sync';
import { createGLProgram, setupTextureParams, createWhiteTexture } from './gl-utils';
import paperVertSrc from './shaders/paper.vert.glsl?raw';
import paperFragSrc from './shaders/paper.frag.glsl?raw';
import fullscreenVertSrc from './shaders/tilt-shift.vert.glsl?raw';
import blurHFragSrc from './shaders/blur-h.frag.glsl?raw';
import blurVFragSrc from './shaders/blur-v.frag.glsl?raw';
interface MeshData {
	_vao: WebGLVertexArrayObject;
	_positionVBO: WebGLBuffer;
	_normalVBO: WebGLBuffer;
	_texCoordVBO: WebGLBuffer;
	_indexEBO: WebGLBuffer;
	_indexCount: number;
	_pageIndex: number;
}

interface FboAttachments {
	_fbo: WebGLFramebuffer;
	_color: WebGLTexture;
	_depth: WebGLRenderbuffer | null;
}

interface PaperUniformLocations {
	_viewProj: WebGLUniformLocation | null;
	_lightDir: WebGLUniformLocation | null;
	_ambientColor: WebGLUniformLocation | null;
	_lightColor: WebGLUniformLocation | null;
	_frontColor: WebGLUniformLocation | null;
	_backColor: WebGLUniformLocation | null;
	_frontTexture: WebGLUniformLocation | null;
	_backTexture: WebGLUniformLocation | null;
	_frontHiResA: WebGLUniformLocation | null;
	_frontHiResB: WebGLUniformLocation | null;
	_backHiResA: WebGLUniformLocation | null;
	_backHiResB: WebGLUniformLocation | null;
	_frontBlendA: WebGLUniformLocation | null;
	_frontBlendB: WebGLUniformLocation | null;
	_backBlendA: WebGLUniformLocation | null;
	_backBlendB: WebGLUniformLocation | null;
	_numPointLights: WebGLUniformLocation | null;
	_pointLightPos: WebGLUniformLocation | null;
	_pointLightColor: WebGLUniformLocation | null;
	_pointLightIntensity: WebGLUniformLocation | null;
}

interface BlurHUniformLocations {
	_sceneTex: WebGLUniformLocation | null;
	_texelSize: WebGLUniformLocation | null;
	_blurRadius: WebGLUniformLocation | null;
	_weights: WebGLUniformLocation | null;
}

interface BlurVUniformLocations {
	_blurTex: WebGLUniformLocation | null;
	_sharpTex: WebGLUniformLocation | null;
	_texelSize: WebGLUniformLocation | null;
	_focusCenter: WebGLUniformLocation | null;
	_focusWidth: WebGLUniformLocation | null;
	_blurRadius: WebGLUniformLocation | null;
	_blurFalloff: WebGLUniformLocation | null;
	_weights: WebGLUniformLocation | null;
}


export class PaperRenderer {
	#gl: WebGL2RenderingContext;

	#paperProgram!: WebGLProgram;

	#paperULoc: PaperUniformLocations = {
		_viewProj: null,
		_lightDir: null,
		_ambientColor: null,
		_lightColor: null,
		_frontColor: null,
		_backColor: null,
		_frontTexture: null,
		_backTexture: null,
		_frontHiResA: null,
		_frontHiResB: null,
		_backHiResA: null,
		_backHiResB: null,
		_frontBlendA: null,
		_frontBlendB: null,
		_backBlendA: null,
		_backBlendB: null,
		_numPointLights: null,
		_pointLightPos: null,
		_pointLightColor: null,
		_pointLightIntensity: null,
	};

	#meshDatas: MeshData[] = [];

	#frontTextures: WebGLTexture[] = [];
	#backTextures: WebGLTexture[] = [];
	#frontHiResATextures: (WebGLTexture | null)[] = [];
	#frontHiResBTextures: (WebGLTexture | null)[] = [];
	#backHiResATextures: (WebGLTexture | null)[] = [];
	#backHiResBTextures: (WebGLTexture | null)[] = [];
	#frontBlendA: Float32Array = new Float32Array(0);
	#frontBlendB: Float32Array = new Float32Array(0);
	#backBlendA: Float32Array = new Float32Array(0);
	#backBlendB: Float32Array = new Float32Array(0);
	#whiteTexture: WebGLTexture;

	#activePreset: string = LIGHTING_PRESET;
	#presetParams: Record<string, number> = {};
	#pointLightPosData: Float32Array = new Float32Array(8 * 3);
	#pointLightColorData: Float32Array = new Float32Array(8 * 3);
	#pointLightIntensityData: Float32Array = new Float32Array(8);

	public _tiltShiftEnabled: boolean = TILT_SHIFT_ENABLED;

	#canvas: HTMLCanvasElement;

	#blurHProgram!: WebGLProgram;
	#blurHULoc: BlurHUniformLocations = {
		_sceneTex: null,
		_texelSize: null,
		_blurRadius: null,
		_weights: null,
	};

	#blurVProgram!: WebGLProgram;
	#blurVULoc: BlurVUniformLocations = {
		_blurTex: null,
		_sharpTex: null,
		_texelSize: null,
		_focusCenter: null,
		_focusWidth: null,
		_blurRadius: null,
		_blurFalloff: null,
		_weights: null,
	};

	#quadVAO!: WebGLVertexArrayObject;
	#sceneFbo: FboAttachments | null = null;
	#blurFbo: FboAttachments | null = null;
	#flipProgress: Float32Array = new Float32Array(0);
	#blurWeights: Float32Array;

	#bboxIsSet: boolean = false;
	#bboxMin: Float32Array = new Float32Array(3);
	#bboxMax: Float32Array = new Float32Array(3);

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#canvas = gl.canvas as HTMLCanvasElement;
		this._resize();
		this.#whiteTexture = createWhiteTexture(gl);

		this.#blurWeights = this.#computeBlurWeights();

		const presets = getPresets();
		for (const p of presets) {
			if (p.name === LIGHTING_PRESET) {
				for (const param of p.params) {
					this.#presetParams[param.key] = param.default;
				}
				break;
			}
		}
	}

	_initialize(meshes: PaperMesh[]): void {
		const gl = this.#gl;

		this.#paperProgram = createGLProgram(gl, paperVertSrc, paperFragSrc);

		this.#paperULoc._viewProj = gl.getUniformLocation(this.#paperProgram, 'a');
		this.#paperULoc._lightDir = gl.getUniformLocation(this.#paperProgram, 'A');
		this.#paperULoc._ambientColor = gl.getUniformLocation(this.#paperProgram, 'B');
		this.#paperULoc._lightColor = gl.getUniformLocation(this.#paperProgram, 'C');
		this.#paperULoc._frontColor = gl.getUniformLocation(this.#paperProgram, 'D');
		this.#paperULoc._backColor = gl.getUniformLocation(this.#paperProgram, 'E');
		this.#paperULoc._frontTexture = gl.getUniformLocation(this.#paperProgram, 'F');
		this.#paperULoc._backTexture = gl.getUniformLocation(this.#paperProgram, 'G');
		this.#paperULoc._frontHiResA = gl.getUniformLocation(this.#paperProgram, 'H');
		this.#paperULoc._frontHiResB = gl.getUniformLocation(this.#paperProgram, 'I');
		this.#paperULoc._backHiResA = gl.getUniformLocation(this.#paperProgram, 'J');
		this.#paperULoc._backHiResB = gl.getUniformLocation(this.#paperProgram, 'K');
		this.#paperULoc._frontBlendA = gl.getUniformLocation(this.#paperProgram, 'L');
		this.#paperULoc._frontBlendB = gl.getUniformLocation(this.#paperProgram, 'M');
		this.#paperULoc._backBlendA = gl.getUniformLocation(this.#paperProgram, 'N');
		this.#paperULoc._backBlendB = gl.getUniformLocation(this.#paperProgram, 'O');
		this.#paperULoc._numPointLights = gl.getUniformLocation(this.#paperProgram, 'P');
		this.#paperULoc._pointLightPos = gl.getUniformLocation(this.#paperProgram, 'Q[0]');
		this.#paperULoc._pointLightColor = gl.getUniformLocation(this.#paperProgram, 'R[0]');
		this.#paperULoc._pointLightIntensity = gl.getUniformLocation(this.#paperProgram, 'S[0]');

		this.#meshDatas = meshes.map((m, i) => this.#createMeshData(m, i));

		const pageCount = meshes.length;
		for (let p = 0; p < pageCount; p++) {
			this.#frontTextures.push(null!);
			this.#backTextures.push(null!);
			this.#frontHiResATextures.push(null);
			this.#frontHiResBTextures.push(null);
			this.#backHiResATextures.push(null);
			this.#backHiResBTextures.push(null);
		}
		this.#frontBlendA = new Float32Array(pageCount);
		this.#frontBlendB = new Float32Array(pageCount);
		this.#backBlendA = new Float32Array(pageCount);
		this.#backBlendB = new Float32Array(pageCount);

		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);

		this.#blurHProgram = createGLProgram(gl, fullscreenVertSrc, blurHFragSrc);
		this.#blurHULoc._sceneTex = gl.getUniformLocation(this.#blurHProgram, 'A');
		this.#blurHULoc._texelSize = gl.getUniformLocation(this.#blurHProgram, 'B');
		this.#blurHULoc._blurRadius = gl.getUniformLocation(this.#blurHProgram, 'C');
		this.#blurHULoc._weights = gl.getUniformLocation(this.#blurHProgram, 'D[0]');

		this.#blurVProgram = createGLProgram(gl, fullscreenVertSrc, blurVFragSrc);
		this.#blurVULoc._blurTex = gl.getUniformLocation(this.#blurVProgram, 'A');
		this.#blurVULoc._sharpTex = gl.getUniformLocation(this.#blurVProgram, 'B');
		this.#blurVULoc._texelSize = gl.getUniformLocation(this.#blurVProgram, 'C');
		this.#blurVULoc._focusCenter = gl.getUniformLocation(this.#blurVProgram, 'D');
		this.#blurVULoc._focusWidth = gl.getUniformLocation(this.#blurVProgram, 'E');
		this.#blurVULoc._blurRadius = gl.getUniformLocation(this.#blurVProgram, 'F');
		this.#blurVULoc._blurFalloff = gl.getUniformLocation(this.#blurVProgram, 'G');
		this.#blurVULoc._weights = gl.getUniformLocation(this.#blurVProgram, 'H[0]');

		this.#quadVAO = this.#createFullscreenQuad();
	}

	_setPageTextures(pageIndex: number, frontBitmap: TexImageSource, backBitmap: TexImageSource): void {
		const gl = this.#gl;

		{
			const tex = this.#frontTextures[pageIndex] ? this.#frontTextures[pageIndex] : gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frontBitmap);
			setupTextureParams(gl, tex);
			gl.generateMipmap(gl.TEXTURE_2D);
			if (!this.#frontTextures[pageIndex]) this.#frontTextures[pageIndex] = tex;
		}

		{
			const tex = this.#backTextures[pageIndex] ? this.#backTextures[pageIndex] : gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backBitmap);
			setupTextureParams(gl, tex);
			gl.generateMipmap(gl.TEXTURE_2D);
			if (!this.#backTextures[pageIndex]) this.#backTextures[pageIndex] = tex;
		}

		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	_setPageHiResTexture(pageIdx: number, side: 0 | 1, slot: 0 | 1, bitmap: ImageBitmap): void {
		const gl = this.#gl;
		const arr = side === 0
			? (slot === 0 ? this.#frontHiResATextures : this.#frontHiResBTextures)
			: (slot === 0 ? this.#backHiResATextures : this.#backHiResBTextures);

		if (arr[pageIdx]) gl.deleteTexture(arr[pageIdx]!);

		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
		setupTextureParams(gl, tex);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.bindTexture(gl.TEXTURE_2D, null);

		arr[pageIdx] = tex;
	}

	_setPageBlend(pageIdx: number, frontBlendA: number, frontBlendB: number, backBlendA: number, backBlendB: number): void {
		this.#frontBlendA[pageIdx] = frontBlendA;
		this.#frontBlendB[pageIdx] = frontBlendB;
		this.#backBlendA[pageIdx] = backBlendA;
		this.#backBlendB[pageIdx] = backBlendB;
	}

	_evictPageHiRes(pageIdx: number, side: 0 | 1, slot: 0 | 1): void {
		const arr = side === 0
			? (slot === 0 ? this.#frontHiResATextures : this.#frontHiResBTextures)
			: (slot === 0 ? this.#backHiResATextures : this.#backHiResBTextures);
		if (arr[pageIdx]) {
			this.#gl.deleteTexture(arr[pageIdx]!);
			arr[pageIdx] = null;
		}
		if (side === 0) {
			if (slot === 0) this.#frontBlendA[pageIdx] = 0;
			else this.#frontBlendB[pageIdx] = 0;
		} else {
			if (slot === 0) this.#backBlendA[pageIdx] = 0;
			else this.#backBlendB[pageIdx] = 0;
		}
	}

	_getCanvas(): HTMLCanvasElement {
		return this.#canvas;
	}

	_setLightingPreset(name: string, params: Record<string, number>): void {
		if (name && name !== this.#activePreset) {
			this.#activePreset = name;
			this.#presetParams = { ...params };
		} else {
			this.#presetParams = { ...this.#presetParams, ...params };
		}
	}

	_isLightingAnimated(): boolean {
		const presets = getPresets();
		const p = presets.find(p => p.name === this.#activePreset);
		return p?.isAnimated ?? false;
	}

	#createMeshData(mesh: PaperMesh, pageIndex: number): MeshData {
		const gl = this.#gl;
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);

		const posVBO = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, posVBO);
		gl.bufferData(gl.ARRAY_BUFFER, mesh._positions as BufferSource, gl.DYNAMIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

		const normVBO = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, normVBO);
		const normals = mesh._computeNormals();
		gl.bufferData(gl.ARRAY_BUFFER, normals as BufferSource, gl.DYNAMIC_DRAW);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

		const texCoordVBO = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, texCoordVBO);
		gl.bufferData(gl.ARRAY_BUFFER, mesh._texCoords as BufferSource, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

		const indexEBO = gl.createBuffer()!;
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexEBO);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh._indexBuffer as BufferSource, gl.STATIC_DRAW);

		gl.bindVertexArray(null);

		return {
			_vao: vao,
			_positionVBO: posVBO,
			_normalVBO: normVBO,
			_texCoordVBO: texCoordVBO,
			_indexEBO: indexEBO,
			_indexCount: mesh._indexBuffer.length,
			_pageIndex: pageIndex,
		};
	}

	#createFullscreenQuad(): WebGLVertexArrayObject {
		const gl = this.#gl;
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);

		const verts = new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]);
		const vbo = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		gl.bindVertexArray(null);
		return vao;
	}

	#drawPage(md: MeshData): void {
		const gl = this.#gl;
		const pageIdx = md._pageIndex;

		const binds: Array<[(WebGLTexture | null)[], WebGLUniformLocation | null]> = [
			[this.#frontTextures, this.#paperULoc._frontTexture],
			[this.#backTextures, this.#paperULoc._backTexture],
			[this.#frontHiResATextures, this.#paperULoc._frontHiResA],
			[this.#backHiResATextures, this.#paperULoc._backHiResA],
			[this.#frontHiResBTextures, this.#paperULoc._frontHiResB],
			[this.#backHiResBTextures, this.#paperULoc._backHiResB],
		];
		for (let i = 0; i < binds.length; i++) {
			gl.activeTexture(gl.TEXTURE0 + i);
			gl.bindTexture(gl.TEXTURE_2D, binds[i][0][pageIdx] ?? this.#whiteTexture);
			gl.uniform1i(binds[i][1], i);
		}

		gl.uniform1f(this.#paperULoc._frontBlendA, this.#frontBlendA[pageIdx]);
		gl.uniform1f(this.#paperULoc._frontBlendB, this.#frontBlendB[pageIdx]);
		gl.uniform1f(this.#paperULoc._backBlendA, this.#backBlendA[pageIdx]);
		gl.uniform1f(this.#paperULoc._backBlendB, this.#backBlendB[pageIdx]);

		gl.bindVertexArray(md._vao);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, md._indexEBO);
		gl.drawElements(gl.TRIANGLES, md._indexCount, gl.UNSIGNED_INT, 0);
	}

	#createFbo(): void {
		const gl = this.#gl;
		const w = this.#canvas.width;
		const h = this.#canvas.height;

		if (this.#sceneFbo) {
			gl.deleteTexture(this.#sceneFbo._color);
			if (this.#sceneFbo._depth) gl.deleteRenderbuffer(this.#sceneFbo._depth);
			gl.deleteFramebuffer(this.#sceneFbo._fbo);
		}

		const color = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, color);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		const depth = gl.createRenderbuffer()!;
		gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);

		const fbo = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

		this.#sceneFbo = { _fbo: fbo, _color: color, _depth: depth };

		if (this.#blurFbo) {
			gl.deleteTexture(this.#blurFbo._color);
			gl.deleteFramebuffer(this.#blurFbo._fbo);
		}

		const blurColor = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, blurColor);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		const blurFboObj = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboObj);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurColor, 0);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindRenderbuffer(gl.RENDERBUFFER, null);

		this.#blurFbo = { _fbo: blurFboObj, _color: blurColor, _depth: null };
	}

	_resize(): void {
		const gl = this.#gl;
		const dpr = window.devicePixelRatio || 1;
		const displayW = this.#canvas.clientWidth;
		const displayH = this.#canvas.clientHeight;
		this.#canvas.width = Math.floor(displayW * dpr);
		this.#canvas.height = Math.floor(displayH * dpr);
		gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
		this.#sceneFbo = null;
		this.#blurFbo = null;
	}

	_updateVertexBuffer(meshIndex: number, mesh: PaperMesh): void {
		if (meshIndex >= this.#meshDatas.length) return;
		const gl = this.#gl;
		const md = this.#meshDatas[meshIndex];
		gl.bindBuffer(gl.ARRAY_BUFFER, md._positionVBO);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh._positions as BufferSource);
	}

	_updateNormalBuffer(meshIndex: number, mesh: PaperMesh): void {
		if (meshIndex >= this.#meshDatas.length) return;
		const gl = this.#gl;
		const md = this.#meshDatas[meshIndex];
		const normals = mesh._computeNormals();
		gl.bindBuffer(gl.ARRAY_BUFFER, md._normalVBO);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals as BufferSource);
	}

	_getBoundingBoxCorners(): Float32Array | null {
		if (!this.#bboxIsSet) return null;
		const min = this.#bboxMin;
		const max = this.#bboxMax;
		const corners = new Float32Array(24);
		corners.set([min[0], min[1], min[2]]); // 0: ---
		corners.set([max[0], min[1], min[2]], 3); // 1: +--
		corners.set([max[0], min[1], max[2]], 6); // 2: ++-
		corners.set([min[0], min[1], max[2]], 9); // 3: -+-
		corners.set([min[0], max[1], min[2]], 12); // 4: --+
		corners.set([max[0], max[1], min[2]], 15); // 5: +-+
		corners.set([max[0], max[1], max[2]], 18); // 6: +++
		corners.set([min[0], max[1], max[2]], 21); // 7: -++
		return corners;
	}

	_getCanvasSize(): { width: number; height: number } {
		return { width: this.#canvas.width, height: this.#canvas.height };
	}

	/**
	 * Projects the 8 bounding box corners to screen CSS pixel coordinates.
	 * Returns { minX, maxX, minY, maxY } or null if no corners are visible.
	 */
	_getBoundingBoxScreenBounds(viewProj: Mat4): { minX: number; maxX: number; minY: number; maxY: number } | null {
		const corners = this._getBoundingBoxCorners();
		if (!corners) return null;
		const w = this.#canvas.width;
		const h = this.#canvas.height;
		let minX = Infinity, maxX = -Infinity;
		let minY = Infinity, maxY = -Infinity;
		let anyVisible = false;
		const m = viewProj._data;
		for (let i = 0; i < 8; i++) {
			const wx = corners[i * 3];
			const wy = corners[i * 3 + 1];
			const wz = corners[i * 3 + 2];
			const clipX = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
			const clipY = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
			const clipW = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
			if (clipW <= 0) continue;
			anyVisible = true;
			const ndcX = clipX / clipW;
			const ndcY = clipY / clipW;
			const sx = (ndcX * 0.5 + 0.5) * w;
			const sy = (0.5 - ndcY * 0.5) * h;
			if (sx < minX) minX = sx;
			if (sx > maxX) maxX = sx;
			if (sy < minY) minY = sy;
			if (sy > maxY) maxY = sy;
		}
		return anyVisible ? { minX, maxX, minY, maxY } : null;
	}

	_setFlipProgress(progress: Float32Array): void {
		this.#flipProgress = progress;
	}

	_setBoundingBox(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): void {
		this.#bboxIsSet = true;
		this.#bboxMin.set([min.x, min.y, min.z]);
		this.#bboxMax.set([max.x, max.y, max.z]);
	}

	#computeDrawOrder(): MeshData[] {
		if (this.#flipProgress.length === 0) return this.#meshDatas;

		const pageCount = this.#meshDatas.length;
		const totalStackHeight = pageCount * PAGE_THICKNESS;
		const weightFactor = computeWeightFactor(this.#flipProgress, pageCount);

		const pagesByY = this.#meshDatas.map(md => {
			const pi = md._pageIndex;
			const y = computePageSpineY(pi, this.#flipProgress[pi], weightFactor, totalStackHeight, pageCount, PAGE_THICKNESS);
			return { md, y };
		});

		pagesByY.sort((a, b) => b.y - a.y);
		return pagesByY.map(e => e.md);
	}

	#computeBlurWeights(): Float32Array {
		const weights = new Float32Array(15);
		let sum = 0.0;
		for (let i = -7; i <= 7; i++) {
			const w = Math.exp(-0.125 * i * i);
			weights[i + 7] = w;
			sum += w;
		}
		for (let i = 0; i < 15; i++) {
			weights[i] /= sum;
		}
		return weights;
	}

	_render(camera: OrbitCamera): void {
		const gl = this.#gl;

		const view = camera._getViewMatrix();
		const aspect = this.#canvas.width / Math.max(1, this.#canvas.height);
		const proj = Mat4._perspective(Math.PI * 0.25, aspect, 0.1, 50.0);
		const viewProj = new Mat4()._copy(proj)._multiply(view);

		const time = performance.now() / 1000;
		const lighting = computeLighting(this.#activePreset, this.#presetParams, time);

		gl.clearColor(0.0, 0.0, 0.0, 0.0);

		if (this._tiltShiftEnabled) {
			if (!this.#sceneFbo) this.#createFbo();
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.#sceneFbo!._fbo);
		}

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		gl.useProgram(this.#paperProgram);
		gl.uniformMatrix4fv(this.#paperULoc._viewProj, false, viewProj._data);
		gl.uniform3f(this.#paperULoc._lightDir, lighting._lightDir[0], lighting._lightDir[1], lighting._lightDir[2]);
		gl.uniform3f(this.#paperULoc._ambientColor, lighting._ambientColor[0], lighting._ambientColor[1], lighting._ambientColor[2]);
		gl.uniform3f(this.#paperULoc._lightColor, lighting._lightColor[0], lighting._lightColor[1], lighting._lightColor[2]);
		gl.uniform3f(this.#paperULoc._frontColor, FRONT_COLOR[0], FRONT_COLOR[1], FRONT_COLOR[2]);
		gl.uniform3f(this.#paperULoc._backColor, BACK_COLOR[0], BACK_COLOR[1], BACK_COLOR[2]);

		gl.uniform1i(this.#paperULoc._numPointLights, lighting._numPointLights);
		if (lighting._numPointLights > 0) {
			this.#pointLightPosData.set(lighting._pointLightPos);
			this.#pointLightColorData.set(lighting._pointLightColor);
			this.#pointLightIntensityData.set(lighting._pointLightIntensity);
		}
		gl.uniform3fv(this.#paperULoc._pointLightPos, this.#pointLightPosData);
		gl.uniform3fv(this.#paperULoc._pointLightColor, this.#pointLightColorData);
		gl.uniform1fv(this.#paperULoc._pointLightIntensity, this.#pointLightIntensityData);

		gl.disable(gl.CULL_FACE);

		const allPages = this.#computeDrawOrder();

		const isAnimating = (pi: number) =>
			this.#flipProgress.length > pi && this.#flipProgress[pi] > 0.0 && this.#flipProgress[pi] < 1.0;

		const staticPages = allPages.filter(md => !isAnimating(md._pageIndex));
		const animPages  = allPages.filter(md => isAnimating(md._pageIndex));

		// Static pages: front-to-back (no offset, early-Z eliminates overdraw)
		for (let di = 0; di < staticPages.length; di++) {
			this.#drawPage(staticPages[di]);
		}

		// Animating pages: back-to-front with polygon offset
		if (animPages.length > 0) {
			animPages.reverse(); // ascending Y: bottom-to-top
			gl.enable(gl.POLYGON_OFFSET_FILL);

			for (let i = 0; i < animPages.length; i++) {
				gl.polygonOffset(0.0, -i * 12000.0);
				this.#drawPage(animPages[i]);
			}

			gl.disable(gl.POLYGON_OFFSET_FILL);
		}

		gl.bindVertexArray(null);

		gl.disable(gl.POLYGON_OFFSET_FILL);

		if (this._tiltShiftEnabled) {
			const texelX = 1.0 / this.#canvas.width;
			const texelY = 1.0 / this.#canvas.height;

			const range = camera._maxRadius - camera._minRadius;
			const t = range > 0 ? (camera._radius - camera._minRadius) / range : 0;
			const strength = Math.max(0.05, 1.0 - t);

			const blurRadius = TILT_SHIFT_BLUR_RADIUS * strength;
			const blurFalloff = TILT_SHIFT_BLUR_FALLOFF * strength;

			// Pass 1: horizontal separable blur → blurFbo
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.#blurFbo!._fbo);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.disable(gl.DEPTH_TEST);

			gl.useProgram(this.#blurHProgram);
			gl.uniform1i(this.#blurHULoc._sceneTex, 0);
			gl.uniform2f(this.#blurHULoc._texelSize, texelX, texelY);
			gl.uniform1f(this.#blurHULoc._blurRadius, blurRadius);
			gl.uniform1fv(this.#blurHULoc._weights, this.#blurWeights);

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.#sceneFbo!._color);

			gl.bindVertexArray(this.#quadVAO);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			// Pass 2: vertical separable blur + composite → screen
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.clear(gl.COLOR_BUFFER_BIT);

			gl.useProgram(this.#blurVProgram);
			gl.uniform1i(this.#blurVULoc._blurTex, 0);
			gl.uniform1i(this.#blurVULoc._sharpTex, 1);
			gl.uniform2f(this.#blurVULoc._texelSize, texelX, texelY);
			gl.uniform1f(this.#blurVULoc._focusCenter, TILT_SHIFT_FOCUS_CENTER);
			gl.uniform1f(this.#blurVULoc._focusWidth, TILT_SHIFT_FOCUS_WIDTH);
			gl.uniform1f(this.#blurVULoc._blurRadius, blurRadius);
			gl.uniform1f(this.#blurVULoc._blurFalloff, blurFalloff);
			gl.uniform1fv(this.#blurVULoc._weights, this.#blurWeights);

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.#blurFbo!._color);
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, this.#sceneFbo!._color);

			gl.bindVertexArray(this.#quadVAO);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			gl.enable(gl.DEPTH_TEST);
		}

		gl.bindVertexArray(null);
	}
}
