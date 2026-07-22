import { MicrioElement } from '$core/component';

export interface ArticleProps {
	html?: string;
}
import styles from './article.css?inline';

class MicrioArticle extends MicrioElement<ArticleProps> {
	static tag = 'micrio-article';
	static styles = styles;

	protected _render() {
		if (this._props.html) this.innerHTML = this._props.html;
	}
}

customElements.define(MicrioArticle.tag, MicrioArticle);
