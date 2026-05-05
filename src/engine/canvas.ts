/**
 * Minimal type stub for Canvas — required to resolve circular type imports.
 * The full implementation will be ported from src/wasm/canvas.ts in Phase 2.
 * @internal
 */

import { View, Viewport } from './shared';

export default class Canvas {
	readonly is360: boolean = false;
	readonly webgl!: any;
	readonly height: number = 0;
	readonly width: number = 0;
	readonly el!: Viewport;
	readonly currentArea!: View;
	readonly camera!: any;
	readonly freeMove: boolean = false;
	readonly coverLimit: boolean = false;
	readonly maxScale: number = 1;
	readonly noImage: boolean = false;
	readonly hasParent: boolean = false;
	readonly parent!: Canvas;
	readonly main!: any;
}
