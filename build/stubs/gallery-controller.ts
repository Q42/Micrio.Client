/** Minimal-build stub for `$gallery/controller` — gallery/album controllers are excluded from the core build. */
export class Gallery {
	static _fromBundles(_items: unknown, _engine: unknown, _config: unknown): Gallery | null {
		return null
	}

	static _fromIIIF(_resp: unknown, _engine: unknown): Gallery | null {
		return null
	}

	static _fromAlbum(_albumId: unknown, _engine: unknown, _opts?: unknown): Promise<Gallery | null> {
		return Promise.resolve(null)
	}

	get images(): readonly unknown[] {
		return []
	}

	getImage(_id: unknown): undefined {
		return undefined
	}

	_openOn(_micrio: unknown): Promise<void> {
		return Promise.resolve()
	}

	_attach(_parent: unknown): void {}

	gotoId(_id: unknown): Promise<unknown> {
		return Promise.resolve()
	}
}
