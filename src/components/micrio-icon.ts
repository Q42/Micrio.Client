import { MicrioElement } from '$core/component';
import { icons, type MicrioIcon } from '$core/icons';

export type IconName = (
	'zoom-in'|'zoom-out'|'maximize'|'minimize'|'close'|
	'arrow-right'|'arrow-down'|'arrow-left'|'arrow-up'|
	'play'|'pause'|'subtitles'|'subtitles-off'|'volume-off'|'volume-up'|
	'play-filled'|'a11y'|'menu'|'audio'|'video'|'share'|
	'error'|'chevron-down'|'link'|'link-ext'|'ellipsis-vertical'|'image'
);

const SMALL_NAMES = new Set<IconName>(['chevron-down', 'link-ext']);

const ICON_LIB: Record<IconName, MicrioIcon> = {
	play: icons.play,
	pause: icons.pause,
	close: icons.xmark,
	'play-filled': icons.playCircle,
	a11y: icons.globe,
	menu: icons.bars,
	'zoom-in': icons.plus,
	'zoom-out': icons.minus,
	maximize: icons.expand,
	minimize: icons.compress,
	'volume-off': icons.volumeXmark,
	'volume-up': icons.volumeHigh,
	subtitles: icons.closedCaptioning,
	'subtitles-off': icons.closedCaptioning,
	'arrow-left': icons.arrowLeft,
	'arrow-up': icons.arrowUp,
	'arrow-right': icons.arrowRight,
	'arrow-down': icons.arrowDown,
	video: icons.video,
	audio: icons.volumeHigh,
	image: icons.image,
	share: icons.share,
	error: icons.circleExclamation,
	'chevron-down': icons.chevronDown,
	link: icons.link,
	'link-ext': icons.externalLink,
	'ellipsis-vertical': icons.ellipsisVertical,
};

export class MicrioIconElement extends MicrioElement {
	static tag = 'micrio-icon';
	static styles = `svg.micrio-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-.125em}svg.micrio-icon.small{height:.75em}`;

	static observedAttributes = ['name', 'style'];

	#name: IconName = 'close';
	#customHTML: string | undefined;

	onMount() {
		this.#readCustomHTML();
		this.#render();
	}

	attributeChangedCallback(attr: string, _old: string | null, val: string | null) {
		if (attr === 'name' && val) this.#name = val as IconName;
		if (this.isConnected) {
			this.#readCustomHTML();
			this.#render();
		}
	}

	#readCustomHTML() {
		const micrio = this.getMicrio();
		const ui = micrio?.defaultSettings?.ui?.icons;
		if (!ui) { this.#customHTML = undefined; return; }
		switch (this.#name) {
			case 'zoom-in': this.#customHTML = ui.zoomIn; break;
			case 'zoom-out': this.#customHTML = ui.zoomOut; break;
			case 'maximize': this.#customHTML = ui.fullscreenEnter; break;
			case 'minimize': this.#customHTML = ui.fullscreenLeave; break;
			case 'close': this.#customHTML = ui.close; break;
			case 'arrow-right': this.#customHTML = ui.next; break;
			case 'arrow-left': this.#customHTML = ui.prev; break;
			case 'arrow-up': this.#customHTML = ui.up; break;
			case 'arrow-down': this.#customHTML = ui.down; break;
			case 'play': this.#customHTML = ui.play; break;
			case 'pause': this.#customHTML = ui.pause; break;
			case 'subtitles': this.#customHTML = ui.subtitles; break;
			case 'subtitles-off': this.#customHTML = ui.subtitlesOff; break;
			case 'volume-off': this.#customHTML = ui.muted; break;
			case 'volume-up': this.#customHTML = ui.unmuted; break;
			default: this.#customHTML = undefined;
		}
	}

	#render() {
		const custom = this.#customHTML;
		if (custom) {
			this.innerHTML = custom;
			return;
		}

		const icon = ICON_LIB[this.#name];
		if (!icon) { this.innerHTML = ''; return; }

		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('xmlns', ns);
		svg.setAttribute('viewBox', `0 0 ${icon[0]} ${icon[1]}`);
		svg.setAttribute('fill', 'currentColor');
		svg.classList.add('micrio-icon');
		if (SMALL_NAMES.has(this.#name)) svg.classList.add('small');

		const path = document.createElementNS(ns, 'path');
		path.setAttribute('d', icon[2]);
		svg.appendChild(path);

		this.replaceChildren(svg);
	}
}

customElements.define(MicrioIconElement.tag, MicrioIconElement);
