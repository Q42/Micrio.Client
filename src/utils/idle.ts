export interface IdleStateOptions {
	/** Delay in ms before entering idle (default 2000). */
	delay?: number;
	/** Called when entering idle — `data-idle` is about to be set. */
	onIdle?: () => void;
	/** Called when leaving idle — `data-idle` is about to be removed. */
	onActive?: () => void;
	/**
	 * Optional guard — return `false` to postpone entering idle.
	 * The timer will re-arm and try again after `delay` ms.
	 */
	shouldIdle?: () => boolean;
}

/**
 * Manages a `data-idle` attribute on a target element.
 *
 * Call `activity()` on user interaction to reset the timer and remove the
 * attribute. After `delay` ms of no activity, `data-idle` is added back.
 */
export class IdleState {
	private o: Required<IdleStateOptions>;
	private to: number | undefined;
	private _enabled = true;

	constructor(private el: HTMLElement, opts: IdleStateOptions = {}) {
		this.o = {
			delay: 4000,
			onIdle: () => {},
			onActive: () => {},
			shouldIdle: () => true,
			...opts,
		};
	}

	/** Whether the element currently has the data-idle attribute. */
	get idle(): boolean {
		return this.el.hasAttribute('data-idle');
	}

	/** Whether the idle state manager is enabled. */
	get enabled(): boolean {
		return this._enabled;
	}
	/** Enables or disables the idle state manager. Disabling immediately pauses the timer. */
	set enabled(v: boolean) {
		this._enabled = v;
		if (!v) this.pause();
	}

	/** Resets the idle timer and removes the data-idle attribute if present. */
	activity() {
		if (this.idle) {
			this.el.removeAttribute('data-idle');
			this.o.onActive();
		}
		this.#schedule();
	}

	/** Removes the data-idle attribute and calls onActive if currently idle. */
	show() {
		if (this.idle) {
			this.el.removeAttribute('data-idle');
			this.o.onActive();
		}
	}

	/** Sets the data-idle attribute and calls onIdle, then pauses the timer. */
	hide() {
		if (!this.idle) {
			this.el.setAttribute('data-idle', '');
			this.o.onIdle();
		}
		this.pause();
	}

	/** Pauses the idle timer without changing the current idle state. */
	pause() {
		clearTimeout(this.to);
	}

	/** Resumes the idle timer, scheduling the idle check after the configured delay. */
	resume() {
		this.#schedule();
	}

	/** Clears the idle timer and cleans up. */
	destroy() {
		clearTimeout(this.to);
	}

	#schedule() {
		clearTimeout(this.to);
		if (!this._enabled) return;
		this.to = window.setTimeout(() => {
			if (!this.o.shouldIdle()) {
				this.#schedule();
				return;
			}
			if (!this.idle) {
				this.el.setAttribute('data-idle', '');
				this.o.onIdle();
			}
		}, this.o.delay);
	}
}
