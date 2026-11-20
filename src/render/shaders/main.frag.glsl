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

// Screen-space alpha mask (the SOG overlay in hybrid mode). Sampling through
// gl_FragCoord keeps the mask aligned with the canvas, not with the tile.
uniform sampler2D uMask;
// Pixel size of the mask source.
uniform vec2 uMaskSize;
// 1 while the mask is active.
uniform int maskEnabled;

void main() {
	// The mask cuts the photograph's background away: its alpha is the SOG's
	// silhouette (premultiplied, so multiplying the whole fragment is correct).
	float mask = 1.0;
	if (maskEnabled == 1) {
		mask = texture2D(uMask, vec2(gl_FragCoord.x / uMaskSize.x, 1.0 - gl_FragCoord.y / uMaskSize.y)).a;
	}
	// If texture is missing
	if(noTexture==1) {
		// Draw a placeholder color (dark semi-transparent gray), faded with the tile so a
		// spread swipe's page backdrop does not stay at full strength while the page fades.
		gl_FragColor = vec4(.1,.1,.1,.1) * opacity * mask;
	} else {
		// Standard alpha blending (premultiplied alpha assumed in blendFunc)
		gl_FragColor = texture2D(uSampler, vTextureCoord) * opacity * mask;
	}
}
