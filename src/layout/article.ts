import { MicrioElement } from '$core/component';

export interface ArticleProps {
	html?: string;
}

export class MicrioArticle extends MicrioElement<ArticleProps> {
	static tag = 'micrio-article';
	static styles = `micrio-article a{color:var(--micrio-color)}micrio-article img{max-width:100%}`;

	protected _render() {
		if (this._props.html) this.innerHTML = this._props.html;
	}
}

customElements.define(MicrioArticle.tag, MicrioArticle);
