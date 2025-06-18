import type { HTMLMicrioElement } from './element';

/**
 * Vertex data for a fullscreen quad used in postprocessing.
 * Format: [x, y, u, v]
 * @internal
 */
const quadVertices = new Float32Array([
	// x,    y,    u,  v
	-1.00, -1.00,   0.0, 0.0, // bottom-left
	 1.00, -1.00,   1.0, 0.0, // bottom-right
	-1.00,  1.00,   0.0, 1.0, // top-left
	 1.00,  1.00,   1.0, 1.0  // top-right
]);

/**
 * Simple vertex shader for drawing a fullscreen quad.
 * Passes through position and texture coordinates.
 * @internal
 */
const vertexShader = `
attribute vec2 a_position; // Vertex position (-1 to 1)
attribute vec2 a_texCoord; // Texture coordinate (0 to 1)

varying vec2 v_texCoord; // Pass texCoord to fragment shader

void main() {
	v_texCoord = a_texCoord; // Pass through texture coordinate
	gl_Position = vec4(a_position, 0.0, 1.0); // Set clip space position
}`;

/**
 * Handles WebGL postprocessing effects.
 * Sets up a framebuffer to render the main scene to a texture,
 * then renders a fullscreen quad using that texture and a custom fragment shader
 * to apply effects like bloom, vignette, etc.
 */
export class PostProcessor {
	/** Framebuffer object used as the render target for the main scene. */
	frameBuffer:WebGLFramebuffer;

	/** Texture attached to the framebuffer where the main scene is rendered. @internal */
	private texture:WebGLTexture;

	/** WebGLBuffer holding the vertex data for the fullscreen quad. @internal */
	private quad: WebGLBuffer;

	/** The compiled WebGL shader program for the postprocessing effect. @internal */
	private program:WebGLProgram;
	/** Attribute location for vertex positions in the postprocessing shader. @internal */
	private ppPositionLoc:GLint;
	/** Attribute location for texture coordinates in the postprocessing shader. @internal */
	private ppTexCoordLoc:GLint;
	/** Uniform location for passing time to the postprocessing shader. @internal */
	private ppTimeLoc:WebGLUniformLocation;

	/**
	 * Creates a PostProcessor instance.
	 * Compiles the shaders, creates the framebuffer and texture, and sets up attributes/uniforms.
	 * @param gl The WebGL rendering context.
	 * @param micrio The main HTMLMicrioElement instance (used for WebGL utilities).
	 * @param fragmentShader The source code for the custom fragment shader implementing the effect.
	 */
	constructor(
		private gl:WebGL2RenderingContext|WebGLRenderingContext,
		micrio:HTMLMicrioElement,
		fragmentShader:string
	) {
		// --- Shader Compilation ---
		this.program = gl.createProgram()!; // TODO: Handle potential null return
		// Compile vertex and fragment shaders using WebGL utility
		micrio.webgl.getShader(this.program, gl.VERTEX_SHADER, vertexShader);
		micrio.webgl.getShader(this.program, gl.FRAGMENT_SHADER, fragmentShader);

		// Link and use the program
		gl.linkProgram(this.program);
		if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
			console.error("Postprocess shader link error:", gl.getProgramInfoLog(this.program));
			// TODO: Handle shader link error more gracefully
		}
		gl.useProgram(this.program);

		// --- Get Attribute/Uniform Locations ---
		this.ppPositionLoc = gl.getAttribLocation(this.program, 'a_position');
		this.ppTexCoordLoc = gl.getAttribLocation(this.program, 'a_texCoord');
		this.ppTimeLoc = gl.getUniformLocation(this.program, 'u_time')!; // Assume 'u_time' uniform exists

		// --- Framebuffer Texture Setup ---
		this.texture = gl.createTexture()!; // TODO: Handle potential null return
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		// Create texture matching the drawing buffer size
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

		// Set texture parameters (linear filtering, clamp to edge)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		// --- Framebuffer Setup ---
		this.frameBuffer = gl.createFramebuffer()!; // TODO: Handle potential null return
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
		// Attach the texture as the color attachment
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			this.texture,
			0 // Mipmap level
		);

		// Check if framebuffer is complete
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error('Framebuffer not complete'); // Throw error if setup failed
		}

		// Unbind the framebuffer (will be bound before rendering the main scene)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		// --- Quad Buffer Setup ---
		this.quad = gl.createBuffer()!; // TODO: Handle potential null return
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
		gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW); // Upload quad vertex data
	}

	/**
	 * Renders the postprocessing effect.
	 * Binds the postprocessing shader, sets up attributes, binds the scene texture,
	 * passes uniforms (like time), and draws the fullscreen quad.
	 * Assumes the main scene has already been rendered to this instance's framebuffer.
	 */
	render() : void {
		const gl = this.gl;

		// Bind the default framebuffer (null) to render to the screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		// Use the postprocessing shader program
		gl.useProgram(this.program);

		// Bind the quad vertex buffer
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);

		// --- Set Vertex Attributes ---
		// Position attribute
		gl.enableVertexAttribArray(this.ppPositionLoc);
		gl.vertexAttribPointer(
			this.ppPositionLoc, // location
			2, // size (num components per iteration)
			gl.FLOAT, // type
			false, // normalize
			4 * Float32Array.BYTES_PER_ELEMENT, // stride (bytes per vertex)
			0 // offset (bytes from start of buffer)
		);
		// Texture Coordinate attribute
		gl.enableVertexAttribArray(this.ppTexCoordLoc);
		gl.vertexAttribPointer(
			this.ppTexCoordLoc, // location
			2, // size
			gl.FLOAT, // type
			false, // normalize
			4 * Float32Array.BYTES_PER_ELEMENT, // stride
			2 * Float32Array.BYTES_PER_ELEMENT // offset (after position data)
		);

		// --- Set Uniforms & Texture ---
		// Bind the texture containing the rendered main scene
		gl.activeTexture(gl.TEXTURE0); // Use texture unit 0
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		// TODO: Should probably set a texture uniform in the shader (e.g., u_sceneTexture) and bind it to unit 0. Assuming shader implicitly uses texture unit 0.
		// Pass current time to the shader (useful for animated effects)
		gl.uniform1f(this.ppTimeLoc, performance.now() / 1000);

		// --- Draw the Quad ---
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // Draw the quad (4 vertices)
	}

	/**
	 * Resizes the framebuffer texture when the canvas size changes.
	 */
	resize() {
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		// Recreate the texture with the new drawing buffer dimensions
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		// Unbind texture (good practice)
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	/** Disposes WebGL resources used by the PostProcessor. */
	dispose() : void {
		const gl = this.gl;
		gl.deleteFramebuffer(this.frameBuffer);
		gl.deleteTexture(this.texture);
		gl.deleteBuffer(this.quad);
		gl.deleteProgram(this.program);
	}
}
