import { MicrioElement } from '$core/component';

export interface DialProps {
	currentRotation: number;
	frames: number;
	degrees?: boolean;
	onturn?: (frame: number) => void;
}
import styles from './dial.css?inline';

class MicrioDial extends MicrioElement<DialProps> {
	static tag = 'micrio-dial';
	static styles = styles;

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
