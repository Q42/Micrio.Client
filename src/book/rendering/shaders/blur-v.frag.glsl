#version 300 es
precision highp float;

// ── Separable Gaussian Blur — Vertical Pass + Composite ──
// 15-tap 1D gaussian blur along Y at a uniform maximum blur radius,
// then mixes the result with the original sharp image based on per-pixel
// distance from the focus band.
// Single-letter rename (originals in comments):
//   vTexCoord → X, uBlurTex → A, uSharpTex → B, uTexelSize → C,
//   uFocusCenter → D, uFocusWidth → E, uBlurRadius → F, uBlurFalloff → G, uWeights → H
//   locals: dist → d, halfW → h, blurFactor → b, sigma → s, step → t,
//     result → r, offset → p, loop i → e, blurred → u, sharp → g

in vec2 X; // vTexCoord

uniform sampler2D A; // uBlurTex
uniform sampler2D B; // uSharpTex
uniform vec2 C; // uTexelSize
uniform float D; // uFocusCenter
uniform float E; // uFocusWidth
uniform float F; // uBlurRadius
uniform float G; // uBlurFalloff
uniform float H[15]; // uWeights

out vec4 o; // fragColor

void main() {
  float d = abs(X.y - D); // dist
  float h = E * 0.5; // halfW
  float b = smoothstep(h, h + 0.5 / max(G, 0.1), d); // blurFactor

  if (b < 0.002) {
    o = texture(B, X);
    return;
  }

  float s = F; // sigma
  float t = s * 0.5; // step

  vec4 r = vec4(0.0); // result

  for (int e = -7; e <= 7; e++) {
    float p = float(e) * t; // offset
    r += texture(A, X + vec2(0.0, C.y * p)) * H[e + 7];
  }

  vec4 u = r; // blurred
  vec4 g = texture(B, X); // sharp
  o = mix(g, u, b);
}
