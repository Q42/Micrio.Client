import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';

import './embed';

export interface ImageEmbedsProps {
	image: MicrioImage;
}

export class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	static tag = 'micrio-image-embeds';
	static styles = `micrio-image-embeds{pointer-events:none;position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;will-change:width,height,top,left,opacity;perspective:inherit}
micrio-image-embeds:empty{display:none}
micrio-image-embeds>*{pointer-events:all}`;

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
