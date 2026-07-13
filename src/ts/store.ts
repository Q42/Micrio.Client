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
			if (Object.is(value, v)) return;
			value = v;
			subs.forEach(fn => fn(v));
		},
		update(fn: Updater<T>) {
			const next = fn(value as T);
			if (Object.is(value, next)) return;
			value = next;
			subs.forEach(fn => fn(next));
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

export type { Subscriber, Unsubscriber, Updater };
