import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';

export class MicrioLogo extends MicrioElement {
	static tag = 'micrio-logo';
	static styles = `micrio-logo a{position:absolute;top:calc(var(--micrio-border-margin) * 2);left:calc(var(--micrio-border-margin) * 2);z-index:2;width:22px;height:22px;transition:transform .25s ease;display:block;cursor:pointer}
micrio-logo a:hover{transform:rotate3d(0,0,1,-90deg)}
micrio-logo a::before,micrio-logo a::after{display:block;content:'';position:absolute;transform:rotate3d(0,0,1,45deg);will-change:transform;box-sizing:unset}
micrio-logo a::before{border:3px solid #00d4ee;width:16px;height:16px}
micrio-logo a.loading::before{animation:micrio-logo-spin 1s infinite ease-out}
micrio-logo a::after{top:8px;left:8px;width:6px;height:6px;background:#c5ff5b;outline:1px solid #c5ff5b}
micrio-logo a.loading::after{animation:micrio-logo-spin .5s infinite ease-out}
@keyframes micrio-logo-spin{from{transform:rotate3d(0,0,1,45deg)}to{transform:rotate3d(0,0,1,135deg)}}`;

	#a!: HTMLAnchorElement;
	#loadingTimer: any;
	#loading = false;
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const target = !/micr\.io/.test(location.origin) || self.parent != self ? '_blank' : undefined;

		this.#a = document.createElement('a');
		this.#a.rel = 'noopener';
		this.#a.href = 'https://micr.io/';
		this.#a.title = 'Powered by Micrio';
		this.#a.setAttribute('aria-label', 'Micrio homepage');
		if (target) this.#a.target = target;
		this.appendChild(this.#a);

		this.#unsubs.push(micrio.loading.subscribe(l => {
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
	}

	onDestroy() {
		clearTimeout(this.#loadingTimer);
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}

	#updateClass() {
		if (this.#a) this.#a.classList.toggle('loading', this.#loading);
	}
}

customElements.define(MicrioLogo.tag, MicrioLogo);
