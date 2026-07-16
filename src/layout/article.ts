import { MicrioElement } from '$core/component';

export interface ArticleProps {
	html?: string;
}

export class MicrioArticle extends MicrioElement<ArticleProps> {
	static tag = 'micrio-article';
	static styles = `micrio-article a{color:var(--micrio-color)}micrio-article img{max-width:100%}`;

	#props: ArticleProps = {};

	onMount() {
		this.#render();
	}

	setProps(props: Partial<ArticleProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	#render() {
		if (this.#props.html) this.innerHTML = this.#props.html;
	}
}

customElements.define(MicrioArticle.tag, MicrioArticle);
