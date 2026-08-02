#version 300 es
precision highp float;

// ── Separable Gaussian Blur — Horizontal Pass ──
// 15-tap 1D gaussian blur along X at a uniform maximum blur radius.
// The resulting horizontally-blurred image is used by the vertical pass
// where per-pixel mixing with the sharp original creates the tilt-shift effect.
// Single-letter rename (originals in comments):
//   vTexCoord → X, uSceneTex → A, uTexelSize → B, uBlurRadius → C, uWeights → D
//   locals: sigma → s, step → t, result → r, offset → d, loop i → e

in vec2 X; // vTexCoord

uniform sampler2D A; // uSceneTex
uniform vec2 B; // uTexelSize
uniform float C; // uBlurRadius
uniform float D[15]; // uWeights

out vec4 o; // fragColor

void main() {
  float s = C; // sigma
  float t = s * 0.5; // step

  vec4 r = vec4(0.0); // result

  for (int e = -7; e <= 7; e++) {
    float d = float(e) * t; // offset
    r += texture(A, X + vec2(B.x * d, 0.0)) * D[e + 7];
  }

  o = r;
}
