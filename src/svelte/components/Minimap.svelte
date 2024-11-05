<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Models } from '../../types/models';

	import { onMount, getContext, } from 'svelte';

	export let image:MicrioImage;

	const info = image.$info as Models.ImageInfo.ImageInfo;
	const camera = image.camera;
	const settings = image.$settings;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const current = micrio.current;
	const viewport = micrio.canvas.viewport;

	const maxWidth:number = settings.minimapWidth ?? 200;
	const maxHeight:number = settings.minimapHeight ?? 160;
	const autoHide:boolean = !settings.alwaysShowMinimap;
	const noControls:boolean = !!settings.noControls;

	const aspect = info.width / info.height;
	const width = maxWidth / aspect > maxHeight ? Math.round(maxHeight * aspect) : maxWidth;
	const height = maxWidth / aspect <= maxHeight ? Math.round(maxWidth / aspect) : maxHeight;

	let _canvas:HTMLCanvasElement;
	let _ctx:CanvasRenderingContext2D|null;

	let hidden:boolean = false;
	let zoomedOut:boolean = !info.is360 && camera.isZoomedOut();

	function getPoly() : number[] {
		const ret:number[] = [];
		const w:number = viewport.width * viewport.ratio;
		const h:number = viewport.height * viewport.ratio;
		const segments:number = 8;
		const center:Float64Array = camera.getCoo(w/2, h/2).slice(0);
		const coords:number[] = [];

		// Top
		for(let x=0;x<segments;x++) coords.push(x/segments*w, 0);
		for(let y=0;y<segments;y++) coords.push(w, y/segments*h);
		for(let x=0;x<segments;x++) coords.push((1-x/segments)*w,h);
		for(let y=0;y<segments;y++) coords.push(0, (1-y/segments)*h);

		for(let i=0;i<coords.length;i+=2) {
			const coo = camera.getCoo(coords[i], coords[i+1]);

			// Keep left left and right right
			if((i > 2.5 * segments * 2 || i < segments) && coo[0] > center[0]) coo[0]-=1;
			else if((i > segments && i < 2.5 * segments * 2) && coo[0] < center[0]) coo[0]+=1;

			ret.push(coo[0],coo[1]);
		}

		return ret;
	}

	function draw(area:Models.Camera.View|undefined): void{
		if(!area || !_ctx) return;
		moved();

		_ctx.clearRect(0,0, width, height);

		if(image.thumbSrc) {
			_ctx.globalCompositeOperation = 'source-over';
			_ctx.fillStyle = 'rgba(0,0,0,.5)';
			_ctx.fillRect(0, 0, width, height);

			_ctx.globalAlpha = 1;
			_ctx.globalCompositeOperation = 'destination-out';
		} else {
			_ctx.fillStyle = 'rgba(0,0,0,.5)';
			_ctx.fillRect(0, 0, width, height);
		}

		_ctx.beginPath();
		_ctx.fillStyle = 'white';

		if(info.is360) {
			const t = getPoly();
			_ctx.moveTo(t[0] * width, t[1] * height);
			for(let i=2;i<t.length;i+=2)
				_ctx.lineTo(t[i] * width, t[i+1] * height);
			_ctx.closePath();
		}
		else {
			zoomedOut = camera.isZoomedOut();
			_ctx.rect(
				Math.floor(area[0]*width),
				Math.floor(area[1]*height),
				Math.ceil((area[2]-area[0])*width),
				Math.ceil((area[3]-area[1])*height)
			);
		}

		if(image.thumbSrc) {
			_ctx.fill();
			_ctx.globalCompositeOperation = 'source-over';
		}

		_ctx.stroke();

	}

	const isFirefox:boolean = navigator.userAgent.indexOf('Firefox') != -1;
	function wheel(e:WheelEvent):void {
		camera.zoom(e.deltaY * (isFirefox ? 50 : 1));
	}

	let dragging:boolean = false;
	let mapRect:DOMRect|undefined;
	function dStart(e:MouseEvent): void {
		if(e.button != 0) return;
		window.addEventListener('mousemove', dDraw);
		window.addEventListener('mouseup', dStop);
		mapRect = _canvas.getClientRects()[0];
		dDraw(e);
		dragging = true;
	}

	function dDraw(e:MouseEvent): void {
		if(mapRect) camera.setCoo(
			Math.max(0, Math.min(1, (e.clientX - mapRect.left) / mapRect.width)),
			Math.max(0, Math.min(1, (e.clientY - mapRect.top) / mapRect.height))
		);
	}

	function dStop(): void {
		window.removeEventListener('mousemove', dDraw);
		window.removeEventListener('mouseup', dStop);
		dragging = false;
	}

	let to:number|undefined;
	function moved(): void {
		hidden = false;
		clearTimeout(to);
		to = <any>setTimeout(() => hidden = true, 2500) as number;
	}

	const offset = .5 - image.camera.trueNorth;

	const isolated = self.crossOriginIsolated;
	let thumbSrc:string|undefined = isolated ? undefined : image.thumbSrc;

	const passive:AddEventListenerOptions = {passive: true};
	let mounted = false;
	onMount(() => {
		_ctx = _canvas.getContext('2d');
		if(_ctx) {
			_ctx.lineWidth = 1;
			_ctx.strokeStyle = 'white';
		}

		let dataUri:string|undefined;
		if(isolated && image.thumbSrc) fetch(image.thumbSrc).then(r => r.blob())
			.then(b => thumbSrc = dataUri = URL.createObjectURL(b));

		micrio.canvas.element.addEventListener('mousemove', moved, passive);
		const unsub = image.state.view.subscribe(draw);

		setTimeout(() => mounted = true, 10);

		return () => {
			if(dataUri) URL.revokeObjectURL(dataUri);
			micrio.canvas.element.removeEventListener('mousemove', moved, passive);
			dStop();
			unsub();
		}
	});

	$: style = !thumbSrc ? null
		: `background-image: url('${thumbSrc}')`+(offset != 0 ? `;background-position-x:${width*offset}px` : '' );

</script>

<canvas bind:this={_canvas} {width} {height} {style}
	class:hidden={!mounted || $current != image || (autoHide && (zoomedOut||hidden))}
	class:dragging={dragging} class:controls={!noControls}
	on:wheel={wheel} on:mousedown={dStart} />

<style>
	canvas {
		position: absolute;
		bottom: var(--micrio-border-margin);
		right: 5px;
		transform-origin: right bottom;
		display: block;
		background-size: 100%;
		transition: opacity .2s ease;
		cursor: move;
		cursor: -webkit-grab;
		cursor: -moz-grab;
		cursor: -ms-grab;
		cursor: grab;
		-ms-content-zooming: none;
		-ms-touch-action: none;
		touch-action: none;
		border-radius: var(--micrio-border-radius);
	}
	canvas:not(:hover).hidden {
		opacity: 0;
		pointer-events: none;
	}
	canvas.dragging {
		cursor: -webkit-grabbing;
		cursor: -moz-grabbing;
		cursor: -ms-grabbing;
		cursor: grabbing;
	}
	canvas.controls {
		right: calc(var(--micrio-border-margin) + var(--micrio-button-size) + 8px);
	}

	@media (max-width: 800px) {
		canvas {
			transform: scale3d(.5,.5,1);
			pointer-events: none;
			right: 65px;
		}
	}
</style>
