import type { HTMLMicrioElement } from '$core/element';
import type { Unsubscriber } from '$core/store';
import { MicrioImage } from '$core/image';
import { DataLoader } from '$utils/dataLoader';

export interface MicrioSplitLink {
	micrioId: string;
	markerId?: string;
	follows?: boolean;
}

export function parseSplitLink(raw?: string): MicrioSplitLink | undefined {
	if (!raw) return;
	const parts = raw.split(',').map(s => s.trim());
	if (!parts[0]) return;
	return {
		micrioId: parts[0],
		markerId: parts[1] || undefined,
		follows: !!parts[2] && parts[2] !== 'false',
	};
}

interface SplitState {
	secondary: MicrioImage;
	unsub: Unsubscriber | null;
}

const splits = new Map<MicrioImage, SplitState>();

export function hasSplit(primary: MicrioImage): boolean {
	return splits.has(primary);
}

export function getSplitSecondary(primary: MicrioImage): MicrioImage | undefined {
	return splits.get(primary)?.secondary;
}

export function isSplitSecondary(image: MicrioImage): boolean {
	for (const s of splits.values()) {
		if (s.secondary === image) return true;
	}
	return false;
}

export async function openSplit(
	micrio: HTMLMicrioElement,
	primary: MicrioImage,
	link: MicrioSplitLink,
	opts?: { isPassive?: boolean },
): Promise<void> {
	if (splits.has(primary)) return;
	if (primary._noImage || primary.grid || isSplitSecondary(primary)) return;

	const bundle = await DataLoader._getBundleImage(link.micrioId);
	if (!bundle) return;
	
	const secondary = new MicrioImage(micrio._engine, bundle);
	micrio._canvases.push(secondary);
	micrio._engine._addCanvasDirect(secondary);

	secondary._opacity = 0;

	if (opts?.isPassive !== false) secondary._isPassiveSecondary = true;

	const portrait = micrio.canvas.viewport.portrait;
	primary.camera.setArea(portrait ? [0, 0, 1, 0.5] : [0, 0, 0.5, 1]);
	secondary.camera.setArea(
		portrait ? [0, 1, 1, 0] : [1, 0, 0, 1],
		{ direct: true }
	);
	secondary.camera.setArea(
		portrait ? [0, 0.5, 1, 0.5] : [0.5, 0, 0.5, 1]
	);

	let unsub: Unsubscriber | null = null;
	if (opts?.isPassive !== false) {
		unsub = primary.state.view.subscribe(v => {
			if (v && !secondary.camera._aniDone)
				secondary.camera.setView(v, { noLimit: true });
		});
	}

	if (link.markerId) {
		let unsubData: (() => void) | undefined;
		unsubData = secondary.data.subscribe(d => {
			if (!d) return;
			const m = d.markers?.find(m => m.id === link.markerId);
			if (m?.view) secondary.camera.flyToView(m.view, { isJump: true });
			unsubData?.();
		});
	}

	splits.set(primary, { secondary, unsub });
	micrio.events._dispatch('splitscreen-start', secondary);
}

export function closeSplit(
	micrio: HTMLMicrioElement,
	primary: MicrioImage,
	opts?: { keepSecondaryCanvas?: boolean },
): void {
	const state = splits.get(primary);
	if (!state) return;
	splits.delete(primary);

	state.unsub?.();

	const portrait = micrio.canvas.viewport.portrait;
	state.secondary.camera.setArea(
		portrait ? [0, 1, 1, 0] : [1, 0, 0, 1],
		{ direct: true }
	);
	primary.camera.setArea([0, 0, 1, 1]);

	if (!opts?.keepSecondaryCanvas) {
		setTimeout(() => micrio._engine._removeCanvas(state.secondary), 400);
	}
	micrio.events._dispatch('splitscreen-stop', state.secondary);
}

export function closeAllSplits(micrio: HTMLMicrioElement): void {
	for (const p of [...splits.keys()]) closeSplit(micrio, p);
}
