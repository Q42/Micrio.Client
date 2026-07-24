import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { DataLoader } from '$utils/dataLoader';
import { getSpaceVector } from '$utils/space';
import { i18n } from '$core/i18n/strings';
import { createElement } from '$utils/dom';

export interface WaypointProps {
	targetId: string;
	settings?: Models.Spaces.WayPointSettings;
	image: MicrioImage;
}
import './waypoint.css';

class MicrioWaypoint extends MicrioElement<WaypointProps> {
	static tag = 'micrio-waypoint';

	#props: WaypointProps = { targetId: '', image: null! };

	#clicked = false;
	#hidden = false;
	#targetImage: Models.ImageData.ImageData | undefined;
	#coords!: Models.Spaces.WaypointCoords;
	#iface!: Models.Spaces.WaypointInterface;
	#fto: any;
	#vector!: Models.Camera.Vector;
	#click: (() => void) | undefined;
	#focus: (() => void) | undefined;

	_onMount() {
		this.#setup();
		this.#render();
	}

	_setProps(props: Partial<WaypointProps>) {
		if (props.targetId !== undefined) this.#props.targetId = props.targetId;
		if (props.image !== undefined) this.#props.image = props.image;
		if (props.settings !== undefined) this.#props.settings = props.settings;
		if (this.isConnected) { this.#setup(); this.#render(); }
	}

	#setup() {
		const { targetId, image, settings } = this.#props;
		if (!image || !targetId) return;

		const micrio = this._getMicrio();
		if (!micrio) return;

		const info = image.$info as Models.ImageInfo.ImageInfo;
		const vectorData = getSpaceVector(micrio, targetId);
		if (!vectorData) { console.error(`[Micrio] Could not calculate vector for target ${targetId}`); return; }

		const { directionX, v, vN, vector } = vectorData;
		this.#vector = vector;
		const isOnGround = Math.abs(vN[1]) < .3;
		const defaultY = isOnGround ? .65 : .5 + vN[1] / 10;

		const autoCoords: Models.Spaces.WaypointCoords = {
			x: directionX, y: defaultY,
			baseScale: info.width / 1024, scale: 1,
			rotX: (1 + (isOnGround ? -(1 - defaultY) : vN[1])) * Math.PI / 2,
			rotY: 0, rotZ: 0
		};

		const customCoords = settings?.coords ?? structuredClone(autoCoords);
		const isCustom = customCoords.custom;
		this.#coords = isCustom ? customCoords : autoCoords;

		this.classList.toggle('direction-up', v[1] < 0);
		this.classList.toggle('direction-down', v[1] > 0);

		const click = () => {
			if (image.$settings._markers?.noMarkerActions) return;
			this.#clicked = true;
			image._openedView = undefined;
			image.state.marker.set(undefined);
			micrio.open(targetId, { vector: this.#vector });
		};

		const focus = () => {
			if (image.$settings._markers?.noMarkerActions) return;
			(this.parentNode as HTMLElement)?.scrollTo(0, 0);
			clearTimeout(this.#fto);
			this.#fto = setTimeout(() => {
				const px = image.camera.getXY(this.#coords.x, this.#coords.y);
				if (!this.#clicked && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image._is360 ? px[3] > 4 : false)))
					image.camera.flyToCoo([this.#coords.x, this.#coords.y], { speed: 2, limit: true }).catch(() => { });
			}, 150);
		};

		const onmove = () => {
			if (this.#hidden) return;
			this.style.transform = `matrix3d(${image.camera.getMatrix(
				this.#coords.x, this.#coords.y,
				this.#coords.baseScale * this.#coords.scale,
				1, this.#coords.rotX, this.#coords.rotY, this.#coords.rotZ,
				0, 1, 1, true
			).join(',')})`;
		};

		const self = this;
		this.#iface = {
			coords: customCoords,
			settings: settings ?? {} as Models.Spaces.WayPointSettings,
			click: () => { },
			get deleted() { return false; },
			set deleted(v: boolean) { if (v) self.#hidden = true; }
		} as Models.Spaces.WaypointInterface & { click: () => void };

		onmove();

		this._addCleanup(image.state.view.subscribe(onmove));
		DataLoader.getData(targetId).then(d => { if (d) this.#targetImage = d; this.#render(); });

		micrio.dispatchEvent(new CustomEvent('wp-print', { detail: this.#iface }));

		// Store handlers
		this.#click = click;
		this.#focus = focus;
	}

	#render() {
		if (this.#hidden) { this.style.display = 'none'; return; }

		const { settings } = this.#props;
		const micrio = this._getMicrio();
		const $_lang = micrio ? get(micrio._lang) : 'en';
		const $i18n = get(i18n);
		const spaceData = micrio?.spaceData;

		const title = settings?.i18n?.[$_lang]?.title || this.#targetImage?.i18n?.[$_lang]?.title;
		const icon = spaceData?.icons?.[settings?.customIconIdx ?? -1];

		this.classList.toggle('clicked', this.#clicked);

		this.replaceChildren();
		createElement('micrio-button', {
			setProps: {
				type: icon ? undefined : 'up',
				icon: icon || undefined,
				title: title ?? $i18n._waypointFollow,
				onclick: this.#click,
				onfocus: this.#focus,
			},
			parent: this
		});
	}

	_onDestroy() {
		clearTimeout(this.#fto);
	}
}

customElements.define(MicrioWaypoint.tag, MicrioWaypoint);
