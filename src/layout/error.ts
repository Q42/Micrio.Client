import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';

export interface ErrorProps {
	message?: string;
}

class MicrioError extends MicrioElement<ErrorProps> {
	static tag = 'micrio-error';
	static styles = `micrio-error{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10}
micrio-error>div{background:rgba(0,0,0,.75);color:#fff;border:1px solid white;border-radius:5px;padding:10px;text-align:center;white-space:pre-wrap;user-select:text;line-height:24px}
micrio-error svg.micrio-icon{vertical-align:middle;height:24px;width:24px;fill:var(--micrio-color);margin-right:10px}
@media(max-width:520px){micrio-error>div{box-sizing:border-box;width:90%}}`;

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
