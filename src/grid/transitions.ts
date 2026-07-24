import type { Grid } from './grid';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { slideAreas, swipeAreas, swipeExitAreas } from './format';
import { sleep } from '$utils/dom';

/** Configure the grid images for a "behind" or "behind-delayed" transition layout. */
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
	grid._images.forEach(i => {
		i.camera.setCoverLimit(isLim);
		if(images.find(e => e.id == i.id)) {
			i.camera.setArea([0,0,focussed?.id == i.id ? 1 : vW,1], {noDispatch: true, direct: true});
			if(i != focussed) i.camera.setView([0,0,1,1]);
			if(isDelayed && i.canvas) i.canvas.zIndex = images.length-(c++);
		}
	});
	images.forEach(e => e.view = [0,0,1,1]);
}

/** Perform a transition animation (crossfade, slide, swipe, or behind) between two images. */
export async function transition(
	grid: Grid,
	target: MicrioImage,
	current: MicrioImage|undefined,
	{duration, view, transition: trans, noViewAni, exitView, blur, cover}:Models.Grid.FocusOptions
) : Promise<Models.Grid.GridImage[]> {
	if(!trans) return [{id: target.id, size: [1], view}];

	if(trans == 'crossfade') {
		target.camera.setArea([0,0,1,1]);
		noViewAni = true;
	}

	if(view && noViewAni) target.camera.setView(view, {noRender: true, noLimit: true});

	if(!current || trans == 'crossfade') return [{id: target.id, size: [1], view}];

	const isSlwipe = trans.startsWith('slide') || trans.startsWith('swipe');
	const isBehind = trans.startsWith('behind');
	const transDir:(number|undefined) = !isSlwipe ? undefined
		: trans.endsWith('-up') ? 0
		: trans.endsWith('-down') ? 180
		: trans.endsWith('-left') ? 270
		: 90;

	if(isSlwipe || isBehind) { const c = target.canvas; if (c) { c._targetOpacity = .9999; c._opacity = .9999; } }

	if(trans.startsWith('slide')) {
		target.camera.setArea(slideAreas[transDir!], {noDispatch: true, direct: true});
	}
	else if(trans.startsWith('swipe')) {
		target.camera.setArea(swipeAreas[transDir!], {noDispatch: true, direct: true});
	}
	else if(isBehind) {
		target.camera.setArea([0,0,1,1]);
		target.camera.setView([0,0,1,1]);
		const between: Models.Grid.GridImage[] = [
			{id: current.id, size: [1], view: [0,0,1,1]},
			{id: target.id, size: [1], view: [0,0,1,1]}
		];
		if(trans == 'behind-left') between.reverse();
		await grid.set(between, {
			noBlur: true,
			horizontal: true,
			coverLimit: cover
		}).then(() => sleep(200));
	}

	if(blur && !isNaN(blur) && blur > 0) {
		duration = duration ?? grid._nextCrossFadeDuration ?? grid._aniDurationIn;
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
			{id: current.id, size: [1], view: exitView ?? current.camera.getView(), area: swipeExitAreas[transDir!]},
			{id: target.id, size: [1], view, area: [0, 0, 1, 1]},
		];
	}

	return [{id: target.id, size: [1], view}];
}
