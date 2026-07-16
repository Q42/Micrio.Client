import { MicrioElement } from '$core/component';
import { createSvgElement } from '$utils/dom';

const SIZE = 100;
const RADIUS = 40;
const CIRC = 2 * Math.PI * RADIUS;

export interface ProgressCircleProps {
	progress?: number;
}

export class MicrioProgressCircle extends MicrioElement<ProgressCircleProps> {
	static tag = 'micrio-progress-circle';
	static styles = `micrio-progress-circle{position:absolute;top:50%;left:50%;pointer-events:none;transform:translate(-50%,-50%) rotateZ(-90deg);z-index:10}
micrio-progress-circle svg{display:block}
micrio-progress-circle circle{transition:stroke-dashoffset .25s ease}`;

	#props: ProgressCircleProps = {};
	#progressCircle!: SVGCircleElement;

	onMount() {
		const svg = createSvgElement('svg', {
			attrs: {
				width: String(SIZE),
				height: String(SIZE),
				viewBox: `0 0 ${SIZE} ${SIZE}`,
			},
		});

		createSvgElement('circle', {
			attrs: {
				r: String(RADIUS),
				cx: String(SIZE / 2),
				cy: String(SIZE / 2),
				fill: 'transparent',
				stroke: '#e0e0e0',
				'stroke-width': '8px',
			},
			parent: svg as unknown as HTMLElement,
		});

		const pc = createSvgElement('circle', {
			attrs: {
				r: String(RADIUS),
				cx: String(SIZE / 2),
				cy: String(SIZE / 2),
				fill: 'transparent',
				stroke: '#00d4ee',
				'stroke-width': '8px',
				'stroke-dasharray': `${CIRC}px`,
			},
			parent: svg as unknown as HTMLElement,
		});

		this.appendChild(svg);
		this.#progressCircle = pc;
		this.#update();
	}

	setProps(props: Partial<ProgressCircleProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#update();
	}

	#update() {
		if (!this.#progressCircle) return;
		const p = this.#props.progress ?? 0;
		const offset = CIRC * (1 - p);
		this.#progressCircle.setAttribute('stroke-dashoffset', `${offset}px`);
	}
}

customElements.define(MicrioProgressCircle.tag, MicrioProgressCircle);
