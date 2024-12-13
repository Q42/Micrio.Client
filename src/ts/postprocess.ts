import type { HTMLMicrioElement } from './element';

const quadVertices = new Float32Array([
	// x,    y,    u,  v
	-1.00, -1.00,   0.0, 0.0,
	 1.00, -1.00,   1.0, 0.0,
	-1.00,  1.00,   0.0, 1.0,
	 1.00,  1.00,   1.0, 1.0
]);

const vertexShader = `
attribute vec2 a_position;
attribute vec2 a_texCoord;

varying vec2 v_texCoord;

void main() {
	v_texCoord = a_texCoord;
	gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export class PostProcessor {
	/** Framebuffer render target for postprocessing */
	frameBuffer:WebGLFramebuffer;

	/** Frame buffer render-to-texture */
	private texture:WebGLTexture;

	/** Quad buffer for frameBuffer */
	private quad: WebGLBuffer;

	/** Post processing shader */
	private program:WebGLProgram;
	private ppPositionLoc:GLint;
	private ppTexCoordLoc:GLint;
	private ppTimeLoc:WebGLUniformLocation;

	constructor(
		private gl:WebGL2RenderingContext|WebGLRenderingContext,
		micrio:HTMLMicrioElement,
		fragmentShader:string
	) {
		// Compile shader
		this.program = gl.createProgram();
		micrio.webgl.getShader(this.program, gl.VERTEX_SHADER, vertexShader);
		micrio.webgl.getShader(this.program, gl.FRAGMENT_SHADER, fragmentShader);

		gl.linkProgram(this.program);
		gl.useProgram(this.program);

		// Enable and set attributes
		this.ppPositionLoc = gl.getAttribLocation(this.program, 'a_position');
		this.ppTexCoordLoc = gl.getAttribLocation(this.program, 'a_texCoord');
		this.ppTimeLoc = gl.getUniformLocation(this.program, 'u_time')!;

		// Create texture
		this.texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, innerWidth, innerHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

		// Set texture parameters
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		// Create a framebuffer and attach the texture
		this.frameBuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			this.texture,
			0
		);

		// Check framebuffer status
		if (!this.frameBuffer || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error('Framebuffer not complete')
		}

		// Unbind the framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		// Create the quad frame buffer
		this.quad = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
		gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
	}

	render() : void {
		const gl = this.gl;

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		gl.useProgram(this.program);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);

		// Position attribute
		gl.enableVertexAttribArray(this.ppPositionLoc);
		gl.vertexAttribPointer(this.ppPositionLoc, 2, gl.FLOAT, false, 4 * Float32Array.BYTES_PER_ELEMENT, 0);
		// TexCoord attribute
		gl.enableVertexAttribArray(this.ppTexCoordLoc);
		gl.vertexAttribPointer(this.ppTexCoordLoc, 2, gl.FLOAT, false, 4 * Float32Array.BYTES_PER_ELEMENT, 2 * Float32Array.BYTES_PER_ELEMENT);

		// Bind the rendered scene texture as input
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.uniform1f(this.ppTimeLoc, performance.now() / 1000);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}
}
