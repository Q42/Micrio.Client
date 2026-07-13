import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';

export interface MicrioGalleryItemProps {
	gallery: Models.Assets.Image[];
	startId?: string;
}

export class MicrioGalleryItem extends MicrioElement<MicrioGalleryItemProps> {
	static tag = 'micrio-gallery-item';
	static styles = `micrio-gallery-item{display:block;width:100%;height:300px;position:relative;overflow:hidden;border-radius:var(--micrio-border-radius)}
micrio-gallery-item img{width:100%;height:100%;object-fit:contain;cursor:pointer;transition:opacity .25s}
micrio-gallery-item .nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;background:rgba(0,0,0,.5);color:#fff;border:none;padding:8px 12px;cursor:pointer;font-size:1.2em;border-radius:var(--micrio-border-radius)}
micrio-gallery-item .nav.prev{left:8px}
micrio-gallery-item .nav.next{right:8px}
micrio-gallery-item .caption{padding:8px;text-align:center;font-size:.85em;opacity:.7}
micrio-gallery-item .counter{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.5);color:#fff;padding:2px 8px;border-radius:4px;font-size:.75em}`;

	#props: MicrioGalleryItemProps = { gallery: [] };
	#unsubs: (() => void)[] = [];
	#index = 0;

	onMount() {
		this.#render();
	}

	setProps(props: Partial<MicrioGalleryItemProps>) {
		if (props.gallery !== undefined) this.#props.gallery = props.gallery;
		if (props.startId !== undefined) {
			const idx = this.#props.gallery.findIndex((a: any) => a.micrioId == props.startId);
			if (idx >= 0) this.#index = idx;
		}
		if (this.isConnected) this.#render();
	}

	#render() {
		const { gallery } = this.#props;
		if (!gallery?.length) { this.innerHTML = ''; return; }

		const item = gallery[this.#index];
		const caption = (item as any).i18n?.description || '';

		this.replaceChildren();

		const img = document.createElement('img');
		img.src = (item as any).micrioId
			? `https://iiif.micr.io/${(item as any).micrioId}/full/^,640/0/default.webp`
			: (item as any).src || '';
		img.alt = caption || '';

		if (this.#index > 0) {
			const prev = document.createElement('button');
			prev.className = 'nav prev';
			prev.textContent = '‹';
			prev.addEventListener('click', () => { this.#index--; this.#render(); });
			this.appendChild(prev);
		}

		if (this.#index < gallery.length - 1) {
			const next = document.createElement('button');
			next.className = 'nav next';
			next.textContent = '›';
			next.addEventListener('click', () => { this.#index++; this.#render(); });
			this.appendChild(next);
		}

		if (caption) {
			const cap = document.createElement('div');
			cap.className = 'caption';
			cap.textContent = caption;
			this.appendChild(cap);
		}

		const counter = document.createElement('div');
		counter.className = 'counter';
		counter.textContent = `${this.#index + 1} / ${gallery.length}`;
		this.appendChild(counter);

		this.prepend(img);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioGalleryItem.tag, MicrioGalleryItem);
