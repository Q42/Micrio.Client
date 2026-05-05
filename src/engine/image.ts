/**
 * Minimal type stub for Image — required to resolve circular type imports.
 * The full implementation will be ported from src/wasm/image.ts in Phase 2.
 * @internal
 */

import type Canvas from './canvas';

export default class Image {
	readonly index: number = 0;
	readonly localIdx: number = 0;
	readonly width: number = 0;
	readonly height: number = 0;
	readonly tileSize: number = 0;
	readonly isSingle: boolean = false;
	readonly isVideo: boolean = false;
	readonly startOffset: number = 0;
	readonly canvas!: Canvas;
}
