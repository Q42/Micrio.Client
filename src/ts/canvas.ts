import type { Writable } from 'svelte/store';
import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';

import { Browser } from './utils';
import { get, writable } from 'svelte/store';

/** Micrio sizing and `<canvas>` controller */
export class Canvas {
	/** The Micrio WebGL rendering `<canvas>` element */
	readonly element:HTMLCanvasElement = document.createElement('canvas');

	/** Resize observer
	 * @internal
	 * @readonly
	*/
	private resizeObserver?:ResizeObserver;

	/** Currently resizing
	 * @internal
	*/
	resizing:boolean = false;

	/** Has or had 360 content
	 * @internal
	*/
	private hasPerspective:boolean = false;

	/** Canvas sizing information */
	readonly viewport:Models.Canvas.ViewRect = {
		width:0,
		height:0,
		left:0,
		top:0,
		ratio:0,
		scale:0,
		portrait:false
	};

	/** Client is a mobile device, Writable */
	readonly isMobile:Writable<boolean> = writable<boolean>(false);

	/** Client is a mobile device, Writable value */
	get $isMobile():boolean { return get(this.isMobile) };

	constructor(private micrio:HTMLMicrioElement) {
		this.onresize = this.onresize.bind(this);
		if(self.ResizeObserver) this.resizeObserver = new self.ResizeObserver(this.onresize);
		this.element.className = 'micrio';
	}

	/** Place the <canvas> element
	 * @internal
	*/
	place(){
		if(this.element.parentNode) return;
		const img = this.micrio.querySelector('img.preview');
		this.micrio.insertBefore(this.element,img ? img.nextSibling : this.micrio.firstChild);
	}

	/** Hook camera resize event listener
	 * @internal
	*/
	hook() : void {
		this.onresize();

		if(this.resizeObserver) this.resizeObserver.observe(this.element);
		else window.addEventListener('resize', this.onresize);
	}

	/** Unhook any event listeners
	 * @internal
	*/
	unhook() : void {
		if(this.resizeObserver) this.resizeObserver.unobserve(this.element);
		else window.removeEventListener('resize', this.onresize);
	}

	/** Micrio element resize handler */
	onresize() : void {
		/** @ts-ignore -- If in VR, don't do anything */
		//if(this.micrio.webgl.display['isPresenting']) return;

		// Default _rendered_ size, after transform applications
		const box = this.element.getBoundingClientRect();

		if(this.micrio.$current?.is360) this.hasPerspective = true;

		let width = box.width;
		let height = box.height;

		// Not displaying anything (could be display: none)
		if(!width || !height) return;

		// This one is for when weird transitions are applied
		const st = self.getComputedStyle(this.element);

		const originalW = parseFloat(st.width);
		if(!isNaN(originalW)) height = parseFloat(st.height) * width / Math.max(1, originalW);

		// Possible forced css-scaling of main element
		const scale = this.micrio.hasAttribute('data-static') ? 1 : Math.floor(width) / this.micrio.offsetWidth;
		width /= scale;
		height /= scale;

		const ratio = scale != 1 ? 1 : this.getRatio();

		const c = this.viewport;
		if(c.width == width && c.height == height && c.ratio == ratio && c.scale == scale) return;

		if(this.hasPerspective) this.micrio.style.perspective = height / 2 + 'px';

		c.width = width;
		c.height = height;
		c.ratio = ratio;
		c.scale = scale;
		c.top = box.top;
		c.left = box.left;
		c.portrait = window.matchMedia('(orientation: portrait)')?.matches;

		this.resizing = true;
		this.element.width = width * ratio;
		this.element.height = height * ratio;
		this.micrio.webgl.gl.viewport(0, 0, c.width*c.ratio, c.height*c.ratio);

		this.micrio.wasm.resize(c);
		this.resizing = false;

		this.micrio.events.dispatch('resize', box);

		setTimeout(() => this.isMobile.set(/mobile/i.test(navigator.userAgent)), 10);
	}

	/** Get the screen pixel ratio
	 * @returns The device pixel ratio
	 */
	public getRatio = (s:Partial<Models.ImageInfo.Settings> = this.micrio.$current?.$settings ?? {}) : number => !Browser.iOS && !s?.noRetina
		&& self.devicePixelRatio && Math.max(1, Math.min(2, self.devicePixelRatio))
		|| 1;

	/** Set virtual offset margins applied to all viewports
	 * @param width The offset width in pixels
	 * @param height The offset height in pixels
	*/
	public setMargins(width:number, height:number) : void {
		this.micrio.wasm.e.setArea(this.micrio.wasm.getPtr(), width, height);
	}

}
