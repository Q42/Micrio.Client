/**
 * The WebGL rendering module. Handles shader compilation, WebGL context setup,
 * texture management, and drawing operations called by the Engine module.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { TextureBitmap } from './textures';
import type { HTMLMicrioElement } from '$core/element';

import { Engine } from './engine';
import { PostProcessor } from './postprocess';
import { Browser } from '$utils/browser';
import { MicrioError, ErrorCodes } from '$core/error';
import { segsX, segsY } from './constants';
import { createElement } from '$utils/dom';

const isFirefox:boolean = Browser.firefox;

/** Internal vertex shader source code. @internal */
const vertexShader:string = [
	// Combined ModelViewProjection matrix from Engine
	'uniform mat4 GLMatrix;',

	// Vertex position (from Engine buffer)
	'attribute vec3 pos;',
	// Texture coordinate (from static buffer)
	'attribute vec2 aTextureCoord;',

	// Pass texture coordinate to fragment shader
	'varying highp vec2 vTextureCoord;',

	'void main()',
	'{',
		// Calculate clip space position
		'gl_Position = GLMatrix * vec4(pos, 1.0);',
		// Pass through texture coordinate
		'vTextureCoord = aTextureCoord;',
	'}',
].join('');

/** Internal fragment shader source code. @internal */
const fragmentShader:string = [
	// Use medium precision for fragment calculations
	'precision mediump float;',

	// Received texture coordinate from vertex shader
	'varying highp vec2 vTextureCoord;',

	// The tile texture
	'uniform sampler2D uSampler;',
	// Tile opacity (for fading)
	'uniform float opacity;',
	// Flag indicating if texture is missing/not loaded
	'uniform int noTexture;',

	'void main() {',
		// If texture is missing
		'if(noTexture==1) {',
		// Draw a placeholder color (dark semi-transparent gray)
			'gl_FragColor = vec4(.1,.1,.1,.1);',
		'} else {',
		// Firefox premultiplied alpha workaround
		...(isFirefox ? [
			'vec4 textureColor = texture2D(uSampler, vTextureCoord);',
			// Manually apply opacity to RGB based on new alpha
			'float newAlpha = min(1., textureColor.a * opacity);',
			'gl_FragColor = vec4(textureColor.rgb * newAlpha, newAlpha);',
		] : [
			// Standard alpha blending (premultiplied alpha assumed in blendFunc)
			'gl_FragColor = texture2D(uSampler, vTextureCoord) * opacity;',
		]),
		'}',
	'}',
].join('');

/** Watermark tile size. @internal */
const watermarkTileSize = 256;

/** Watermark maximum size. @internal */
const watermarkMaxSizeW = 96;
const watermarkMaxSizeH = 64;

/**
 * The WebGL controller class. Manages the WebGL context, shaders, buffers,
 * textures, and drawing operations. Accessed via `micrio.webgl`.
 * @internal
 */
export class WebGL {
	/** The WebGL rendering context (can be WebGL1 or WebGL2). */
	gl!:WebGLRenderingContext | WebGL2RenderingContext; // Definite assignment assertion

	/** The display window object (usually `self`). */
	display:Window = self;

	/** The main WebGL shader program for rendering tiles. @internal */
	#program!:WebGLProgram;

	/** Uniform location for tile opacity. @internal */
	#opaLoc!:WebGLUniformLocation;

	/** Uniform location for the 'noTexture' flag. @internal */
	#noTxtLoc!:WebGLUniformLocation;

	/** Uniform location for the combined ModelViewProjection matrix (GLMatrix). */
	pmLoc!:WebGLUniformLocation;

	/** Attribute location for texture coordinates. @internal */
	#txtAttr:number = -1;

	/** WebGLBuffer for static texture coordinates. @internal */
	#txtBuffer!:WebGLBuffer;

	/** WebGLBuffer for dynamic vertex geometry (positions). @internal */
	#geomBuffer!:WebGLBuffer;

	/** WebGLBuffer for watermark texture coordinates. @internal */
	#wmTxtBuffer!:WebGLBuffer;

	/** Watermark texture. @internal */
	#wmTexture: WebGLTexture | null = null;

	/** Watermark URL. @internal */
	#wmUrl: string | null = null;

	/** Watermark vertices (static full screen quad). @internal */
	#wmVerts: Float32Array = new Float32Array([
		-1, -1, 0,
		 1, -1, 0,
		-1,  1, 0,
		-1,  1, 0,
		 1, -1, 0,
		 1,  1, 0
	]);

	/** Watermark UVs (dynamic). @internal */
	#wmUvs: Float32Array = new Float32Array([0,0, 0,0, 0,0, 0,0, 0,0, 0,0]);

	/** Identity matrix for watermark rendering. @internal */
	#wmMatrix: Float32Array = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

	/** Watermark opacity @internal */
	#wmOpacity: number = 0.075;

	/** Attribute location for vertex positions. @internal */
	#posAttr:number = -1;

	/** Flag indicating if the previous draw call was for a 360 tile. @internal */
	#was360:boolean = false;

	/** Tracks last-set noTexture uniform value to avoid redundant GL calls. */
	#lastNoTexture: number = -1;
	/** Tracks last-set opacity uniform value to avoid redundant GL calls. */
	#lastOpacity: number = -1;

	/** Optional PostProcessor instance for applying fullscreen effects. */
	postprocessor?:PostProcessor;

	/**
	 * Creates the WebGL instance.
	 * @param micrio The main HTMLMicrioElement instance.
	*/
	readonly #micrio:HTMLMicrioElement;

	constructor(
		micrio:HTMLMicrioElement
	){
		this.#micrio = micrio;
	}

	/** Initializes the WebGL context, compiles shaders, and sets up buffers/attributes. */
	init() : void {
		// Check for WebGL2 support
		const hasGL2 = 'WebGL2RenderingContext' in window;
		// Get WebGL context from the canvas
		const gl = this.#micrio.canvas.element.getContext(hasGL2 ? 'webgl2' : 'webgl', {
			alpha: true, // Request alpha channel
			// premultipliedAlpha: false, // Default is true, might affect blending
			// preserveDrawingBuffer: true, // Needed for fadeBetween setting (legacy?) or explicit attribute
			preserveDrawingBuffer: this.#micrio.hasAttribute('data-preserve-drawing-buffer'),
			stencil: false, // Stencil buffer not needed
			antialias: false, // Antialiasing not needed (handled by rendering technique?)
			depth: false, // Depth buffer not needed
			desynchronized: false, // Performance hint
			// This flag breaks WebGL2 when having experimental WebGPU browser flags enabled
			// powerPreference: 'high-performance' // Request high performance GPU
		}) as WebGLRenderingContext | WebGL2RenderingContext; // Type assertion

		// Check if context creation was successful
		if(hasGL2 ? !(gl instanceof window.WebGL2RenderingContext)
			: !(gl instanceof window.WebGLRenderingContext)) {
			throw new MicrioError('WebGL context creation failed', {
				code: ErrorCodes.WEBGL_UNSUPPORTED,
				displayMessage: 'Your browser does not support WebGL, which is required to view this content. Please try a different browser.'
			});
		}

		this.gl = gl; // Store the context

		// Initialize post-processor if a fragment shader is provided in settings
		const postprocessing = this.#micrio.$current?.$settings.postProcessingFragmentShader;
		if(postprocessing) {
			this.postprocessor = new PostProcessor(gl, this.#micrio, postprocessing);
			this.#micrio.keepRendering = true; // Force continuous rendering if postprocessing
		}

		// --- Shader Program Setup ---
		const program = gl.createProgram();
		if(!(program instanceof WebGLProgram)) {
			throw new MicrioError('Failed to create WebGL program', {
				code: ErrorCodes.WEBGL_SHADER_COMPILE,
				displayMessage: 'There was a problem initializing the graphics. Please try refreshing the page.'
			});
		}
		this.#program = program;

		// Compile and attach shaders
		this.getShader(this.#program, gl.VERTEX_SHADER, vertexShader);
		this.getShader(this.#program, gl.FRAGMENT_SHADER, fragmentShader);
		// Link program
		gl.linkProgram(this.#program);
		if (!gl.getProgramParameter(this.#program, gl.LINK_STATUS)) {
			throw new MicrioError('Shader link error: ' + gl.getProgramInfoLog(this.#program), {
				code: ErrorCodes.WEBGL_SHADER_COMPILE,
				displayMessage: 'There was a problem initializing the graphics. Please try refreshing the page.'
			});
		}
		gl.useProgram(this.#program); // Use the program

		// --- WebGL State Setup ---
		// Configure alpha blending (standard alpha blending with premultiplied alpha)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST); // Depth testing not needed for 2D tiles
		gl.clearColor(0, 0, 0, 0); // Set clear color to transparent black

		// --- Get Uniform Locations ---
		const opaLoc = gl.getUniformLocation(this.#program, 'opacity');
		if(opaLoc) this.#opaLoc = opaLoc;
		else throw new MicrioError('Failed to bind WebGL opacity uniform', { code: ErrorCodes.WEBGL_SHADER_COMPILE });

		const pmLoc = gl.getUniformLocation(this.#program, 'GLMatrix');
		if(pmLoc) this.pmLoc = pmLoc;
		else throw new MicrioError('Failed to bind WebGL matrix uniform', { code: ErrorCodes.WEBGL_SHADER_COMPILE });

		const noTxtLoc = gl.getUniformLocation(this.#program, 'noTexture');
		if(noTxtLoc) this.#noTxtLoc = noTxtLoc;
		else throw new MicrioError('Failed to bind WebGL texture uniform', { code: ErrorCodes.WEBGL_SHADER_COMPILE });

		// --- Buffer Setup ---
		// Texture Coordinates Buffer (Static)
		this.#txtAttr = gl.getAttribLocation(this.#program, 'aTextureCoord');
		const txtBuffer = gl.createBuffer();
		if(txtBuffer) this.#txtBuffer = txtBuffer;
		else throw new MicrioError('Failed to create WebGL texture buffer', { code: ErrorCodes.WEBGL_OUT_OF_MEMORY, displayMessage: 'Your device is low on memory. Try closing other browser tabs or applications.' });
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#txtBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, Engine._textureBuffer, gl.STATIC_DRAW); // Use static buffer from Engine

		// Watermark Texture Coordinates Buffer
		const wmTxtBuffer = gl.createBuffer();
		if(wmTxtBuffer) this.#wmTxtBuffer = wmTxtBuffer;
		else throw new MicrioError('Failed to create WebGL watermark buffer', { code: ErrorCodes.WEBGL_OUT_OF_MEMORY, displayMessage: 'Your device is low on memory. Try closing other browser tabs or applications.' });

		// Vertex Position Buffer (Dynamic - updated by Engine)
		const geomBuffer = gl.createBuffer();
		if(geomBuffer) this.#geomBuffer = geomBuffer;
		else throw new MicrioError('Failed to create WebGL geometry buffer', { code: ErrorCodes.WEBGL_OUT_OF_MEMORY, displayMessage: 'Your device is low on memory. Try closing other browser tabs or applications.' });
		this.#posAttr = gl.getAttribLocation(this.#program, 'pos');

		// Link buffers to attributes initially
		this.#linkBuffers();

		// Ensure texture unit 0 is active (hoisted from per-tile path)
		gl.activeTexture(gl.TEXTURE0);

		// Set initial viewport
		gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
	}

	/** Links the vertex and texture coordinate buffers to the shader attributes. @internal */
	#linkBuffers() : void {
		const gl = this.gl;
		// Bind and buffer vertex position data (allocate to max size for bufferSubData compatibility)
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#geomBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.#micrio.engine.vertexBuffer360.byteLength, gl.DYNAMIC_DRAW);

		// Enable and configure texture coordinate attribute
		gl.enableVertexAttribArray(this.#txtAttr);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#txtBuffer); // Bind static tex coord buffer
		gl.vertexAttribPointer(this.#txtAttr, 2, gl.FLOAT, false, 0, 0); // 2 floats per vertex

		// Enable and configure vertex position attribute
		gl.enableVertexAttribArray(this.#posAttr);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#geomBuffer); // Bind dynamic position buffer
		gl.vertexAttribPointer(this.#posAttr, 3, gl.FLOAT, false, 0, 0); // 3 floats per vertex
	}

	/**
	 * Disposes WebGL resources.
	 * @param loseContext If true, attempts to lose the WebGL context entirely.
	*/
	dispose(loseContext:boolean=false ) : void {
		const gl = this.gl;
		if (!gl) return; // Exit if context doesn't exist

		// Unbind buffers and textures
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		// Delete buffers
		gl.deleteBuffer(this.#txtBuffer);
		gl.deleteBuffer(this.#geomBuffer);
		gl.deleteBuffer(this.#wmTxtBuffer);
		// Delete shader program
		gl.deleteProgram(this.#program);
		// Delete framebuffer/texture from postprocessor if it exists
		this.postprocessor?.dispose();
		// Delete watermark texture
		if(this.#wmTexture) gl.deleteTexture(this.#wmTexture);

		// Attempt to lose context if requested
		if(loseContext) {
			const tryLose = gl.getExtension('WEBGL_lose_context');
			if(tryLose instanceof Object && tryLose['loseContext'] instanceof Function) tryLose['loseContext']();
		}
		// Allow setting gl to null (instance is no longer usable after dispose)
		this.gl = null as unknown as WebGLRenderingContext;
	}

	/**
	 * Compiles a WebGL shader.
	 * @internal
	 * @param program The WebGLProgram to attach the shader to.
	 * @param type The shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
	 * @param source The shader source code string.
	 * @throws If shader creation or compilation fails.
	*/
	getShader(program:WebGLProgram, type:number, source:string) {
		const shader = this.gl.createShader(type);
		if(!shader) throw new Error(`Could not create WebGL shader (type: ${type})`);
		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);
		// Check compilation status
		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			this.gl.deleteProgram(program);
			throw new MicrioError('Shader compilation failed: ' + this.gl.getShaderInfoLog(shader), {
				code: ErrorCodes.WEBGL_SHADER_COMPILE,
				displayMessage: 'There was a problem initializing the graphics. Please try refreshing the page.'
			});
		}
		this.gl.attachShader(program, shader); // Attach compiled shader
		this.gl.deleteShader(shader); // Delete shader object after attaching
	}

	/**
	 * Creates or updates a WebGL texture.
	 * @param img Optional source image/bitmap/video for the texture. If omitted, creates an empty texture.
	 * @param texture Optional existing WebGLTexture to update. If omitted, creates a new one.
	 * @param noSmoothing If true, uses NEAREST filtering for magnification (pixelated look).
	 * @returns The created or updated WebGLTexture.
	 * @throws If texture creation fails.
	*/
	getTexture(img?: TextureBitmap, texture?: WebGLTexture, noSmoothing?: boolean) : WebGLTexture {
		const gl = this.gl;
		const t = texture ?? gl.createTexture(); // Use existing or create new
		if(!t) throw new Error('Could not create WebGL texture');

		gl.bindTexture(gl.TEXTURE_2D, t); // Bind the texture

		// Upload image data if provided
		if(img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

		// Set texture parameters
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // Prevent wrapping
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // Linear filtering for minification
		// Use NEAREST for magnification if noSmoothing is true, otherwise LINEAR
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, noSmoothing ? gl.NEAREST : gl.LINEAR);

		return t;
	}

	/**
	 * Updates an existing WebGL texture with data from an image, bitmap, or video frame.
	 * Typically used for updating video textures each frame.
	 * @param texture The WebGLTexture to update.
	 * @param img The source image/bitmap/video.
	 */
	updateTexture(
		texture:WebGLTexture,
		img:TextureBitmap,
	) : void {
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		// Update texture data
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		// Unbind texture (good practice)
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	/** Prepares for drawing a frame (binds framebuffer if postprocessing, clears canvas). @internal */
	drawStart() : void {
		const gl = this.gl;
		// Bind framebuffer if postprocessing is active
		if(this.postprocessor) gl.bindFramebuffer(gl.FRAMEBUFFER, this.postprocessor.frameBuffer);
		// Clear the drawing buffer
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	/** Finalizes frame drawing (renders postprocessing effect if active). @internal */
	drawEnd() : void {
		// If postprocessor exists, render its effect to the screen
		if(this.postprocessor) {
			this.postprocessor.render();
			// Re-bind the main program and buffers for subsequent Micrio rendering if needed
			this.gl.useProgram(this.#program);
			this.#linkBuffers();
		}
		if(this.#wmTexture) this.#drawWatermark();
	}

	/**
	 * Draws a single tile using the provided texture and opacity.
	 * Selects appropriate vertex/texture buffers based on whether it's a 360 tile.
	 * @param texture The WebGLTexture for the tile (or undefined for placeholder).
	 * @param opacity The opacity of the tile (0-1).
	 * @param is360 True if rendering a 360 tile.
	*/
	drawTile(texture?:WebGLTexture, opacity:number=1, is360:boolean=false) : void {
		const gl = this.gl;
		// Set uniforms only when values change
		const noTexture = texture ? 0 : 1;
		if (noTexture !== this.#lastNoTexture) {
			gl.uniform1i(this.#noTxtLoc, noTexture);
			this.#lastNoTexture = noTexture;
		}
		if (opacity !== this.#lastOpacity) {
			gl.uniform1f(this.#opaLoc, opacity);
			this.#lastOpacity = opacity;
		}
		// Bind the texture if provided (texture unit 0 is already active from init)
		if(texture) {
			gl.bindTexture(gl.TEXTURE_2D, texture);
		}

		// Determine number of vertices based on 360 or standard quad
		const length = is360 ? 6 * segsX * segsY : 6;

		// If switching between 360 and standard rendering, re-buffer static texture coordinates
		if(is360 != this.#was360) {
			gl.bindBuffer(gl.ARRAY_BUFFER, this.#txtBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, is360 ? Engine._textureBuffer360 : Engine._textureBuffer, gl.STATIC_DRAW);
			// Re-bind geometry buffer
			gl.bindBuffer(gl.ARRAY_BUFFER, this.#geomBuffer);
			this.#was360 = is360;
		}

		// Update dynamic vertex buffer via bufferSubData (buffer already allocated with DYNAMIC_DRAW)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, is360 ? this.#micrio.engine.vertexBuffer360 : this.#micrio.engine.vertexBuffer);

		// Draw the geometry
		// For wireframe debugging:
		// gl.drawArrays(this.gl.LINE_STRIP, 0, length);
		gl.drawArrays(gl.TRIANGLES, 0, length);

	}

	/**
	 * Loads a watermark texture from a URL.
	 * @param url The watermark image URL.
	 */
	loadWatermark(url: string, wmOpacity?:number) : void {
		if(url === this.#wmUrl) return; // Already loaded/loading

		this.#wmUrl = url;
		const img = new Image();
		if(wmOpacity) this.#wmOpacity = wmOpacity;
		img.crossOrigin = 'anonymous';
		img.src = url;
		img.onload = () => {
			const c = createElement('canvas', {
				props: { width: watermarkTileSize, height: watermarkTileSize }
			});
			const ctx = c.getContext('2d');
			if(!ctx) return;

			// Calculate dimensions to fit within bounds while maintaining aspect ratio
			const ratio = Math.min(watermarkMaxSizeW / img.width, watermarkMaxSizeH / img.height);
			const w = img.width * ratio;
			const h = img.height * ratio;

			// Draw centered
			ctx.drawImage(img, (watermarkTileSize - w) / 2, (watermarkTileSize - h) / 2, w, h);

			// Create texture from canvas
			if(this.#wmTexture) this.gl.deleteTexture(this.#wmTexture);
			this.#wmTexture = this.getTexture(c); // getTexture supports HTMLCanvasElement

			// Configure repeating texture
			const gl = this.gl;
			gl.bindTexture(gl.TEXTURE_2D, this.#wmTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			// Restore to null binding
			gl.bindTexture(gl.TEXTURE_2D, null);

			this.#micrio.engine.render();
		};
	}

	/**
	 * Draws a watermark on top of the canvas.
	 */
	#drawWatermark() : void {
		const gl = this.gl;

		if(!this.#wmTexture) return;

		// Use program
		gl.useProgram(this.#program);

		// Set blending function for watermark
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		// Set identity matrix for screen-space rendering
		gl.uniformMatrix4fv(this.pmLoc, false, this.#wmMatrix);

		// Set texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.#wmTexture);
		gl.uniform1i(this.#noTxtLoc, 0);
		gl.uniform1f(this.#opaLoc, this.#wmOpacity); // Slight transparency

		// UVs (Repeated based on 512px tiling)
		const w = gl.drawingBufferWidth / watermarkTileSize;
		const h = gl.drawingBufferHeight / watermarkTileSize;
		
		// Update UVs directly
		const u = this.#wmUvs;
		u[1] = h;
		u[2] = w; u[3] = h;
		u[8] = w; u[9] = h;
		u[10] = w;

		// Use geomBuffer for vertices
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#geomBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.#wmVerts, gl.DYNAMIC_DRAW);
		gl.vertexAttribPointer(this.#posAttr, 3, gl.FLOAT, false, 0, 0);

		// Use wmTxtBuffer for UVs
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#wmTxtBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.#wmUvs, gl.DYNAMIC_DRAW);
		gl.vertexAttribPointer(this.#txtAttr, 2, gl.FLOAT, false, 0, 0);

		// Draw
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Restore state
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Restore default blending
		this.#linkBuffers(); // Restores Engine buffer bindings (standard quad)
		this.#was360 = false; // Mark state as standard so next 360 draw triggers rebind
	}

}
