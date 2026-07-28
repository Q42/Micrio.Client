import { MicrioElement } from '$core/component';

/** Props for the article layout element @internal */
export interface ArticleProps {
	/** HTML content to render inside the article */
	html?: string;
}
import './article.css';

/** Custom element displaying an article with HTML content */
class MicrioArticle extends MicrioElement<ArticleProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-article';

	/** @internal */
	protected _render() {
		if (this._props.html) this.innerHTML = this._props.html;
	}
}

customElements.define(MicrioArticle.tag, MicrioArticle);
