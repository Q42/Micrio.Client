import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';

/** Props for the error display element @internal */
export interface ErrorProps {
	/** The error message to show */
	message?: string;
}
import './error.css';

/** Custom element displaying an error message */
class MicrioError extends MicrioElement<ErrorProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-error';

	/** @internal */
	protected _render() {
		this.replaceChildren();
		createElement('div', {
			parent: this,
			children: [
				createElement('micrio-icon', { setProps: { name: 'error' } }),
				createElement('span', { textContent: this._props.message ?? 'An unknown error has occurred' })
			]
		});
	}
}

customElements.define(MicrioError.tag, MicrioError);
