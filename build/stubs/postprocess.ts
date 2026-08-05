/** Minimal-build stub for `$render/postprocess` — WebGL postprocessing is excluded from the core build. */
export class PostProcessor {
	/** Default framebuffer (null) so `_drawStart` binds the screen instead of a postprocess target. */
	_frameBuffer = null;

	constructor(..._args: unknown[]) {}

	_render(): void {}

	_resize(): void {}

	_dispose(): void {}
}
