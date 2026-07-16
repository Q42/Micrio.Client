import { MicrioElement } from '$core/component';

export interface ErrorProps {
	message?: string;
}

export class MicrioError extends MicrioElement<ErrorProps> {
	static tag = 'micrio-error';
	static styles = `micrio-error{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10}
micrio-error>div{background:rgba(0,0,0,.75);color:#fff;border:1px solid white;border-radius:5px;padding:10px;text-align:center;white-space:pre-wrap;user-select:text;line-height:24px}
micrio-error svg.micrio-icon{vertical-align:middle;height:24px;width:24px;fill:var(--micrio-color);margin-right:10px}
@media(max-width:520px){micrio-error>div{box-sizing:border-box;width:90%}}`;

	#props: ErrorProps = {};

	onMount() {
		this.#render();
	}

	setProps(props: Partial<ErrorProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	#render() {
		this.replaceChildren();
		const div = document.createElement('div');

		const icon = document.createElement('micrio-icon');
		icon.setAttribute('name', 'error');
		div.appendChild(icon);

		const span = document.createElement('span');
		span.textContent = this.#props.message ?? 'An unknown error has occurred';
		div.appendChild(span);

		this.appendChild(div);
	}
}

customElements.define(MicrioError.tag, MicrioError);
