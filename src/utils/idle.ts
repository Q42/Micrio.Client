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

	get idle(): boolean {
		return this.el.hasAttribute('data-idle');
	}

	get enabled(): boolean {
		return this._enabled;
	}
	set enabled(v: boolean) {
		this._enabled = v;
		if (!v) this.pause();
	}

	activity() {
		if (this.idle) {
			this.el.removeAttribute('data-idle');
			this.o.onActive();
		}
		this.#schedule();
	}

	show() {
		if (this.idle) {
			this.el.removeAttribute('data-idle');
			this.o.onActive();
		}
	}

	hide() {
		if (!this.idle) {
			this.el.setAttribute('data-idle', '');
			this.o.onIdle();
		}
		this.pause();
	}

	pause() {
		clearTimeout(this.to);
	}

	resume() {
		this.#schedule();
	}

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
