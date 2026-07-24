import { MicrioElement } from '$core/component';
import { icons, svgIcon } from '$ui/icons';
import type { IconName } from '$types/icon-name';

const SMALL_NAMES = new Set<IconName>(['chevronDown', 'linkExt']);
import './icon.css';

/** Web component that renders an SVG icon by name, with support for custom HTML overrides. */
class MicrioIconElement extends MicrioElement {
	/** The custom element tag name. */
	static tag = 'micrio-icon';

	#name: IconName = 'close';
	#customHTML: string | undefined;

	_onMount() {
		this.#readCustomHTML();
		this.#render();
	}

	_setProps(props: Record<string, any>): void {
		if (props.name) this.#name = props.name as IconName;
		if (this.isConnected) {
			this.#readCustomHTML();
			this.#render();
		}
	}

	#readCustomHTML() {
		const micrio = this._getMicrio();
		this.#customHTML = micrio?.$current?.$settings?.ui?.icons?.[this.#name];
	}

	#render() {
		const custom = this.#customHTML;
		if (custom) {
			this.innerHTML = custom;
			return;
		}

		const icon = icons[this.#name];
		if (!icon) { this.replaceChildren(); return; }

		const svg = svgIcon(icon);
		if (SMALL_NAMES.has(this.#name)) svg.classList.add('small');
		this.replaceChildren(svg);
	}
}

customElements.define(MicrioIconElement.tag, MicrioIconElement);
