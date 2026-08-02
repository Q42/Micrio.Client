#version 300 es
precision highp float;

// ── Paper Mesh Fragment Shader (WebGL2) ──
// Two-sided paper shading with Lambertian diffuse + Blinn-Phong specular
// Supports directional + up to 8 point lights
// Single-letter rename (originals in comments):
//   varyings: vWorldPos → X, vWorldNormal → Y, vTexCoord → Z
//   uniforms: uLightDir → A, uAmbientColor → B, uLightColor → C, uFrontColor → D,
//     uBackColor → E, uFrontTexture → F, uBackTexture → G, uFrontHiResA → H,
//     uFrontHiResB → I, uBackHiResA → J, uBackHiResB → K, uFrontBlendA → L,
//     uFrontBlendB → M, uBackBlendA → N, uBackBlendB → O, uNumPointLights → P,
//     uPointLightPos → Q, uPointLightColor → R, uPointLightIntensity → S,
//     uFrontRegion → T, uBackRegion → U

#define MAX_POINT_LIGHTS 8

in vec3 X; // vWorldPos
in vec3 Y; // vWorldNormal
in vec2 Z; // vTexCoord

uniform vec3 A; // uLightDir
uniform vec3 B; // uAmbientColor
uniform vec3 C; // uLightColor
uniform vec3 D; // uFrontColor
uniform vec3 E; // uBackColor
uniform sampler2D F; // uFrontTexture
uniform sampler2D G; // uBackTexture
uniform sampler2D H; // uFrontHiResA
uniform sampler2D I; // uFrontHiResB
uniform sampler2D J; // uBackHiResA
uniform sampler2D K; // uBackHiResB
uniform float L; // uFrontBlendA
uniform float M; // uFrontBlendB
uniform float N; // uBackBlendA
uniform float O; // uBackBlendB

uniform int P; // uNumPointLights
uniform vec3 Q[MAX_POINT_LIGHTS]; // uPointLightPos
uniform vec3 R[MAX_POINT_LIGHTS]; // uPointLightColor
uniform float S[MAX_POINT_LIGHTS]; // uPointLightIntensity

uniform vec4 T; // uFrontRegion (uMin, vMin, fU, fV) — sub-rectangle of the page UV space the front texture occupies
uniform vec4 U; // uBackRegion

out vec4 o; // fragColor

void main() {
  vec3 v = vec3(0.0, 0.70710678, 0.70710678); // V: view direction, normalized (0,1,1)

  vec3 n = normalize(Y); // N: world normal
  if (dot(n, v) < 0.0) n = -n;

  // Each texture only occupies a sub-rectangle of the page UV space (region);
  // outside it the fragment is transparent. `c0` is the page UV in the face's
  // sampled coordinate space (mirrored on back faces), `q` the region-mapped
  // texture coordinate, `m` a coverage mask that is 1 across the whole page
  // when the region spans it entirely.
  vec4 reg; // region (uMin, vMin, fU, fV)
  vec2 c0; // page UV (sampled space)
  if (gl_FrontFacing) {
    c0 = Z;
    reg = T;
  } else {
    c0 = vec2(1.0 - Z.x, Z.y);
    reg = U;
  }
  float mask = 1.0;
  if (reg.x > 0.0 || reg.y > 0.0 || reg.z < 1.0 || reg.w < 1.0) {
    vec2 lo = (c0 - reg.xy) / reg.zw;
    vec2 hi = (reg.xy + reg.zw - c0) / reg.zw;
    // Region edges that coincide with the page edge (the spine, flush to the
    // image) stay fully opaque; interior edges anti-alias.
    mask =
      (reg.x > 0.0         ? smoothstep(0.0, 0.004, lo.x) : 1.0)
    * (reg.x + reg.z < 1.0 ? smoothstep(0.0, 0.004, hi.x) : 1.0)
    * (reg.y > 0.0         ? smoothstep(0.0, 0.004, lo.y) : 1.0)
    * (reg.y + reg.w < 1.0 ? smoothstep(0.0, 0.004, hi.y) : 1.0);
  }
  vec2 q = vec2((c0.x - reg.x) / reg.z, (c0.y - reg.y) / reg.w);

  // Choose base color and texture based on face (blend low-res ↔ A ↔ B hi-res)
  vec4 x; // texColor
  vec3 b; // baseColor
  if (gl_FrontFacing) {
    vec4 f = texture(F, q); // lowTex
    vec4 i = texture(H, q); // hiTexA
    vec4 j = texture(I, q); // hiTexB
    float k = clamp(L + M, 0.0, 1.0); // blend
    float r = k > 0.0 ? M / k : 0.0; // bFrac
    vec4 p = mix(i, j, r); // hiTex
    x = mix(f, p, k * p.a);
    b = D;
  } else {
    vec4 f = texture(G, q); // lowTex
    vec4 i = texture(J, q); // hiTexA
    vec4 j = texture(K, q); // hiTexB
    float k = clamp(N + O, 0.0, 1.0); // blend
    float r = k > 0.0 ? O / k : 0.0; // bFrac
    vec4 p = mix(i, j, r); // hiTex
    x = mix(f, p, k * p.a);
    b = E;
  }

  x.a *= mask; // fade the texture (and thus the paper it covers) out at the region edge
  vec3 g = mix(b, x.rgb * b, x.a); // surfaceColor

  // Ambient
  vec3 c = B * g; // color

  // ── Directional light (Lambertian diffuse + Blinn-Phong specular) ──
  vec3 l = normalize(A); // L: light direction
  float d = max(dot(n, l), 0.0); // NdotL
  vec3 h = normalize(l + v); // H: half vector
  float m = max(dot(n, h), 0.0); // specNdotH
  float s = m * m; // specular
  s *= s;
  s *= s; // ^8
  c += C * g * d * 0.82;
  c += C * s * 0.04;

  // ── Point lights ──
  for (int e = 0; e < MAX_POINT_LIGHTS; e++) {
    if (e < P) {
      vec3 t = Q[e] - X; // toLight
      float u = dot(t, t); // toLightSq
      float q = S[e] / (1.0 + 0.08 * u); // attenuation

      vec3 r = t * inversesqrt(u); // PL

      float f = max(dot(n, r), 0.0); // PL_NdotL
      vec3 i = normalize(r + v); // PL_H
      float j = max(dot(n, i), 0.0); // PL_spec
      j *= j;
      j *= j;
      j *= j; // ^8

      c += R[e] * g * f * q * 0.68;
      c += R[e] * j * q * 0.03;
    }
  }

  // Subtle edge darkening for visual depth (fresnel)
  float a = abs(dot(n, v)); // NdotV
  float w = 1.0 - a; // f
  float y = w * w * w; // fresnel ^3
  c = mix(c, c * 0.85, y * 0.3);

  o = vec4(c * mask, mask); // premultiplied alpha: transparent where the texture doesn't reach
}
