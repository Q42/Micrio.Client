/**
 * Svelte store utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Readable, Unsubscriber } from 'svelte/store';
import { tick } from 'svelte';

/**
 * Returns a Promise that resolves once a Svelte store's value meets certain criteria.
 * Useful for waiting until a store is initialized or reaches a specific state.
 * @internal
 * @template T The type of the store value.
 * @param s The readable Svelte store to subscribe to.
 * @param opts Options:
 *   - `targetValue`: Resolve only when the store value strictly equals this value.
 *   - `allowUndefined`: If true, resolves even if the initial value is undefined (useful for stores starting as undefined).
 * @returns A Promise that resolves with the store's value when the condition is met.
 */
export const once = <T = any>(s: Readable<T>, opts: {
	targetValue?: any;
	allowUndefined?: boolean;
} = {}): Promise<T> => new Promise(ok => {
	let initial: boolean = true; // Flag to handle initial subscription value
	let unsub: Unsubscriber; unsub = s.subscribe(v => {
		// Special handling for stores starting as undefined when allowUndefined is true
		if (initial && opts.allowUndefined && v === undefined) return;
		initial = false;
		// Check if value matches target or is simply defined (based on options)
		if (opts.targetValue !== undefined ? v === opts.targetValue : (opts.allowUndefined || (v !== undefined))) {
			// Unsubscribe and resolve
			if (unsub) unsub(); else tick().then(() => unsub()); ok(v);
		}
	});
});

/**
 * Returns a Promise that resolves once a Svelte store's value becomes undefined.
 * Useful for waiting until a state is cleared.
 * @internal
 * @template T The type of the store value.
 * @param s The readable Svelte store to subscribe to.
 * @returns A Promise that resolves with the store's value (undefined) when it becomes undefined.
 */
export const after = <T = any>(s: Readable<T>): Promise<T> => new Promise(ok => {
	let unsub: Unsubscriber; unsub = s.subscribe(v => {
		if (v == undefined) { // Check for undefined
			// Unsubscribe and resolve
			if (unsub) unsub(); else tick().then(() => unsub()); ok(v);
		}
	});
});

