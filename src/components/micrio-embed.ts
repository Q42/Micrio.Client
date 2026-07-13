import { MicrioElement } from '$ts/component';
import type { MicrioImage } from '$ts/image';
import type { HTMLMicrioElement } from '$ts/element';

interface EmbedArea {
	micrioId?: string;
	area?: number[];
	opacity?: number;
	fit?: 'cover' | 'contain';
	asImage?: boolean;
	settings?: any;
}

export interface EmbedProps {
	embed: EmbedArea;
	image: MicrioImage;
}

export class MicrioEmbed extends MicrioElement<EmbedProps> {
	static tag = 'micrio-embed';
	static styles = '';

	#props: EmbedProps = { embed: null!, image: null! };
	#unsubs: (() => void)[] = [];

	onMount() {
		const { embed, image } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !embed || !image) return;

		// Position the embed area in the image
		if (embed.area) {
			image.addEmbed(
				{ id: embed.micrioId, settings: embed.settings },
				embed.area,
				{ opacity: embed.opacity, fit: embed.fit, asImage: embed.asImage }
			);
		}

		// Subscribe to view changes to reposition if needed
		this.#unsubs.push(image.state.view.subscribe(() => {
			// Reposition logic — the engine handles embed rendering
		}));
	}

	setProps(props: Partial<EmbedProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioEmbed.tag, MicrioEmbed);
