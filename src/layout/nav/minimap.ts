import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { mod1 } from '$utils/math';
import { Browser } from '$utils/browser';
import { createElement, afterFrame } from '$utils/dom';

export interface MinimapProps {
	image: MicrioImage;
}

class MicrioMinimap extends MicrioElement<MinimapProps> {
	static tag = 'micrio-minimap';
	static styles = `micrio-minimap canvas {
	position: absolute;
	bottom: var(--micrio-border-margin);
	right: 5px;
	transform-origin: right bottom;
	display: block;
	background-size: 100%;
	transition: opacity .2s ease;
	cursor: grab;
	-ms-content-zooming: none;
	-ms-touch-action: none;
	touch-action: none;
	border-radius: var(--micrio-border-radius);
}
micrio-minimap canvas:not(:hover).hidden {
	opacity: 0;
	pointer-events: none;
}
micrio-minimap canvas.controls {
	right: calc(var(--micrio-border-margin) + var(--micrio-button-size) + 8px);
}
@media (max-width: 800px) {
	micrio-minimap canvas {
		transform: scale3d(.5, .5, 1);
		pointer-events: none;
		right: 65px;
	}
}
`;

	#props: MinimapProps = { image: null! };
	#_canvas!: HTMLCanvasElement;
	#_ctx: CanvasRenderingContext2D | null = null;
	#to: any;
	#dragViewDims: { width: number; height: number } | undefined;
	#mapRect: DOMRect | undefined;
	#autoHide = false;
	#is360 = false;
	#checkHidden: (() => boolean) | null = null;

	onMount() {
		const { image } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !image) return;

		const info = image.$info;
		if (!info) return;
		const camera = image.camera;
		const settings = image.$settings;

		this.#autoHide = !settings.alwaysShowMinimap;
		this.#is360 = !!info.is360;
		this.#checkHidden = () => !this.#is360 && camera.isZoomedOut();

		const maxWidth = settings.minimapWidth ?? 200;
		const maxHeight = settings.minimapHeight ?? 160;
		const noControls = !!settings.noControls;
		const aspect = info.width / info.height;
		const width = maxWidth / aspect > maxHeight ? Math.round(maxHeight * aspect) : maxWidth;
		const height = maxWidth / aspect <= maxHeight ? Math.round(maxWidth / aspect) : maxHeight;
		const offset = -camera.rotationY / (Math.PI * 2);
		const isolated = self.crossOriginIsolated;
		let thumbSrc: string | undefined = isolated ? undefined : image.thumbSrc;

		const draw = (area: Models.Camera.View | undefined) => {
			if (!area || !this.#_ctx) return;
			this.#moved();
			const ctx = this.#_ctx;
			ctx.clearRect(0, 0, width, height);

			const hasThumb = !!(image.thumbSrc || thumbSrc);
			if (info.is360) {
				// Crosshair indicator: hairline at yaw + pitch, avoids equirectangular distortion
				if (hasThumb) {
					ctx.globalCompositeOperation = 'source-over';
					ctx.fillStyle = 'rgba(0,0,0,.45)';
					ctx.fillRect(0, 0, width, height);
					ctx.globalCompositeOperation = 'destination-out';
				}
				const cx = mod1(area[0] + area[2] / 2);
				const cy = Math.max(0, Math.min(1, area[1] + area[3] / 2));
				const px = Math.round(cx * width);
				const py = Math.round(cy * height);
				// Vertical hairline (yaw) — narrower than full FOV, but indicates direction
				const hw = Math.max(1, Math.round(area[2] * width / 2));
				ctx.fillStyle = hasThumb ? 'white' : 'rgba(255,255,255,.8)';
				ctx.fillRect(Math.round(px - hw), 0, hw * 2, height);
				// Horizontal hairline (pitch)
				const hh = Math.max(1, Math.round(area[3] * height / 2));
				ctx.fillRect(0, Math.round(py - hh), width, hh * 2);
				// Center dot
				ctx.beginPath();
				ctx.arc(px, py, 3, 0, Math.PI * 2);
				ctx.fill();
				if (hasThumb) ctx.globalCompositeOperation = 'source-over';
			} else {
				if (hasThumb) {
					ctx.globalCompositeOperation = 'source-over';
					ctx.fillStyle = 'rgba(0,0,0,.5)';
					ctx.fillRect(0, 0, width, height);
					ctx.globalCompositeOperation = 'destination-out';
				} else {
					ctx.fillStyle = 'rgba(0,0,0,.5)';
					ctx.fillRect(0, 0, width, height);
				}
				ctx.beginPath();
				ctx.fillStyle = 'white';
				ctx.rect(
					Math.floor(area[0] * width),
					Math.floor(area[1] * height),
					Math.ceil(area[2] * width),
					Math.ceil(area[3] * height)
				);
				if (hasThumb) {
					ctx.fill();
					ctx.globalCompositeOperation = 'source-over';
				}
				ctx.stroke();
			}
		};

		const wheel = (e: WheelEvent) => {
			camera.zoom(e.deltaY * (Browser.firefox ? 50 : 1));
		};

		const dStart = (e: MouseEvent) => {
			if (e.button != 0) return;
			window.addEventListener('mousemove', dDraw);
			window.addEventListener('mouseup', dStop);
			this.#mapRect = this.#_canvas.getBoundingClientRect();
			const cv = camera.getView();
			if (cv) this.#dragViewDims = { width: cv[2], height: cv[3] };
			dDraw(e);
		};

		const dDraw = (e: MouseEvent) => {
			if (!this.#mapRect) return;
			const x = Math.max(0, Math.min(1, (e.clientX - this.#mapRect.left) / this.#mapRect.width));
			const y = Math.max(0, Math.min(1, (e.clientY - this.#mapRect.top) / this.#mapRect.height));
			if (this.#dragViewDims) {
				camera.setView([x - this.#dragViewDims.width / 2, y - this.#dragViewDims.height / 2, this.#dragViewDims.width, this.#dragViewDims.height]);
			} else {
				camera.setCoo(x, y);
			}
		};

		const dStop = () => {
			window.removeEventListener('mousemove', dDraw);
			window.removeEventListener('mouseup', dStop);
			this.#dragViewDims = undefined;
		};

		// Create canvas
		this.#_canvas = createElement('canvas', {
			props: { width, height },
			className: noControls ? '' : 'controls',
			events: { mousedown: dStart as EventListener },
			parent: this
		});
		if (thumbSrc) {
			this.#_canvas.style.backgroundImage = `url('${thumbSrc}')`;
			if (offset != 0) this.#_canvas.style.backgroundPositionX = `${width * offset}px`;
		}
		this.#_canvas.addEventListener('wheel', wheel, { passive: true });

		this.#_ctx = this.#_canvas.getContext('2d');
		if (this.#_ctx) {
			this.#_ctx.lineWidth = 1;
			this.#_ctx.strokeStyle = 'white';
		}

		// Load thumbnail if cross-origin isolated
		if (isolated && image.thumbSrc) {
			fetch(image.thumbSrc).then(r => r.blob()).then(b => {
				thumbSrc = URL.createObjectURL(b);
				this.#_canvas.style.backgroundImage = `url('${thumbSrc}')`;
				draw(get(image.state.view));
			});
		}

		// Subscribe to view changes
		this.addCleanup(image.state.view.subscribe(draw));
		// Auto-hide on mouse move over main canvas
		const passive: AddEventListenerOptions = { passive: true };
		micrio.canvas.element.addEventListener('mousemove', () => this.#moved(), passive);
		this.addCleanup(() => micrio.canvas.element.removeEventListener('mousemove', () => this.#moved(), passive));

		afterFrame().then(() => this.#syncVisibility());
	}

	#moved() {
		if (this.#checkHidden?.()) {
			this.#_canvas.classList.add('hidden');
			clearTimeout(this.#to);
			return;
		}
		this.#_canvas.classList.remove('hidden');
		clearTimeout(this.#to);
		this.#to = setTimeout(() => {
			if (this.#checkHidden?.()) this.#_canvas.classList.add('hidden');
		}, 2500);
	}

	#syncVisibility() {
		const micrio = this.getMicrio();
		const isSame = micrio ? get(micrio.current) == this.#props.image : false;
		const zoomedOut = this.#checkHidden?.() ?? false;
		if (!isSame || (this.#autoHide && zoomedOut))
			this.#_canvas.classList.add('hidden');
		else
			this.#_canvas.classList.remove('hidden');
	}

	setProps(props: Partial<MinimapProps>) {
		if (props.image !== undefined) this.#props.image = props.image;
	}

	onDestroy() {
		clearTimeout(this.#to);
	}
}

customElements.define(MicrioMinimap.tag, MicrioMinimap);
