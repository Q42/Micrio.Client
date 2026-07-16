type Subscriber<T> = (value: T) => void;
type Unsubscriber = () => void;
type Updater<T> = (value: T) => T;

export interface Readable<T> {
	subscribe(this: void, run: Subscriber<T>, invalidate?: (value?: T) => void): Unsubscriber;
}

export interface Writable<T> extends Readable<T> {
	set(value: T): void;
	update(fn: Updater<T>): void;
}

export function writable<T>(value?: T): Writable<T> {
	const subs = new Set<Subscriber<T>>();

	return {
		subscribe(run: Subscriber<T>, _invalidate?: (value?: T) => void): Unsubscriber {
			subs.add(run);
			run(value as T);
			return () => subs.delete(run);
		},
		set(v: T) {
			value = v;
			subs.forEach(fn => fn(v));
		},
		update(fn: Updater<T>) {
			this.set(fn(value as T));
		}
	};
}

export function readable<T>(value?: T, start?: (set: Subscriber<T>) => Unsubscriber | void): Readable<T> {
	let stop: Unsubscriber | void;

	const subs = new Set<Subscriber<T>>();

	return {
		subscribe(run: Subscriber<T>, _invalidate?: (value?: T) => void): Unsubscriber {
			subs.add(run);
			if (value !== undefined) run(value);

			if (subs.size === 1) {
				stop = start?.(v => {
					value = v;
					subs.forEach(fn => fn(v));
				});
			}

			return () => {
				subs.delete(run);
				if (subs.size === 0 && stop) {
					stop();
					stop = undefined;
				}
			};
		}
	};
}

export function get<T>(store: { subscribe(fn: Subscriber<T>): Unsubscriber }): T {
	let v: T | undefined;
	const unsub = store.subscribe(val => { v = val; });
	unsub();
	return v as T;
}

export function tick(): Promise<void> {
	return Promise.resolve();
}

/** Wraps a subscriber so rapid successive calls coalesce into one via microtask */
export function defer<T>(fn: Subscriber<T>): Subscriber<T> {
	let pending = false;
	let last: T;
	return (v: T) => {
		last = v;
		if (pending) return;
		pending = true;
		Promise.resolve().then(() => {
			pending = false;
			fn(last);
		});
	};
}

/** Wraps a subscriber to skip the very first emission (for onMount where initial state is handled manually) */
export function skipFirst<T>(fn: Subscriber<T>): Subscriber<T> {
	let first = true;
	return (v: T) => {
		if (first) { first = false; return; }
		fn(v);
	};
}

/** Combines skipFirst + defer: skip initial emission, then coalesce rapid subsequent calls */
export function lazy<T>(fn: Subscriber<T>): Subscriber<T> {
	return defer(skipFirst(fn));
}

export type { Subscriber, Unsubscriber, Updater };
