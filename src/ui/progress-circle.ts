import { MicrioElement } from '$core/component';
import { createSvgElement } from '$utils/dom';

const SIZE = '100';
const RADIUS = 40;
const CIRC = 2 * Math.PI * RADIUS;
const CX = '50';
const CY = '50';
const R = '40';
const circleAttrs = { r: R, cx: CX, cy: CY, fill: 'transparent', 'stroke-width': '8px' } satisfies Record<string,string>;

/** Properties for the progress circle component. */
export interface ProgressCircleProps {
	progress?: number;
}
import './progress-circle.css';

/** Web component that displays a circular progress indicator. */
class MicrioProgressCircle extends MicrioElement<ProgressCircleProps> {
	/** The custom element tag name. */
	static tag = 'micrio-progress-circle';

	#props: ProgressCircleProps = {};
	#progressCircle!: SVGCircleElement;

	_onMount() {
		const svg = createSvgElement('svg', {
			attrs: { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}` },
		});

		createSvgElement('circle', {
			attrs: { ...circleAttrs, stroke: '#e0e0e0' },
			parent: svg as unknown as HTMLElement,
		});

		const pc = createSvgElement('circle', {
			attrs: { ...circleAttrs, stroke: '#00d4ee', 'stroke-dasharray': `${CIRC}px` },
			parent: svg as unknown as HTMLElement,
		});

		this.appendChild(svg);
		this.#progressCircle = pc;
		this.#update();
	}

	_setProps(props: Partial<ProgressCircleProps>) {
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
