// Combined ModelViewProjection matrix from Engine
uniform mat4 GLMatrix;

// Vertex position (from Engine buffer)
attribute vec3 pos;
// Texture coordinate (from static buffer)
attribute vec2 aTextureCoord;

// Pass texture coordinate to fragment shader
varying highp vec2 vTextureCoord;

void main()
{
	// Calculate clip space position
	gl_Position = GLMatrix * vec4(pos, 1.0);
	// Pass through texture coordinate
	vTextureCoord = aTextureCoord;
}
