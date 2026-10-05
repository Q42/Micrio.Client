/** Minimal-build stub for `$utils/archive` — MDP/.bin archive loading is excluded from the core build. */
export const archive = {
	db: new Map<string, unknown>(),
	_getImage(_u: string): Promise<never> {
		return Promise.reject(new Error('Archive loading is not available in the core build'));
	},
};
