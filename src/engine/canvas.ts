/**
 * Minimal type stub for Canvas — required to resolve circular type imports.
 * The full implementation will be ported from src/wasm/canvas.ts in Phase 2.
 * @internal
 */

import { View, Viewport } from './shared';
import Camera from './camera';
import Ani from './camera.ani';
import Kinetic from './camera.kinetic';

export default class Canvas {
	readonly is360: boolean = false;
	readonly webgl!: any;
	readonly height: number = 0;
	readonly width: number = 0;
	readonly el!: Viewport;
	readonly currentArea!: View;
	readonly camera!: Camera;
	readonly ani!: Ani;
	readonly kinetic!: Kinetic;
	readonly view!: View;
	readonly freeMove: boolean = false;
	readonly coverLimit: boolean = false;
	readonly maxScale: number = 1;
	readonly noImage: boolean = false;
	readonly hasParent: boolean = false;
	readonly parent!: Canvas;
	readonly main!: any;
	readonly coverStart: boolean = false;
	readonly activeImageIdx: number = 0;
	readonly layer: number = 0;
	readonly images: any[] = [];
	readonly omniNumLayers: number = 1;
	readonly omniFieldOfView: number = 0;
	readonly omniDistance: number = 0;
	readonly omniOffsetX: number = 0;
	readonly omniVerticalAngle: number = 0;
	readonly aspect: number = 1;
	readonly scaleMultiplier: number = 1;
	readonly pinchZoomOutLimit: boolean = false;
	readonly camSpeed: number = 1;
	readonly focus!: { width: number; height: number };

	setView(..._args: any[]): void {}
	getScale(): number { return 1 }
	setActiveImage(..._args: any[]): void {}
	aniDone(): void {}
	aniAbort(): void {}
}
