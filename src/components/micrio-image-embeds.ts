import { MicrioElement } from '$ts/component';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import './micrio-embed';

export interface ImageEmbedsProps {
	image: MicrioImage;
}

export class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	static tag = 'micrio-image-embeds';
	static styles = 'micrio-image-embeds{display:contents}';

	#props: ImageEmbedsProps = { image: null! };

	onMount() {
		const { image } = this.#props;

		this.watchLater(image.data, d => {
			this.innerHTML = '';
			if (d?.embeds) {
				for (const embed of d.embeds) {
					const el = document.createElement('micrio-embed') as MicrioElement;
					el.setProps({ embed, image });
					this.appendChild(el);
				}
			}
		});

		const data = get(image.data);
		if (data?.embeds) {
			for (const embed of data.embeds) {
				const el = document.createElement('micrio-embed') as MicrioElement;
				el.setProps({ embed, image });
				this.appendChild(el);
			}
		}
	}

	setProps(props: Partial<ImageEmbedsProps>) {
		if (props.image !== undefined) this.#props.image = props.image;
	}
}

customElements.define(MicrioImageEmbeds.tag, MicrioImageEmbeds);
