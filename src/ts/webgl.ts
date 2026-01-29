/**
 * The WebGL rendering module. Handles shader compilation, WebGL context setup,
 * texture management, and drawing operations called by the Wasm module.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { TextureBitmap } from './textures';
import type { HTMLMicrioElement } from './element';

import { Wasm } from './wasm'; // Access Wasm static properties and instance
import { PostProcessor } from './postprocess'; // Handles post-processing effects

/** Flag indicating if the browser is Firefox (requires slightly different shader logic). @internal */
const isFirefox:boolean = /firefox/i.test(navigator.userAgent);

/** Internal vertex shader source code. @internal */
const vertexShader:string = `
uniform mat4 GLMatrix; // Combined ModelViewProjection matrix from Wasm

attribute vec3 pos; // Vertex position (from Wasm buffer)
attribute vec2 aTextureCoord; // Texture coordinate (from static buffer)

varying highp vec2 vTextureCoord; // Pass texture coordinate to fragment shader

void main()
{
	gl_Position = GLMatrix * vec4(pos, 1.0); // Calculate clip space position
	vTextureCoord = aTextureCoord; // Pass through texture coordinate
}`;

/** Internal fragment shader source code. @internal */
const fragmentShader:string = `
precision mediump float; // Use medium precision for fragment calculations

varying highp vec2 vTextureCoord; // Received texture coordinate from vertex shader

uniform sampler2D uSampler; // The tile texture
uniform float opacity; // Tile opacity (for fading)
uniform int noTexture; // Flag indicating if texture is missing/not loaded

void main() {
	if(noTexture==1) { // If texture is missing
		gl_FragColor = vec4(.1,.1,.1,.1); // Draw a placeholder color (dark semi-transparent gray)
	} else {
	${isFirefox ? `
		// Firefox premultiplied alpha workaround
		vec4 textureColor = texture2D(uSampler, vTextureCoord);
		// Manually apply opacity to RGB based on new alpha
		float newAlpha = min(1., textureColor.a * opacity);
		gl_FragColor = vec4(textureColor.rgb * newAlpha, newAlpha);` : `
		// Standard alpha blending (premultiplied alpha assumed in blendFunc)
		gl_FragColor = texture2D(uSampler, vTextureCoord) * opacity;` }
		// Debug: Draw red instead of texture
		//gl_FragColor = vec4(1.,0.,0.,1.);
	}
}`;

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
	private program!:WebGLProgram;

	/** Uniform location for tile opacity. @internal */
	private opaLoc!:WebGLUniformLocation;

	/** Uniform location for the 'noTexture' flag. @internal */
	private noTxtLoc!:WebGLUniformLocation;

	/** Uniform location for the combined ModelViewProjection matrix (GLMatrix). */
	pmLoc!:WebGLUniformLocation;

	/** Attribute location for texture coordinates. @internal */
	private txtAttr:number = -1;

	/** WebGLBuffer for static texture coordinates. @internal */
	private txtBuffer!:WebGLBuffer;

	/** WebGLBuffer for dynamic vertex geometry (positions). @internal */
	private geomBuffer!:WebGLBuffer;

	/** WebGLBuffer for watermark texture coordinates. @internal */
	private wmTxtBuffer!:WebGLBuffer;

	/** Watermark texture. @internal */
	private wmTexture: WebGLTexture | null = null;

	/** Watermark URL. @internal */
	private wmUrl: string | null = null;

	/** Watermark vertices (static full screen quad). @internal */
	private wmVerts: Float32Array = new Float32Array([
		-1, -1, 0,
		 1, -1, 0,
		-1,  1, 0,
		-1,  1, 0,
		 1, -1, 0,
		 1,  1, 0
	]);

	/** Watermark UVs (dynamic). @internal */
	private wmUvs: Float32Array = new Float32Array([0,0, 0,0, 0,0, 0,0, 0,0, 0,0]);

	/** Identity matrix for watermark rendering. @internal */
	private wmMatrix: Float32Array = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

	/** Watermark opacity @internal */
	private wmOpacity: number = 0.075;

	/** Attribute location for vertex positions. @internal */
	private posAttr:number = -1;

	/** Flag indicating if the previous draw call was for a 360 tile. @internal */
	private was360:boolean = false;

	/** Optional PostProcessor instance for applying fullscreen effects. */
	postpocessor?:PostProcessor;

	/**
	 * Creates the WebGL instance.
	 * @param micrio The main HTMLMicrioElement instance.
	*/
	constructor(
		private micrio:HTMLMicrioElement
	){ }

	/** Initializes the WebGL context, compiles shaders, and sets up buffers/attributes. */
	init() : void {
		// Check for WebGL2 support
		const hasGL2 = 'WebGL2RenderingContext' in window;
		// Get WebGL context from the canvas
		const gl = this.micrio.canvas.element.getContext(hasGL2 ? 'webgl2' : 'webgl', {
			alpha: true, // Request alpha channel
			// premultipliedAlpha: false, // Default is true, might affect blending
			// preserveDrawingBuffer: true, // Needed for fadeBetween setting (legacy?) or explicit attribute
			preserveDrawingBuffer: this.micrio.hasAttribute('data-preserve-drawing-buffer'),
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
			throw new Error('Error creating WebGL context. Does your browser support WebGL?');
		}

		this.gl = gl; // Store the context

		// Initialize post-processor if a fragment shader is provided in settings
		const postprocessing = this.micrio.$current?.$settings.postProcessingFragmentShader;
		if(postprocessing) {
			this.postpocessor = new PostProcessor(gl, this.micrio, postprocessing);
			this.micrio.keepRendering = true; // Force continuous rendering if postprocessing
		}

		// --- Shader Program Setup ---
		const program = gl.createProgram();
		if(!(program instanceof WebGLProgram)) throw new Error('Could not create WebGL shader program');
		this.program = program;

		// Compile and attach shaders
		this.getShader(this.program, gl.VERTEX_SHADER, vertexShader);
		this.getShader(this.program, gl.FRAGMENT_SHADER, fragmentShader);
		// Link program
		gl.linkProgram(this.program);
		if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
			console.error("Main shader link error:", gl.getProgramInfoLog(this.program));
			// TODO: Handle link error more gracefully
		}
		gl.useProgram(this.program); // Use the program

		// --- WebGL State Setup ---
		// Configure alpha blending (standard alpha blending with premultiplied alpha)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST); // Depth testing not needed for 2D tiles
		gl.clearColor(0, 0, 0, 0); // Set clear color to transparent black

		// --- Get Uniform Locations ---
		const opaLoc = gl.getUniformLocation(this.program, 'opacity');
		if(opaLoc) this.opaLoc = opaLoc;
		else throw new Error('Could not bind opacity WebGL uniform');

		const pmLoc = gl.getUniformLocation(this.program, 'GLMatrix');
		if(pmLoc) this.pmLoc = pmLoc;
		else throw new Error('Could not bind GLMatrix WebGL uniform');

		const noTxtLoc = gl.getUniformLocation(this.program, 'noTexture');
		if(noTxtLoc) this.noTxtLoc = noTxtLoc;
		else throw new Error('Could not bind noTexture WebGL uniform');

		// --- Buffer Setup ---
		// Texture Coordinates Buffer (Static)
		this.txtAttr = gl.getAttribLocation(this.program, 'aTextureCoord');
		const txtBuffer = gl.createBuffer();
		if(txtBuffer) this.txtBuffer = txtBuffer;
		else throw new Error('Could not create texture coordinates WebGL buffer');
		gl.bindBuffer(gl.ARRAY_BUFFER, this.txtBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, Wasm._textureBuffer, gl.STATIC_DRAW); // Use static buffer from Wasm

		// Watermark Texture Coordinates Buffer
		const wmTxtBuffer = gl.createBuffer();
		if(wmTxtBuffer) this.wmTxtBuffer = wmTxtBuffer;
		else throw new Error('Could not create watermark WebGL buffer');

		// Vertex Position Buffer (Dynamic - updated by Wasm)
		const geomBuffer = gl.createBuffer();
		if(geomBuffer) this.geomBuffer = geomBuffer;
		else throw new Error('Could not create geometry WebGL buffer');
		this.posAttr = gl.getAttribLocation(this.program, 'pos');

		// Link buffers to attributes initially
		this.linkBuffers();

		// Set initial viewport
		gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);

		// Optional pixel store settings (commented out - defaults usually fine)
		// gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
	}

	/** Links the vertex and texture coordinate buffers to the shader attributes. @internal */
	private linkBuffers() : void {
		const gl = this.gl;
		// Bind and buffer vertex position data (using the view from Wasm memory)
		gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.micrio.wasm._vertexBuffer, gl.DYNAMIC_DRAW);

		// Enable and configure texture coordinate attribute
		gl.enableVertexAttribArray(this.txtAttr);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.txtBuffer); // Bind static tex coord buffer
		gl.vertexAttribPointer(this.txtAttr, 2, gl.FLOAT, false, 0, 0); // 2 floats per vertex

		// Enable and configure vertex position attribute
		gl.enableVertexAttribArray(this.posAttr);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer); // Bind dynamic position buffer
		gl.vertexAttribPointer(this.posAttr, 3, gl.FLOAT, false, 0, 0); // 3 floats per vertex
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
		gl.deleteBuffer(this.txtBuffer);
		gl.deleteBuffer(this.geomBuffer);
		gl.deleteBuffer(this.wmTxtBuffer);
		// Delete shader program
		gl.deleteProgram(this.program);
		// Delete framebuffer/texture from postprocessor if it exists
		this.postpocessor?.dispose();
		// Delete watermark texture
		if(this.wmTexture) gl.deleteTexture(this.wmTexture);

		// Attempt to lose context if requested
		if(loseContext) {
			const tryLose = gl.getExtension('WEBGL_lose_context');
			if(tryLose instanceof Object && tryLose['loseContext'] instanceof Function) tryLose['loseContext']();
		}
		// @ts-ignore Allow setting gl to null
		this.gl = null;
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
			console.error('Error compiling shader', this.gl.getShaderInfoLog(shader));
			this.gl.deleteProgram(program); // Clean up program if shader fails
			throw new Error(`Shader compilation failed: ${this.gl.getShaderInfoLog(shader)}`);
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
		if(this.postpocessor) gl.bindFramebuffer(gl.FRAMEBUFFER, this.postpocessor.frameBuffer);
		// Clear the drawing buffer
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	/** Finalizes frame drawing (renders postprocessing effect if active). @internal */
	drawEnd() : void {
		// If postprocessor exists, render its effect to the screen
		if(this.postpocessor) {
			this.postpocessor.render();
			// Re-bind the main program and buffers for subsequent Micrio rendering if needed
			this.gl.useProgram(this.program);
			this.linkBuffers();
		}
		if(this.wmTexture) this.drawWatermark();
	}

	/**
	 * Draws a single tile using the provided texture and opacity.
	 * Selects appropriate vertex/texture buffers based on whether it's a 360 tile.
	 * @param texture The WebGLTexture for the tile (or undefined for placeholder).
	 * @param opacity The opacity of the tile (0-1).
	 * @param is360 True if rendering a 360 tile.
	*/
	drawTile(texture?:WebGLTexture, opacity:number=1, is360:boolean=false) : void {
		// Set uniforms: noTexture flag and opacity
		this.gl.uniform1i(this.noTxtLoc, texture ? 0 : 1);
		this.gl.uniform1f(this.opaLoc, opacity);
		// Bind the texture if provided
		if(texture) {
			this.gl.activeTexture(this.gl.TEXTURE0); // Ensure texture unit 0 is active
			this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
			// TODO: Set sampler uniform (e.g., gl.uniform1i(samplerLoc, 0)) if not implicitly unit 0.
		}

		// Determine number of vertices based on 360 or standard quad
		const length = is360 ? 6 * Wasm.segsX * Wasm.segsY : 6;

		// If switching between 360 and standard rendering, re-buffer static texture coordinates
		if(is360 != this.was360) {
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.txtBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, is360 ? Wasm._textureBuffer360 : Wasm._textureBuffer, this.gl.STATIC_DRAW);
			// Re-bind geometry buffer (might not be strictly necessary but safer)
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.geomBuffer);
			this.was360 = is360; // Update state
		}

		// Update dynamic vertex buffer data from Wasm memory view
		this.gl.bufferData(this.gl.ARRAY_BUFFER, is360 ? this.micrio.wasm._vertexBuffer360 : this.micrio.wasm._vertexBuffer, this.gl.STATIC_DRAW); // TODO: Should this be DYNAMIC_DRAW?

		// Draw the geometry
		// For wireframe debugging:
		// this.gl.drawArrays(this.gl.LINE_STRIP, 0, length);
		this.gl.drawArrays(this.gl.TRIANGLES, 0, length); // Draw triangles

	}

	/**
	 * Loads a watermark texture from a URL.
	 * @param url The watermark image URL.
	 */
	loadWatermark(url: string, wmOpacity?:number) : void {
		if(url === this.wmUrl) return; // Already loaded/loading

		this.wmUrl = url;
		const img = new Image();
		if(wmOpacity) this.wmOpacity = wmOpacity;
		img.crossOrigin = 'anonymous';
		img.src = url;
		img.onload = () => {
			const c = document.createElement('canvas');
			c.width = watermarkTileSize;
			c.height = watermarkTileSize;
			const ctx = c.getContext('2d');
			if(!ctx) return;

			// Calculate dimensions to fit within bounds while maintaining aspect ratio
			const ratio = Math.min(watermarkMaxSizeW / img.width, watermarkMaxSizeH / img.height);
			const w = img.width * ratio;
			const h = img.height * ratio;

			// Draw centered
			ctx.drawImage(img, (watermarkTileSize - w) / 2, (watermarkTileSize - h) / 2, w, h);

			// Create texture from canvas
			if(this.wmTexture) this.gl.deleteTexture(this.wmTexture);
			this.wmTexture = this.getTexture(c); // getTexture supports HTMLCanvasElement

			// Configure repeating texture
			const gl = this.gl;
			gl.bindTexture(gl.TEXTURE_2D, this.wmTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			// Restore to null binding
			gl.bindTexture(gl.TEXTURE_2D, null);

			this.micrio.wasm.render();
		};
	}

	/**
	 * Draws a watermark on top of the canvas.
	 */
	private drawWatermark() : void {
		const gl = this.gl;

		if(!this.wmTexture) return;

		// Use program
		gl.useProgram(this.program);

		// Set blending function for watermark
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		// Set identity matrix for screen-space rendering
		gl.uniformMatrix4fv(this.pmLoc, false, this.wmMatrix);

		// Set texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.wmTexture);
		gl.uniform1i(this.noTxtLoc, 0);
		gl.uniform1f(this.opaLoc, this.wmOpacity); // Slight transparency

		// UVs (Repeated based on 512px tiling)
		const w = gl.drawingBufferWidth / watermarkTileSize;
		const h = gl.drawingBufferHeight / watermarkTileSize;
		
		// Update UVs directly
		const u = this.wmUvs;
		u[1] = h;
		u[2] = w; u[3] = h;
		u[8] = w; u[9] = h;
		u[10] = w;

		// Use geomBuffer for vertices
		gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.wmVerts, gl.DYNAMIC_DRAW);
		gl.vertexAttribPointer(this.posAttr, 3, gl.FLOAT, false, 0, 0);

		// Use wmTxtBuffer for UVs
		gl.bindBuffer(gl.ARRAY_BUFFER, this.wmTxtBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.wmUvs, gl.DYNAMIC_DRAW);
		gl.vertexAttribPointer(this.txtAttr, 2, gl.FLOAT, false, 0, 0);

		// Draw
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Restore state
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Restore default blending
		this.linkBuffers(); // Restores Wasm buffer bindings (standard quad)
		this.was360 = false; // Mark state as standard so next 360 draw triggers rebind
	}

}
