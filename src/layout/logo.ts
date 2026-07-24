import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import './logo.css';

/** Custom element displaying the Micrio logo with a loading state indicator */
class MicrioLogo extends MicrioElement {
	/** The custom element tag name */
	static tag = 'micrio-logo';

	#a!: HTMLAnchorElement;
	#loadingTimer: any;
	#loading = false;

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio();
		if (!micrio) return;

		const target = !/micr\.io/.test(location.origin) || self.parent != self ? '_blank' : undefined;

		this.#a = createElement('a', {
			props: { rel: 'noopener', href: 'https://micr.io/', title: 'Powered by Micrio' },
			attrs: { 'aria-label': 'Micrio homepage' },
			parent: this
		});
		if (target) this.#a.target = target;

		this._addCleanup(micrio._loading.subscribe(l => {
			clearTimeout(this.#loadingTimer);
			if (!l) {
				this.#loading = false;
				this.#updateClass();
			} else if (!this.#loading) {
				this.#loadingTimer = setTimeout(() => {
					this.#loading = true;
					this.#updateClass();
				}, 750);
			}
		}));

		this._addCleanup(() => clearTimeout(this.#loadingTimer));
	}

	/** @internal */
	_onDestroy() {
		clearTimeout(this.#loadingTimer);
	}

	#updateClass() {
		if (this.#a) this.#a.classList.toggle('loading', this.#loading);
	}
}

customElements.define(MicrioLogo.tag, MicrioLogo);
