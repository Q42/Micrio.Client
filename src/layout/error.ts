import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';

export interface ErrorProps {
	message?: string;
}
import './error.css';

class MicrioError extends MicrioElement<ErrorProps> {
	static tag = 'micrio-error';

	protected _render() {
		this.replaceChildren();
		createElement('div', {
			parent: this,
			children: [
				createElement('micrio-icon', { attrs: { name: 'error' } }),
				createElement('span', { textContent: this._props.message ?? 'An unknown error has occurred' })
			]
		});
	}
}

customElements.define(MicrioError.tag, MicrioError);
