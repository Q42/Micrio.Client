// Vertex position (-1 to 1)
attribute vec2 a_position;
// Texture coordinate (0 to 1)
attribute vec2 a_texCoord;

// Pass texCoord to fragment shader
varying vec2 v_texCoord;

void main() {
	// Pass through texture coordinate
	v_texCoord = a_texCoord;
	// Set clip space position
	gl_Position = vec4(a_position, 0.0, 1.0);
}
