import type { Grid } from './grid';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { slideAreas, swipeAreas, swipeExitAreas } from './format';
import { sleep } from '$utils/dom';

export function setupBehindTransition(
	grid: Grid,
	images: Models.Grid.GridImage[],
	opts: {
		coverLimit?: boolean;
		forceAni?: boolean;
		forceAreaAni?: boolean;
		transition?: Models.Grid.GridSetTransition;
	},
	focussed: MicrioImage|undefined
): void {
	const isDelayed = opts.transition == 'behind-delayed';
	const isLim = opts.coverLimit === true;
	opts.forceAni = true;
	opts.coverLimit = isLim;
	opts.forceAreaAni = true;
	const vW = isDelayed ? 1/images.length : 1;
	let c = 0;
	grid.images.forEach(i => {
		i.camera.setCoverLimit(isLim);
		if(images.find(e => e.id == i.id)) {
			i.camera.setArea([0,0,focussed?.id == i.id ? 1 : vW,1], {noDispatch: true, direct: true});
			if(i != focussed) i.camera.setView([0,0,1,1]);
			if(isDelayed && i.canvas) i.canvas.zIndex = images.length-(c++);
		}
	});
	images.forEach(e => e.view = [0,0,1,1]);
}

export async function transition(
	grid: Grid,
	target: MicrioImage,
	current: MicrioImage|undefined,
	{duration, view, transition: trans, noViewAni, exitView, blur, cover}:Models.Grid.FocusOptions
) : Promise<({image: MicrioImage} & Models.Grid.GridImageOptions)[]> {
	if(!trans) return [{image: target, view}];

	if(trans == 'crossfade') {
		target.camera.setArea([0,0,1,1]);
		noViewAni = true;
	}

	if(view && noViewAni) target.camera.setView(view, {noRender: true, noLimit: true});

	if(!current || trans == 'crossfade') return [{image: target, view}];

	const isSlwipe = trans.startsWith('slide') || trans.startsWith('swipe');
	const isBehind = trans.startsWith('behind');
	const transDir:(number|undefined) = !isSlwipe ? undefined
		: trans.endsWith('-up') ? 0
		: trans.endsWith('-down') ? 180
		: trans.endsWith('-left') ? 270
		: 90;

	if(isSlwipe || isBehind) { const c = target.canvas; if (c) { c.targetOpacity = .9999; c.opacity = .9999; } }

	if(trans.startsWith('slide')) {
		target.camera.setArea(slideAreas[transDir!], {noDispatch: true, direct: true});
	}
	else if(trans.startsWith('swipe')) {
		target.camera.setArea(swipeAreas[transDir!], {noDispatch: true, direct: true});
	}
	else if(isBehind) {
		target.camera.setArea([0,0,1,1]);
		target.camera.setView([0,0,1,1]);
		const between: ({image: MicrioImage} & Models.Grid.GridImageOptions)[] = [
			{image: current, view: [0,0,1,1]},
			{image: target, view: [0,0,1,1]}
		];
		if(trans == 'behind-left') between.reverse();
		await grid.set(between, {
			noBlur: true,
			horizontal: true,
			coverLimit: cover
		}).then(() => sleep(200));
	}

	if(blur && !isNaN(blur) && blur > 0) {
		duration = duration ?? grid.nextCrossFadeDuration ?? grid.aniDurationIn;
		const blurSpeed = duration/2;
		const style = grid.micrio.canvas.element.style;
		style.transition = `filter ${blurSpeed}s ease`;
		style.filter = `blur(${blur}px)`;
		setTimeout(() => {
			style.filter = '';
			setTimeout(() => style.transform = '', blurSpeed*1000);
		}, blurSpeed*1000);
	}

	if (trans.startsWith('swipe')) {
		return [
			{image: current, view: exitView ?? current.camera.getView(), area: swipeExitAreas[transDir!]},
			{image: target, view, area: [0, 0, 1, 1]},
		];
	}

	return [{image: target, view}];
}
