#version 300 es
precision highp float;

// ── Tilt-Shift Fullscreen Quad Vertex Shader (WebGL2) ──
// Single-letter rename: inPosition → a, vTexCoord → X

in vec2 a; // inPosition

out vec2 X; // vTexCoord

void main() {
  gl_Position = vec4(a, 0.0, 1.0);
  X = a * 0.5 + 0.5;
}
