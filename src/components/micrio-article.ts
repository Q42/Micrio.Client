import { MicrioElement } from '$ts/component';

export interface ArticleProps {
	html?: string;
}

export class MicrioArticle extends MicrioElement<ArticleProps> {
	static tag = 'micrio-article';
	static styles = `micrio-article p:first-child{margin-top:0}micrio-article p:last-child{margin-bottom:0}micrio-article a{color:var(--micrio-color)}micrio-article img{max-width:100%}`;

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
