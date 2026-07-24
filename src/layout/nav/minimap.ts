import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { mod1 } from '$utils/math';
import { Browser } from '$utils/browser';
import { createElement } from '$utils/dom';

export interface MinimapProps {
	image: MicrioImage;
}
import './minimap.css';

class MicrioMinimap extends MicrioElement<MinimapProps> {
	static tag = 'micrio-minimap';

	#props: MinimapProps = { image: null! };
	#_ctx: CanvasRenderingContext2D | null = null;
	#dragViewDims: { width: number; height: number } | undefined;
	#mapRect: DOMRect | undefined;
	#unsubView: (() => void) | undefined;

	_onMount() {
		this.#setup();
	}

	_setProps(props: Partial<MinimapProps>) {
		if (props.image !== undefined && props.image !== this.#props.image) {
			this.#props.image = props.image;
			if (this.isConnected) {
				this.#unsubView?.();
				this.replaceChildren();
				this.#_ctx = null;
				this.#setup();
			}
		}
	}

	#setup() {
		const { image } = this.#props;
		const micrio = this._getMicrio();
		if (!micrio || !image) return;

		const info = image.$info;
		if (!info) return;
		const camera = image.camera;
		const settings = image.$settings;

		const maxWidth = settings.minimapWidth ?? 200;
		const maxHeight = settings.minimapHeight ?? 160;
		const aspect = info.width / info.height;
		const width = maxWidth / aspect > maxHeight ? Math.round(maxHeight * aspect) : maxWidth;
		const height = maxWidth / aspect <= maxHeight ? Math.round(maxWidth / aspect) : maxHeight;
		const offset = -camera.rotationY / (Math.PI * 2);
		const isolated = self.crossOriginIsolated;
		let thumbSrc: string | undefined = isolated ? undefined : image.thumbSrc;

		const draw = (area: Models.Camera.View | undefined) => {
			if (!area || !this.#_ctx) return;
			const ctx = this.#_ctx;
			ctx.clearRect(0, 0, width, height);

			const hasThumb = !!(image.thumbSrc || thumbSrc);
			if (info.is360) {
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
				const hw = Math.max(1, Math.round(area[2] * width / 2));
				ctx.fillStyle = hasThumb ? 'white' : 'rgba(255,255,255,.8)';
				ctx.fillRect(Math.round(px - hw), 0, hw * 2, height);
				const hh = Math.max(1, Math.round(area[3] * height / 2));
				ctx.fillRect(0, Math.round(py - hh), width, hh * 2);
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
			this.#mapRect = canvas.getBoundingClientRect();
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

		const canvas = createElement('canvas', {
			props: { width, height },
			className: settings.alwaysShowMinimap ? 'fixed' : undefined,
			events: { mousedown: dStart as EventListener },
			parent: this
		});
		if (thumbSrc) {
			canvas.style.backgroundImage = `url('${thumbSrc}')`;
			if (offset != 0) canvas.style.backgroundPositionX = `${width * offset}px`;
		}
		canvas.addEventListener('wheel', wheel, { passive: true });

		this.#_ctx = canvas.getContext('2d');
		if (this.#_ctx) {
			this.#_ctx.lineWidth = 1;
			this.#_ctx.strokeStyle = 'white';
		}

		if (isolated && image.thumbSrc) {
			fetch(image.thumbSrc).then(r => r.blob()).then(b => {
				thumbSrc = URL.createObjectURL(b);
				canvas.style.backgroundImage = `url('${thumbSrc}')`;
				draw(get(image.state.view));
			});
		}

		this.#unsubView?.();
		this.#unsubView = image.state.view.subscribe(draw);
		this._addCleanup(this.#unsubView);
	}

}

customElements.define(MicrioMinimap.tag, MicrioMinimap);
