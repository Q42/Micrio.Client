/**
 * The WebGL rendering module
 * @author Marcel Duin <marcel@micr.io>
*/

import type { TextureBitmap } from './textures';
import type { HTMLMicrioElement } from './element';

import { Wasm } from './wasm';

/** Firefox has alternative fragment shader */
const isFirefox:boolean = /firefox/i.test(navigator.userAgent);

/** Internal vertex shader */
const vertexShader:string = `
uniform mat4 GLMatrix;

attribute vec3 pos;
attribute vec2 aTextureCoord;

varying highp vec2 vTextureCoord;

void main()
{
	gl_Position = GLMatrix * vec4(pos, 1.0);
	vTextureCoord = aTextureCoord;
}`;

/** Internal fragment shader */
const fragmentShader:string = `
precision mediump float;

varying highp vec2 vTextureCoord;

uniform sampler2D uSampler;
uniform float opacity;
uniform int noTexture;

void main() {
	if(noTexture==1) {
		gl_FragColor = vec4(.1,.1,.1,.1);
	} else {
	${isFirefox ? `
		vec4 textureColor = texture2D(uSampler, vTextureCoord);
		float newAlpha = min(1., textureColor.a * opacity);
		gl_FragColor = vec4(textureColor.rgb * newAlpha, newAlpha);` : `
		gl_FragColor = texture2D(uSampler, vTextureCoord) * opacity;` }
		//gl_FragColor = vec4(1.,0.,0.,1.);
	}
}`;

/** The WebAssembly class
 * @internal
*/
export class WebGL {
	/** The WebGL rendering context */
	gl!:WebGLRenderingContext;

	/** The output display */
	display:Window = self;

	/** The shader program */
	private program!:WebGLProgram;

	/** The opacity uniform location pointer */
	private opaLoc!:WebGLUniformLocation;

	/** The no texture bool uniform location pointer */
	private noTxtLoc!:WebGLUniformLocation;

	/** The GLMatrix uniform location pointer */
	pmLoc!:WebGLUniformLocation;

	/** The Sampler2D texture uniform location pointer */
	private txtAttr:number = -1;

	/** The texture buffer location pointer */
	private txtBuffer!:WebGLBuffer;

	/** The geometry buffer location pointer */
	private geomBuffer!:WebGLBuffer;

	/** The vertex position attribute location pointer */
	private posAttr:number = -1;

	/** Previous draw operation was 360 */
	private was360:boolean = false;

	/** Create the WebGL instance
	 * @param micrio The main <micr-io> instance
	*/
	constructor(
		private micrio:HTMLMicrioElement
	){ }

	/** Bind to a Micrio Wasm instance */
	init() : void {
		const hasGL2 = 'WebGL2RenderingContext' in window;
		const gl = this.micrio.canvas.element.getContext(hasGL2 ? 'webgl2' : 'webgl', {
			alpha: true,
			//'premultipliedAlpha': false,
			//preserveDrawingBuffer: s.fadeBetween,
			preserveDrawingBuffer: this.micrio.hasAttribute('data-preserve-drawing-buffer'),
			stencil: false,
			antialias: false,
			depth: false,
			desynchronized: false,
			powerPreference: 'high-performance'
		}) as WebGLRenderingContext;

		if(hasGL2 ? !(gl instanceof window.WebGL2RenderingContext)
			: !(gl instanceof window.WebGLRenderingContext))
			throw 'Error creating WebGL context. Does your browser support WebGL?';

		this.gl = gl;

		const program = gl.createProgram();
		if(!(program instanceof WebGLProgram))
			throw 'Could not compile shaders';

		this.program = program;

		this.getShader(this.program, gl.VERTEX_SHADER, vertexShader);
		this.getShader(this.program, gl.FRAGMENT_SHADER, fragmentShader);
		gl.linkProgram(this.program);
		gl.useProgram(this.program);

		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);

		gl.disable(gl.DEPTH_TEST);

		this.gl.clearColor(0, 0, 0, 0);

		// uniforms
		const opaLoc = gl.getUniformLocation(this.program, 'opacity');
		if(opaLoc) this.opaLoc = opaLoc;
		else throw 'Could not create opacity WebGL binding!';

		// perspective
		gl.useProgram(this.program);
		const pmLoc = gl.getUniformLocation(this.program, 'GLMatrix');
		if(pmLoc) this.pmLoc = pmLoc;
		else throw 'Could not create matrix WebGL binding!';

		const noTxtLoc = gl.getUniformLocation(this.program, 'noTexture');
		if(noTxtLoc) this.noTxtLoc = noTxtLoc;
		else throw 'Could not bind noTexture uniform'

		// Texture stuff
		this.txtAttr = gl.getAttribLocation(this.program, 'aTextureCoord');
		const txtBuffer = gl.createBuffer();
		if(txtBuffer) this.txtBuffer = txtBuffer;
		else throw 'Could not connect texture buffer';

		gl.bindBuffer(gl.ARRAY_BUFFER, this.txtBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, Wasm._textureBuffer, gl.STATIC_DRAW);

		gl.enableVertexAttribArray(this.txtAttr);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.txtBuffer);
		gl.vertexAttribPointer(this.txtAttr, 2, gl.FLOAT, false, 0, 0);

		// vertex buffer
		const geomBuffer = gl.createBuffer();
		if(geomBuffer) this.geomBuffer = geomBuffer;
		else throw 'Could not bind geometry buffer';

		this.posAttr = gl.getAttribLocation(this.program, 'pos');
		gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.micrio.wasm._vertexBuffer, gl.STATIC_DRAW);

		gl.enableVertexAttribArray(this.posAttr);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuffer);
		gl.vertexAttribPointer(this.posAttr, 3, gl.FLOAT, false, 0, 0);

		gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);

		//gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
	}

	/** Dispose the WebGL rendering context
	 * @param loseContext Also destroy the internal WebGL context
	*/
	dispose(loseContext:boolean=false ) : void {
		// Delete all textures
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.deleteBuffer(this.txtBuffer);
		gl.deleteBuffer(this.geomBuffer);
		if(loseContext) {
			const tryLose = gl.getExtension('WEBGL_lose_context');
			if(tryLose instanceof Object && tryLose['loseContext'] instanceof Function) tryLose['loseContext']();
		}
	}

	/** Get a compiled fragment or vertex shader
	 * @param program The shader program
	 * @param type The GL shader type
	 * @param source The shader source code
	*/
	private getShader(program:WebGLProgram, type:number, source:string) {
		const shader = this.gl.createShader(type);
		if(!shader) throw 'Could not create shader!';
		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);
		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			console.error('Error compiling shader', this.gl.getShaderInfoLog(shader));
			this.gl.deleteProgram(program);
			return;
		}
		this.gl.attachShader(program, shader);
		this.gl.deleteShader(shader);
	}

	/** Create a WebGL texture for an image
	 * @param img The source image
	 * @returns The texture pointer reference
	*/
	getTexture(img?: TextureBitmap, noSmoothing?: boolean) : WebGLTexture {
		const gl = this.gl;
		const t = gl.createTexture();
		if(!t) throw 'Could not create texture!';

		gl.bindTexture(gl.TEXTURE_2D, t);

		/*gl.pixelStorei(gl.PACK_ALIGNMENT, 8)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8)
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

		// GL2 only
		//gl.pixelStorei(gl.PACK_ROW_LENGTH, img.width);
		//gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, img.height);*/

		//gl.generateMipmap(gl.TEXTURE_2D);

		if(img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		if(noSmoothing) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		return t;
	}

	/** Update an existing texture with a new image (for video) */
	updateTexture(
		/** The texture pointer */
		texture:WebGLTexture,
		/** The updated image or video bitmap */
		img:TextureBitmap,
	) : void {
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
	}

	/** Start drawing a frame */
	drawStart() : void {
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	/** Draw a tile geometry
	 * @param texture The texture pointer
	 * @param opacity The texture opacity
	 * @param is360 Use the 360 render buffers
	*/
	drawTile(texture?:WebGLTexture, opacity:number=1, is360:boolean=false) : void {
		this.gl.uniform1i(this.noTxtLoc, texture ? 0 : 1);
		this.gl.uniform1f(this.opaLoc, opacity);
		if(texture) this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

		const length = is360 ? 6 * Wasm.segsX * Wasm.segsY : 6;

		if(is360 != this.was360) {
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.txtBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, is360 ? Wasm._textureBuffer360 : Wasm._textureBuffer, this.gl.STATIC_DRAW);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.geomBuffer);
			this.was360 = is360;
		}

		this.gl.bufferData(this.gl.ARRAY_BUFFER, is360 ? this.micrio.wasm._vertexBuffer360 : this.micrio.wasm._vertexBuffer, this.gl.STATIC_DRAW);

		// For wireframe
		//this.gl.drawArrays(this.gl.LINE_STRIP, 0, length);
		this.gl.drawArrays(this.gl.TRIANGLES, 0, length);

	}

}
