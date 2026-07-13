import { MicrioElement } from '$ts/component';

export interface ErrorProps {
	message?: string;
}

export class MicrioError extends MicrioElement<ErrorProps> {
	static tag = 'micrio-error';
	static styles = `micrio-error{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:20;max-width:80%}
micrio-error>micrio-icon{font-size:3em;opacity:.5;margin-bottom:8px}
micrio-error>p{margin:0;font-size:.9em;opacity:.7;line-height:1.4}`;

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
		const icon = document.createElement('micrio-icon');
		icon.setAttribute('name', 'error');
		this.appendChild(icon);

		const p = document.createElement('p');
		p.textContent = this.#props.message ?? 'An unknown error has occurred';
		this.appendChild(p);
	}
}

customElements.define(MicrioError.tag, MicrioError);
