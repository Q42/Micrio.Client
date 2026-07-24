import type { Grid } from './grid';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { GridActionType } from './actions';
import { get } from '$core/store';


function switchToGrid(grid: Grid): void {
	const focus = grid.$focussed;
	if(!focus) return;
	const v = focus.camera.getView();
	if(v) grid.reset(0, true).then(() => {
		if(focus.opts.area) grid.image.camera.setView(focus.opts.area, {noLimit: true});
		focus.camera.setView(v, {noLimit: true});
		grid.micrio.current.set(grid.image);
	});
}

export function createTourEventHandler(grid: Grid): (e: Event) => void {
	return (e: Event): void => {
		const event = (e as CustomEvent).detail as Models.ImageData.Event;
		if(!event || !event.action?.startsWith('grid:')) return;
		if(event.active) handleAction(grid, event.action.slice(5), event.data, event.end - event.start);
	};
}

const handlerMaps = new WeakMap<Grid, Record<number, (data?: string, duration?: number) => void>>();

function getHandlerMap(grid: Grid): Record<number, (data?: string, duration?: number) => void> {
	let map = handlerMaps.get(grid);
	if (!map) {
		map = {
			[GridActionType.focus]: (data, duration) => {
				const spl = data?.split('|').map(s => s.trim());
				const name = spl?.[0]??'';
				const imgs = name.split(',')
					.map(i => grid._imageMap.get(i.trim()))
					.filter((i): i is MicrioImage => i !== undefined);
				if(imgs.length == 1) grid.gridFocus(imgs[0], {duration});
				else if(imgs.length > 0) grid.set(imgs.map(i => ({id: i.id, size: [1] as [number, number?]})), {
					duration,
					horizontal: spl?.[1] == 'h'
				});
			},

			[GridActionType.flyTo]: (data, duration) => {
				const images = data?.split(',').map(s => grid._current.find(i => i.id == s?.trim()));
				if(images?.length) {
					const xs = images.map(i => i?.opts.area?.[0] ?? 0);
					const ys = images.map(i => i?.opts.area?.[1] ?? 0);
					const right = Math.max(...images.map(i => (i?.opts.area?.[0] ?? 0) + (i?.opts.area?.[2] ?? 1)));
					const bottom = Math.max(...images.map(i => (i?.opts.area?.[1] ?? 0) + (i?.opts.area?.[3] ?? 1)));
					const minX = Math.min(...xs);
					const minY = Math.min(...ys);
					grid.image.camera.flyToView([
						minX,
						minY,
						right - minX,
						bottom - minY,
					], {duration:duration?duration*1000:undefined}).catch(()=>{});
				}
				else console.warn('Given image IDs gave no current displayed images');
			},

			[GridActionType.focusTagged]: (data, duration) => {
				grid._flyToMarkers(data, duration);
			},

			[GridActionType.focusWithTagged]: (data, duration) => {
				grid._flyToMarkers(data, duration, true);
			},

			[GridActionType.reset]: (_data, duration) => {
				grid.reset(duration);
			},

			[GridActionType.back]: (_data, duration) => {
				grid.back(duration);
			},

			[GridActionType.switchToGrid]: () => {
				switchToGrid(grid);
			},

			[GridActionType.nextFadeDuration]: (data) => {
				grid._nextCrossFadeDuration = Number(data);
			},

			[GridActionType.filterTourImages]: (data, duration) => {
				const t = get(grid.micrio.state.tour);
				if(!t || !('steps' in t) || !t.stepInfo) return;
				const ids = t.stepInfo.map(s => s.micrioId);
				const imgs = ids.filter((id, i) => ids.indexOf(id) == i)
					.map(i => grid._imageMap.get(i))
					.filter((i): i is MicrioImage => !!i)
				if(imgs.length) grid.set(imgs.map(i => ({id: i.id, size: [1] as [number, number?]})), {
					duration,
					horizontal: data == 'h'
				});
			},
		};
		handlerMaps.set(grid, map);
	}
	return map;
}

export function handleAction(grid: Grid, action: GridActionType|string, data?: string, duration?: number): void {
	if(typeof action == 'string') action = GridActionType[action as keyof typeof GridActionType];
	const key = action+(data??'');
	if(grid._lastAction == key) return;
	const handler = getHandlerMap(grid)[action as number];
	if(handler) handler(data, duration);
	else console.warn('Warning: unknown grid tour event', action);
	grid._lastAction = key;
}
