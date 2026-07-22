import { MicrioElement } from '$core/component';

export interface ArticleProps {
	html?: string;
}
import './article.css';

class MicrioArticle extends MicrioElement<ArticleProps> {
	static tag = 'micrio-article';

	protected _render() {
		if (this._props.html) this.innerHTML = this._props.html;
	}
}

customElements.define(MicrioArticle.tag, MicrioArticle);
