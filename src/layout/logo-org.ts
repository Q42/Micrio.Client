import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';

function getLogoSrc(img: Models.Assets.Image | string): string {
	if (typeof img == 'string') return img;
	let l = 0;
	let m = Math.max(img.width, img.height);
	while (m > 1024) { l++; m /= 2; }
	return (img.micrioId && img.width > 1024
		? 'https://r2.micr.io/' + img.micrioId + '/' + l + '/0-0.' + (img.isPng ? 'png' : img.isWebP ? 'webp' : 'jpg')
		: img.src);
}

export interface LogoOrgProps {
	organisation: Models.ImageInfo.Organisation;
}

class MicrioLogoOrg extends MicrioElement<LogoOrgProps> {
	static tag = 'micrio-logo-org';
	static styles = `micrio-logo-org {
	display: contents;
}
micrio-logo-org a {
	position: absolute;
	top: calc(var(--micrio-border-margin) * 2);
	right: calc(var(--micrio-border-margin) * 2);
	z-index: 1;
	display: block;
}
micrio-logo-org img {
	max-height: 64px;
	display: block;
}
`;

	#props: LogoOrgProps = { organisation: null! };

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;
		this.#render();
	}

	setProps(props: Partial<LogoOrgProps>) {
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
				createElement('img', { props: { src: getLogoSrc(org.logo), alt: 'Logo' } })
			],
			parent: this
		});
	}
}

customElements.define(MicrioLogoOrg.tag, MicrioLogoOrg);
