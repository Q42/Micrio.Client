import { MicrioElement } from '$ts/component';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import type { HTMLMicrioElement } from '$ts/element';

export interface FullscreenProps {
	el: HTMLElement;
}

export class MicrioFullscreen extends MicrioElement<FullscreenProps> {
	static tag = 'micrio-fullscreen';
	static styles = `micrio-fullscreen{display:contents}`;

	#props: Partial<FullscreenProps> = {};
	#unsubs: (() => void)[] = [];
	#isActive = false;
	#inited = false;

	onMount() {
		if (!this.#props?.el) return; // setProps not called yet
		this.#init();
	}

	setProps(props: Partial<FullscreenProps>) {
		if (props.el !== undefined) {
			this.#props.el = props.el;
			if (this.isConnected && !this.#inited) this.#init();
		}
	}

	#init() {
		if (this.#inited) return;
		this.#inited = true;
		const el = this.#props.el!;
		const isNative = 'requestFullscreen' in el;
		const isWebkit = 'webkitRequestFullscreen' in el;
		const getActiveEl = () => isNative ? document.fullscreenElement
			: (document as any)['webkitFullscreenElement'] ?? null;

		this.#isActive = getActiveEl() === el;
		const available = isNative || (isWebkit && !getActiveEl());

		if (!available) return;

		const micrio = this.inject<HTMLMicrioElement>('micrio');

		const toggle = () => {
			if (this.#isActive) this.#exit(el, isNative);
			else this.#enter(el, isNative, isWebkit);
		};

		const addScrollZoom = micrio && el == micrio && !micrio.events.scrollHooked;

		const onchange = () => {
			this.#isActive = getActiveEl() === el;
			if (addScrollZoom) {
				if (this.#isActive) micrio!.events.hookScroll();
				else micrio!.events.unhookScroll();
			}
			this.#renderButton();
		};

		const evt = isNative ? 'fullscreenchange' : 'webkitfullscreenchange';
    document.addEventListener(evt, onchange);
    this.#unsubs.push(() => document.removeEventListener(evt, onchange));

    (this as any).__toggle = toggle;

    this.#renderButton();
}

	#enter(_el: HTMLElement, isNative: boolean, _isWebkit: boolean) {
		if (isNative) {
			_el.requestFullscreen();
		} else if ('webkitRequestFullscreen' in _el) {
			((_el as any)['webkitRequestFullscreen'] as Function)();
		}
	}

	#exit(_el: HTMLElement, isNative: boolean) {
		if (isNative) {
			document.exitFullscreen();
		} else if ('webkitExitFullscreen' in document) {
			((document as any)['webkitExitFullscreen'] as Function)();
		}
	}

	#renderButton() {
		this.replaceChildren();
		const btn = document.createElement('micrio-button') as any;
		const $i18n = get(i18n);
		btn.setProps({
			type: this.#isActive ? 'minimize' : 'maximize',
			title: $i18n.fullscreenToggle,
			onclick: (this as any).__toggle
		});
		this.appendChild(btn);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioFullscreen.tag, MicrioFullscreen);
