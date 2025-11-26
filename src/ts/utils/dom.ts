/**
 * DOM and general utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Returns a Promise that resolves after a specified number of milliseconds.
 * @internal
 * @param ms The number of milliseconds to wait. If 0, resolves immediately.
 */
export const sleep = (ms: number) => new Promise<void>(ok => ms ? setTimeout(ok, ms) : ok());

/**
 * Svelte hack to disable attribute type checking warnings in the editor/language server.
 * @internal
 * @param x Any value.
 * @returns The same value, but typed as `unknown`.
 */
export const notypecheck = <T>(x: T): T => x;

/** List of script URLs already loaded or currently loading. @private */
const loaded: string[] = [];

/**
 * Loads an external JavaScript file dynamically. Ensures scripts are loaded only once per session.
 * @internal
 * @param src The URL of the script to load.
 * @param cbFunc Optional global callback function name to be called upon script load.
 * @param targetObj Optional target object (if provided, assumes script is already loaded).
 * @returns A Promise that resolves when the script is loaded, or rejects on error.
 */
export const loadScript = (src: string, cbFunc?: string, targetObj?: unknown) => new Promise<void>((ok, err) => {
	if (targetObj || loaded.includes(src)) return ok(); // Already loaded or target exists
	const script = document.createElement('script');
	const onload = () => { loaded.push(src); ok(); }; // Mark as loaded and resolve promise
	if (cbFunc) (self as unknown as Record<string, () => void>)[cbFunc] = onload; // Assign global callback if provided
	else script.onload = onload; // Use standard onload otherwise
	script.onerror = () => err && err(); // Reject on error
	script.async = true;
	script.defer = true;
	if (self.crossOriginIsolated) script.crossOrigin = 'anonymous'; // Set crossOrigin for isolated environments
	script.src = src;
	document.head.appendChild(script);
});

