/** Minimal-build stub for `$book/main` — the 3D book viewer is excluded from the core build. */
export class BookViewer {
	readonly _ready: Promise<void> = Promise.resolve();

	constructor(..._args: unknown[]) {}

	goto(_pageIdx: number): Promise<void> {
		return Promise.resolve();
	}

	zoom(_delta: number): void {}

	isZoomedIn(): boolean {
		return false;
	}

	rotateView(_direction: 1 | -1): void {}

	_hookImageBook3d(_img: unknown): void {}
}
