import { MicrioElement } from '$core/component';

export interface DialProps {
	currentRotation: number;
	frames: number;
	degrees?: boolean;
	onturn?: (frame: number) => void;
}

class MicrioDial extends MicrioElement<DialProps> {
	static tag = 'micrio-dial';
	static styles = `micrio-dial {
	position: absolute;
	bottom: var(--micrio-border-margin);
	width: 320px;
	max-width: calc(100vw - calc(2 * (var(--micrio-button-size) + 4 * var(--micrio-border-margin))));
	max-width: calc(100cqw - calc(2 * (var(--micrio-button-size) + 4 * var(--micrio-border-margin))));
	left: 50%;
	transform: translateX(-50%);
	height: calc(var(--micrio-button-size)*0.6);
	touch-action: none;
	background-color: transparent;
	cursor: w-resize;
	overflow: hidden;
}
micrio-dial::before,micrio-dial::after {
	content: '';
	display: block;
	width: 100%;
	position: absolute;
	background-position: var(--micrio-dial-offset, 0px);
}
micrio-dial::before {
	height: 50%;
	top: 25%;
	background-image: repeating-linear-gradient(to right, #8888 0%, #8888 0.5%, transparent 1%, transparent 2.5%);
}
micrio-dial::after {
	height: 100%;
	background-image: repeating-linear-gradient(to right, #fff8 0%, #fff8 0.5%, transparent 1%, transparent 20%);
}`;

	#props: DialProps = { currentRotation: 0, frames: 1 };

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;
		const camera = micrio.$current?.camera;
		if (!camera) return;

		let pointerId: number | undefined;
		let startX = 0;
		let startRot = 0;

		const dStart = (e: PointerEvent) => {
			e.stopPropagation();
			e.preventDefault();
			if (e.button != 0) return;
			micrio.addEventListener('pointermove', dMove);
			micrio.addEventListener('pointerup', dStop);
			micrio.setAttribute('data-panning', '');
			micrio.setPointerCapture(pointerId = e.pointerId);
			startRot = this.#props.currentRotation;
			startX = e.clientX;
		};

		const dMove = (e: PointerEvent) => {
			const scale = Math.max(1, (camera.getXY(1, .5)[0] - camera.getXY(0, .5)[0]) / micrio.offsetWidth);
			const targetFrame = (startRot / 360 + ((startX - e.clientX) / (this.offsetWidth * scale))) * this.#props.frames;
			this.#props.onturn?.(targetFrame);
		};

		const dStop = () => {
			if (pointerId) micrio.releasePointerCapture(pointerId);
			micrio.removeAttribute('data-panning');
			micrio.removeEventListener('pointermove', dMove);
			micrio.removeEventListener('pointerup', dStop);
		};
		this.addEventListener('pointerdown', dStart);
	}

	setProps(props: Partial<DialProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) {
			const offset = -this.#props.currentRotation / 360 * (this.offsetWidth ?? 0);
			this.style.setProperty('--micrio-dial-offset', `${offset}px`);
		}
	}
}

customElements.define(MicrioDial.tag, MicrioDial);
