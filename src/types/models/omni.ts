import type { Camera } from './camera';
import type { MicrioImage } from '$core/image';
import type { Writable } from '$core/store';
/** OmniImages */
export namespace Omni {
	export interface Frame {
		id: string;
		image: MicrioImage;
		visible: Writable<boolean>;
		_frame: number;
		thumbSrc?: string;
		_baseTileIdx: number;
		_placed: boolean;
		opts: { area: Camera.View; };
	}
}
