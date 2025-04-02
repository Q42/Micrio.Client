/**
 * Global constants used within the Wasm module, primarily for 360 rendering.
 */

/** Number of horizontal segments used for generating the 360 sphere geometry. */
export const segsX:u32 = 48;
/** Number of vertical segments used for generating the 360 sphere geometry. */
export const segsY:u32 = 24;
/** Base distance used in 360 space calculations, potentially related to camera distance or sphere radius scaling. */
export const base360Distance:f32 = 8;
