#version 300 es
precision highp float;

// ── Paper Mesh Vertex Shader (WebGL2) ──
// Single-letter rename (originals in comments):
//   inPosition → b, inNormal → c, inTexCoord → d
//   uViewProj → a
//   vWorldPos → X, vWorldNormal → Y, vTexCoord → Z

layout(location = 0) in vec3 b; // inPosition
layout(location = 1) in vec3 c; // inNormal
layout(location = 2) in vec2 d; // inTexCoord

uniform mat4 a; // uViewProj

out vec3 X; // vWorldPos
out vec3 Y; // vWorldNormal
out vec2 Z; // vTexCoord

void main() {
  vec4 w = vec4(b, 1.0); // worldPos
  gl_Position = a * w;
  X = b;
  Y = c;
  Z = d;
}
