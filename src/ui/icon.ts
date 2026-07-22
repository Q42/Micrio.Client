import { MicrioElement } from '$core/component';
import { icons, svgIcon, type MicrioIcon } from '$ui/icons';
import type { IconName } from '$types/icon-name';

const SMALL_NAMES = new Set<IconName>(['chevronDown', 'linkExt']);

const ICON_LIB: Record<IconName, MicrioIcon> = {
	play: icons.play,
	pause: icons.pause,
	close: icons.xmark,
	playFilled: icons.playCircle,
	a11y: icons.globe,
	menu: icons.bars,
	zoomIn: icons.plus,
	zoomOut: icons.minus,
	fullscreenEnter: icons.expand,
	fullscreenLeave: icons.compress,
	muted: icons.volumeXmark,
	unmuted: icons.volumeHigh,
	subtitles: icons.closedCaptioning,
	subtitlesOff: icons.closedCaptioning,
	prev: icons.arrowLeft,
	up: icons.arrowUp,
	next: icons.arrowRight,
	down: icons.arrowDown,
	video: icons.video,
	audio: icons.volumeHigh,
	image: icons.image,
	share: icons.share,
	error: icons.circleExclamation,
	chevronDown: icons.chevronDown,
	link: icons.link,
	linkExt: icons.externalLink,
	ellipsisVertical: icons.ellipsisVertical,
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
		this.#customHTML = micrio?.defaultSettings?.ui?.icons?.[this.#name];
	}

	#render() {
		const custom = this.#customHTML;
		if (custom) {
			this.innerHTML = custom;
			return;
		}

		const icon = ICON_LIB[this.#name];
		if (!icon) { this.replaceChildren(); return; }

		const svg = svgIcon(icon, { className: 'micrio-icon' });
		if (SMALL_NAMES.has(this.#name)) svg.classList.add('small');
		this.replaceChildren(svg);
	}
}

customElements.define(MicrioIconElement.tag, MicrioIconElement);
