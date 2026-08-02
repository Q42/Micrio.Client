// Use medium precision for fragment calculations
precision mediump float;

// Received texture coordinate from vertex shader
varying highp vec2 vTextureCoord;

// The tile texture
uniform sampler2D uSampler;
// Tile opacity (for fading)
uniform float opacity;
// Flag indicating if texture is missing/not loaded
uniform int noTexture;

void main() {
	// If texture is missing
	if(noTexture==1) {
		// Draw a placeholder color (dark semi-transparent gray)
		gl_FragColor = vec4(.1,.1,.1,.1);
	} else {
		// Standard alpha blending (premultiplied alpha assumed in blendFunc)
		gl_FragColor = texture2D(uSampler, vTextureCoord) * opacity;
	}
}
