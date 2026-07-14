import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
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

export class MicrioLogoOrg extends MicrioElement<LogoOrgProps> {
	static tag = 'micrio-logo-org';
	static styles = `micrio-logo-org a{position:absolute;top:calc(var(--micrio-border-margin) * 2);right:calc(var(--micrio-border-margin) * 2);z-index:1;display:block}
micrio-logo-org img{max-height:64px;display:block}`;

	#props: LogoOrgProps = { organisation: null! };
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		this.#render();
	}

	setProps(props: Partial<LogoOrgProps>) {
		if (props.organisation !== undefined) this.#props.organisation = props.organisation;
		if (this.isConnected) this.#render();
	}

	#render() {
		const org = this.#props.organisation;
		if (!org?.logo) { this.innerHTML = ''; return; }

		this.replaceChildren();
		const a = document.createElement('a');
		a.rel = 'noopener';
		a.href = org.href ?? '#';
		a.title = org.name ?? '';
		a.setAttribute('aria-label', `${org.name} homepage`);
		a.target = '_blank';

		const img = document.createElement('img');
		img.src = getLogoSrc(org.logo);
		img.alt = 'Logo';
		a.appendChild(img);
		this.appendChild(a);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioLogoOrg.tag, MicrioLogoOrg);
