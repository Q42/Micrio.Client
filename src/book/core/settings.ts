// ── Page geometry ──

/** Thickness of a single paper page in world-space units */
export const PAGE_THICKNESS = 0.0012;

/** Default page aspect ratio (height / width) — √2 ≅ A4 paper */
export const DEFAULT_ASPECT = Math.SQRT2;

/** Use each page's own aspect ratio from source images instead of the book-wide average */
export const USE_INDIVIDUAL_ASPECTS = false;

// ── Cover ──

/** Whether the first/last pages are rendered as hard covers */
export const HARD_COVER = false;

/** Cover thickness relative to a regular paper page */
export const COVER_THICKNESS_MULTIPLIER = 16;

/** Cover face scale relative to paper face (1.04 = 4% larger on width) */
export const COVER_SCALE_X = 1.04;

/** Cover face scale relative to paper face on height axis (1.08 = 8% taller) */
export const COVER_SCALE_Y = 1.08;

// ── Grid / mesh ──

/** Number of vertex columns in the paper/cover face grid */
export const GRID_COLS = 10;

/** Number of vertex rows in the paper/cover face grid */
export const GRID_ROWS = 14;

/** Total vertex count per face grid */
export const VERTEX_COUNT = GRID_COLS * GRID_ROWS;

// ── Page flip animation ──

/** Flip speed multiplier (1.0 = baseline, higher = faster flip) */
export const FLIP_SPEED = 0.6;

/** How far from the top edge to grab the corner during a flip (0.0 = top, 1.0 = bottom) */
export const GRAB_ROW = 0.35;

/** Maximum random offset added to GRAB_ROW each flip, to make the transition more natural */
export const GRAB_ROW_MAX_OFFSET = 0.12;

/** Tighter max random offset used during rapid .goto() flips for a more uniform look */
export const GOTO_GRAB_ROW_MAX_OFFSET = 0.02;

/** Peak arc height of the flipped corner above the rest position */
export const ARC_PEAK = 0.7;

/** Base duration (seconds) for a full page flip at speed 1.0 */
export const BASE_FLIP_DURATION = 0.6;

// ── XPBD physics solver ──

/** Number of constraint solver iterations per substep */
export const SOLVER_ITERATIONS = 64;

/** Number of physics substeps per frame */
export const SOLVER_SUBSTEPS = 3;

/** Distance constraint compliance (0.0 = perfectly stiff) */
export const DISTANCE_COMPLIANCE = 0.000;

/** Bending constraint compliance (lower = stiffer) */
export const BENDING_COMPLIANCE = 0.000041;

/** Velocity damping per substep (0.92 = 8% velocity loss per substep) */
export const DAMPING = 0.975;

/** Damping used during rapid .goto() page-flip cascades (higher = faster settling) */
export const GOTO_DAMPING = 0.995;

/** Gravitational acceleration in world-space units */
export const GRAVITY = 9.81;

/** Whether gravity is active */
export const GRAVITY_ENABLED = true;

/** Minimum vertex position delta to consider a page still "active" — below this it goes idle */
export const DELTA_IDLE_THRESHOLD = 1e-6;


// ── Visual / rendering ──

/** Margin around the book as a fraction of the smaller viewport dimension (0.05 = 5%) */
export const VIEWPORT_MARGIN_PCT = 0.05;

/** Default camera polar angle in radians (0 = side view, π/2 = directly overhead) */
export const DEFAULT_CAMERA_PHI = Math.PI * 0.42;

/** RGB tint for the front face of each page */
export const FRONT_COLOR: [number, number, number] = [0.96, 0.94, 0.91];

/** RGB tint for the back face of each page */
export const BACK_COLOR: [number, number, number] = [0.91, 0.88, 0.82];

// ── IIIF hi-res texture streaming ──

/** Base URL for IIIF image server */
export const IIIF_BASE_URL = 'https://iiif.micr.io';

/** Base debounce before starting a download for the currently viewed spread (ms) */
export const IIIF_DEBOUNCE_BASE_MS = 500;

/** Additional debounce per page distance from the spread center (ms) */
export const IIIF_DEBOUNCE_PER_DISTANCE_MS = 2000;

/** Duration of the cross-fade from low-res to hi-res texture (ms) */
export const IIIF_CROSSFADE_DURATION = 500;

/** Spreads away from the current spread before hi-res textures are pre-loaded */
export const IIIF_PRELOAD_DISTANCE = 1;

/** Spreads away from the current spread before hi-res textures are evicted from GPU */
export const IIIF_GPU_EVICT_DISTANCE = 5;

/** Default camera radius (used as baseline for zoom-aware IIIF resolution choice) */
export const DEFAULT_CAMERA_RADIUS = 2.2;

// ── Tilt-shift blur ──

/** Master toggle for the tilt-shift blur effect */
export const TILT_SHIFT_ENABLED = true;

/** Normalised screen-space Y coordinate of the in-focus band centre (0 = bottom, 1 = top) */
export const TILT_SHIFT_FOCUS_CENTER = 0.55;

/** Vertical height of the sharp in-focus band as a fraction of the viewport */
export const TILT_SHIFT_FOCUS_WIDTH = 0.25;

/** Maximum blur radius in screen pixels (applied at the furthest distance from the focus band) */
export const TILT_SHIFT_BLUR_RADIUS = 4;

/** Sharpness of the transition between in-focus and blurred regions (higher = sharper) */
export const TILT_SHIFT_BLUR_FALLOFF = 1.0;

// ── Lighting ──

/** Active lighting preset name. Available: 'daylight', 'incandescent', 'candlelight', 'rainy day', 'moonlight', 'fireplace', 'haunted' */
export const LIGHTING_PRESET = 'daylight';
