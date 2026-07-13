import { MicrioElement } from '$ts/component';

const SIZE = 100;
const RADIUS = 40;
const CIRC = 2 * Math.PI * RADIUS;

export class MicrioProgressCircle extends MicrioElement {
	static tag = 'micrio-progress-circle';
	static styles = `micrio-progress-circle{position:absolute;top:50%;left:50%;pointer-events:none;transform:translate(-50%,-50%) rotateZ(-90deg);z-index:10}
micrio-progress-circle svg{display:block}
micrio-progress-circle circle{transition:stroke-dashoffset .25s ease}`;

	#progressCircle!: SVGCircleElement;

	onMount() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', String(SIZE));
		svg.setAttribute('height', String(SIZE));
		svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);

		// Background circle
		const bg = document.createElementNS(ns, 'circle');
		bg.setAttribute('r', String(RADIUS));
		bg.setAttribute('cx', String(SIZE / 2));
		bg.setAttribute('cy', String(SIZE / 2));
		bg.setAttribute('fill', 'transparent');
		bg.setAttribute('stroke', '#e0e0e0');
		bg.setAttribute('stroke-width', '8px');
		svg.appendChild(bg);

		// Progress circle
		const pc = document.createElementNS(ns, 'circle');
		pc.setAttribute('r', String(RADIUS));
		pc.setAttribute('cx', String(SIZE / 2));
		pc.setAttribute('cy', String(SIZE / 2));
		pc.setAttribute('fill', 'transparent');
		pc.setAttribute('stroke', '#00d4ee');
		pc.setAttribute('stroke-width', '8px');
		pc.setAttribute('stroke-dasharray', `${CIRC}px`);
		svg.appendChild(pc);

		this.appendChild(svg);
		this.#progressCircle = pc;
		this.#update(0);
	}

	setProgress(p: number) {
		this.#update(p);
	}

	#update(p: number) {
		if (!this.#progressCircle) return;
		const offset = CIRC * (1 - p);
		this.#progressCircle.setAttribute('stroke-dashoffset', `${offset}px`);
	}
}

customElements.define(MicrioProgressCircle.tag, MicrioProgressCircle);
