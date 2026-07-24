import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';

import './embed';

/** Properties for the image embeds container component. */
export interface ImageEmbedsProps {
	/** The parent MicrioImage whose embeds will be rendered. */
	image: MicrioImage;
}
import './image-embeds.css';

/** Custom element that renders all embeds for a Micrio image by watching the image data for embed definitions. */
class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	/** HTML tag name for this custom element. */
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
