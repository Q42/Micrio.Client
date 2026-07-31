import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';

/** Resolve an organisation logo to its image source URL */
function getLogoSrc(img: Models.Assets.Image | string): string {
	if (typeof img == 'string') return img;
	let l = 0;
	let m = Math.max(img.width, img.height);
	while (m > 1024) { l++; m /= 2; }
	return (img.micrioId && img.width > 1024
		? 'https://r2.micr.io/' + img.micrioId + '/' + l + '/0-0.' + (img.isPng ? 'png' : img.isWebP ? 'webp' : 'jpg')
		: img.src);
}

/** Props for the organisation logo element @internal */
export interface LogoOrgProps {
	organisation: Models.ImageInfo.Organisation;
}
import './logo-org.css';

/** Custom element displaying the organisation's logo as a linked image */
class MicrioLogoOrg extends MicrioElement<LogoOrgProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-logo-org';

	#props: LogoOrgProps = { organisation: null! };

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio();
		if (!micrio) return;
		this.#render();
	}

	/** @internal */
	_setProps(props: Partial<LogoOrgProps>) {
		if (props.organisation !== undefined) this.#props.organisation = props.organisation;
		if (this.isConnected) this.#render();
	}

	#render() {
		const org = this.#props.organisation;
		if (!org?.logo) { this.replaceChildren(); return; }

		this.replaceChildren();
		createElement('a', {
			props: { rel: 'noopener', href: org.href ?? '#', title: org.name ?? '', target: '_blank' },
			attrs: { 'aria-label': `${org.name} homepage` },
			children: [
				createElement('img', { props: { src: getLogoSrc(org.logo), alt: 'Logo', crossOrigin: 'anonymous' } })
			],
			parent: this
		});
	}
}

customElements.define(MicrioLogoOrg.tag, MicrioLogoOrg);
