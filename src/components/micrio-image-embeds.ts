import { MicrioElement } from '$ts/component';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import './micrio-embed';

export interface ImageEmbedsProps {
	image: MicrioImage;
}

export class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	static tag = 'micrio-image-embeds';
	static styles = '';

	#props: ImageEmbedsProps = { image: null! };
	#unsubs: (() => void)[] = [];

	onMount() {
		const { image } = this.#props;

		// Re-render when data changes — skip the initial emission
		// so we don't double-create: onMount already reads synchronously below.
		let first = true;
		this.#unsubs.push(image.data.subscribe(d => {
			if (first) { first = false; return; }
			this.innerHTML = '';
			if (d?.embeds) {
				for (const embed of d.embeds) {
					const el = document.createElement('micrio-embed') as MicrioElement;
					el.setProps({ embed, image });
					this.appendChild(el);
				}
			}
		}));

		// Synchronous initial render — data may already be loaded
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

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioImageEmbeds.tag, MicrioImageEmbeds);
