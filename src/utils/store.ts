/**
 * Svelte store utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Readable, Unsubscriber } from '$core/store';

/**
 * Returns a Promise that resolves once a readable store's value meets criteria.
 * @internal
 */
export const once = <T = any>(s: Readable<T>, opts: {
	targetValue?: any;
	allowUndefined?: boolean;
} = {}): Promise<T> => new Promise(ok => {
	let initial = true;
	let resolved = false;
	let unsub: Unsubscriber;
	unsub = s.subscribe(v => {
		if (initial && v === undefined && opts.allowUndefined) return;
		initial = false;
		const hasTarget = 'targetValue' in opts;
		if (hasTarget ? v === opts.targetValue : (opts.allowUndefined || v !== undefined)) {
			resolved = true;
			ok(v);
		}
	});
	if (resolved) unsub();
});

