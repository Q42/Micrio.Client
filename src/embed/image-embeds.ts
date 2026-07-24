import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';

import './embed';

export interface ImageEmbedsProps {
	image: MicrioImage;
}
import './image-embeds.css';

class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	static tag = 'micrio-image-embeds';

	#props: ImageEmbedsProps = { image: null! };

	_onMount() {
		const { image } = this.#props;

		this._watch(image.data, d => {
			this.replaceChildren();
			if (d?.embeds) {
				for (const embed of d.embeds) {
					createElement('micrio-embed', { parent: this, setProps: { embed, image } });
				}
			}
		});
	}

	_setProps(props: Partial<ImageEmbedsProps>) {
		if (props.image !== undefined) this.#props.image = props.image;
	}
}

customElements.define(MicrioImageEmbeds.tag, MicrioImageEmbeds);
