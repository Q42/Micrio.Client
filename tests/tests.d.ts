/**
 * Ambient globals injected by the Micrio build (see `vite.config.js` `define`).
 * Declared project-wide so test files and config files can be type-checked
 * independently of the source files that read them.
 */

declare const __VERSION__: string
declare const __CORE__: boolean

/** Vite's `.css` / `.glsl` module shape, for tests that import style-free modules. */
declare module '*.css' {
	const content: string
	export default content
}

declare module '*.glsl' {
	const content: string
	export default content
}

declare module '*.glsl?raw' {
	const content: string
	export default content
}
