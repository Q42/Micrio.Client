import type { Camera } from './camera';
import type { MicrioImage } from '$core/image';
import type { Writable } from '$core/store';

/** OmniImage types */
export namespace Omni {
	export interface Frame {
		id: string;
		image: MicrioImage;
		visible: Writable<boolean>;
		frame: number;
		thumbSrc?: string;
		baseTileIdx: number;
		ptr: number;
		opts: { area: Camera.View; };
	}
}
