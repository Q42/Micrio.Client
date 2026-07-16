import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { toCenterJSON } from '$ts/utils/math';
import { afterFrame } from '$ts/utils/dom';

export interface MinimapProps {
	image: MicrioImage;
}

export class MicrioMinimap extends MicrioElement<MinimapProps> {
	static tag = 'micrio-minimap';
	static styles = `micrio-minimap canvas{position:absolute;bottom:var(--micrio-border-margin);right:5px;transform-origin:right bottom;display:block;background-size:100%;transition:opacity .2s ease;cursor:grab;-ms-content-zooming:none;-ms-touch-action:none;touch-action:none;border-radius:var(--micrio-border-radius)}
micrio-minimap canvas:not(:hover).hidden{opacity:0;pointer-events:none}
micrio-minimap canvas.dragging{cursor:grabbing}
micrio-minimap canvas.controls{right:calc(var(--micrio-border-margin) + var(--micrio-button-size) + 8px)}
@media(max-width:800px){micrio-minimap canvas{transform:scale3d(.5,.5,1);pointer-events:none;right:65px}}`;

	#props: MinimapProps = { image: null! };
	#unsubs: (() => void)[] = [];
	#_canvas!: HTMLCanvasElement;
	#_ctx: CanvasRenderingContext2D | null = null;
	#hidden = false;
	#to: any;
	#dragViewDims: { width: number; height: number } | undefined;
	#mapRect: DOMRect | undefined;

	onMount() {
		const { image } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !image) return;

		const info = image.$info;
		if (!info) return;
		const camera = image.camera;
		const settings = image.$settings;

		const maxWidth = settings.minimapWidth ?? 200;
		const maxHeight = settings.minimapHeight ?? 160;
		const autoHide = !settings.alwaysShowMinimap;
		const noControls = !!settings.noControls;
		const aspect = info.width / info.height;
		const width = maxWidth / aspect > maxHeight ? Math.round(maxHeight * aspect) : maxWidth;
		const height = maxWidth / aspect <= maxHeight ? Math.round(maxWidth / aspect) : maxHeight;
		const offset = -camera.rotationY / (Math.PI * 2);
		const isolated = self.crossOriginIsolated;
		let thumbSrc: string | undefined = isolated ? undefined : image.thumbSrc;

		const draw = (_area: Models.Camera.View | undefined) => {
			if (!_area || !this.#_ctx) return;
			this.#moved();
			const area = toCenterJSON(_area);
			this.#_ctx.clearRect(0, 0, width, height);
			if (image.thumbSrc || thumbSrc) {
				this.#_ctx.globalCompositeOperation = 'source-over';
				this.#_ctx.fillStyle = 'rgba(0,0,0,.5)';
				this.#_ctx.fillRect(0, 0, width, height);
				this.#_ctx.globalAlpha = 1;
				this.#_ctx.globalCompositeOperation = 'destination-out';
			} else {
				this.#_ctx.fillStyle = 'rgba(0,0,0,.5)';
				this.#_ctx.fillRect(0, 0, width, height);
			}
			this.#_ctx.beginPath();
			this.#_ctx.fillStyle = 'white';
			if (info.is360) {
				const rects = this.#get360Rects(_area, width, height);
				for (const r of rects) {
					this.#_ctx.rect(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h));
				}
			} else {
				this.#_ctx.rect(
					Math.floor((area.centerX - area.width / 2) * width),
					Math.floor((area.centerY - area.height / 2) * height),
					Math.ceil(area.width * width), Math.ceil(area.height * height)
				);
			}
			if (image.thumbSrc || thumbSrc) {
				this.#_ctx.fill();
				this.#_ctx.globalCompositeOperation = 'source-over';
			}
			this.#_ctx.stroke();
		};

		const wheel = (e: WheelEvent) => {
			const isFF = navigator.userAgent.indexOf('Firefox') != -1;
			camera.zoom(e.deltaY * (isFF ? 50 : 1));
		};

		const dStart = (e: MouseEvent) => {
			if (e.button != 0) return;
			window.addEventListener('mousemove', dDraw);
			window.addEventListener('mouseup', dStop);
			this.#mapRect = this.#_canvas.getClientRects()[0];
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
		this.#_canvas = document.createElement('canvas');
		this.#_canvas.width = width;
		this.#_canvas.height = height;
		this.#_canvas.className = noControls ? '' : 'controls';
		if (thumbSrc) {
			this.#_canvas.style.backgroundImage = `url('${thumbSrc}')`;
			if (offset != 0) this.#_canvas.style.backgroundPositionX = `${width * offset}px`;
		}
		this.#_canvas.addEventListener('wheel', wheel, { passive: true });
		this.#_canvas.addEventListener('mousedown', dStart);
		this.appendChild(this.#_canvas);

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
		this.#unsubs.push(image.state.view.subscribe(draw));
		// Auto-hide on mouse move over main canvas
		const passive: AddEventListenerOptions = { passive: true };
		micrio.canvas.element.addEventListener('mousemove', () => this.#moved(), passive);
		this.#unsubs.push(() => micrio.canvas.element.removeEventListener('mousemove', () => this.#moved(), passive));

		afterFrame().then(() => {
			const isSame = get(micrio.current) == image;
			const zoomedOut = !info.is360 && camera.isZoomedOut();
			this.#_canvas.classList.toggle('hidden', !isSame || (autoHide && (zoomedOut || this.#hidden)));
		});
	}

	#moved() {
		this.#hidden = false;
		clearTimeout(this.#to);
		this.#to = setTimeout(() => { this.#hidden = true; }, 2500);
	}

	#get360Rects(_area: Models.Camera.View, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
		const rects: { x: number; y: number; w: number; h: number }[] = [];
		const { centerX: cx, centerY: cy, width, height } = toCenterJSON(_area);
		const ncx = ((cx % 1) + 1) % 1;
		let x0 = ncx - width / 2, x1 = ncx + width / 2;
		const y0 = Math.max(0, cy - height / 2), y1 = Math.min(1, cy + height / 2);
		if (x0 < 0) {
			rects.push({ x: Math.floor((x0 + 1) * w), y: Math.floor(y0 * h), w: Math.ceil((1 - (x0 + 1)) * w), h: Math.ceil((y1 - y0) * h) });
			rects.push({ x: Math.floor(0), y: Math.floor(y0 * h), w: Math.ceil(x1 * w), h: Math.ceil((y1 - y0) * h) });
		} else if (x1 > 1) {
			rects.push({ x: Math.floor(x0 * w), y: Math.floor(y0 * h), w: Math.ceil((1 - x0) * w), h: Math.ceil((y1 - y0) * h) });
			rects.push({ x: Math.floor(0), y: Math.floor(y0 * h), w: Math.ceil((x1 - 1) * w), h: Math.ceil((y1 - y0) * h) });
		} else {
			rects.push({ x: Math.floor(x0 * w), y: Math.floor(y0 * h), w: Math.ceil((x1 - x0) * w), h: Math.ceil((y1 - y0) * h) });
		}
		return rects;
	}

	setProps(props: Partial<MinimapProps>) {
		if (props.image !== undefined) this.#props.image = props.image;
	}

	onDestroy() {
		clearTimeout(this.#to);
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMinimap.tag, MicrioMinimap);
