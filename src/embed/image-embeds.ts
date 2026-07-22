import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';

import './embed';

export interface ImageEmbedsProps {
	image: MicrioImage;
}

class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	static tag = 'micrio-image-embeds';
	static styles = `
micrio-image-embeds>* {
	pointer-events: all;
}
`;

	#props: ImageEmbedsProps = { image: null! };

	onMount() {
		const { image } = this.#props;

		this.watch(image.data, d => {
			this.replaceChildren();
			if (d?.embeds) {
				for (const embed of d.embeds) {
					createElement('micrio-embed', { parent: this, setProps: { embed, image } });
				}
			}
		});
	}

	setProps(props: Partial<ImageEmbedsProps>) {
		if (props.image !== undefined) this.#props.image = props.image;
	}
}

customElements.define(MicrioImageEmbeds.tag, MicrioImageEmbeds);
