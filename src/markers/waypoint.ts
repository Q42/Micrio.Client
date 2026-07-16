import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { clone } from '$utils/object';
import { DataLoader } from '$utils/dataLoader';
import { getSpaceVector } from '$utils/space';
import { i18n } from '$core/i18n/strings';
import { createElement } from '$utils/dom';

export interface WaypointProps {
	targetId: string;
	settings?: Models.Spaces.WayPointSettings;
	image: MicrioImage;
}

export class MicrioWaypoint extends MicrioElement<WaypointProps> {
	static tag = 'micrio-waypoint';
	static styles = `micrio-waypoint{display:block;position:absolute;transform-style:preserve-3d;width:0;height:0;top:50%;left:50%;--micrio-bb:var(--micrio-button-background);--micrio-bbh:var(--micrio-button-background-hover)}
micrio-waypoint micrio-button{--micrio-button-background:var(--micrio-waypoint-background,var(--micrio-bb));--micrio-button-background-hover:var(--micrio-waypoint-background-hover,var(--micrio-bbh));--micrio-button-size:var(--micrio-waypoint-size);--micrio-border-radius:var(--micrio-waypoint-border-radius,100%);--micrio-icon-size:var(--micrio-waypoint-icon-size,calc(var(--micrio-button-size) - 50px));transform:translate3d(-50%,-50%,0) scale3d(.5,.5,1);pointer-events:all;transition:background-color .25s ease,opacity .25s ease,border-color .25s ease,transform .25s ease;border:var(--micrio-waypoint-border-size,var(--micrio-marker-border-size)) solid var(--micrio-waypoint-border-color,var(--micrio-marker-border-color));margin:0}
micrio-waypoint micrio-button>svg{pointer-events:none;margin:0 auto}
micrio-waypoint:hover micrio-button,micrio-waypoint.active micrio-button{transition:background-color .25s ease,opacity .25s ease,transform .25s ease;transform:translate3d(-50%,-50%,0) scale3d(.6,.6,1)}
micrio-waypoint.clicked micrio-button{animation:micrio-waypoint-pulse .75s ease infinite alternate}
@keyframes micrio-waypoint-pulse{from{transform:translate3d(-50%,-50%,0) scale3d(.5,.5,1)}to{transform:translate3d(-50%,-50%,0) scale3d(.75,.75,1)}}
micrio-waypoint.direction-up micrio-button{/* up */}
micrio-waypoint.direction-down micrio-button{/* down */}`;

	#props: WaypointProps = { targetId: '', image: null! };
	#unsubs: (() => void)[] = [];

	#clicked = false;
	#hidden = false;
	#targetImage: Models.ImageData.ImageData | undefined;
	#coords!: Models.Spaces.WaypointCoords;
	#iface!: Models.Spaces.WaypointInterface;
	#fto: any;
	#vector!: Models.Camera.Vector;
	#click: (() => void) | undefined;
	#focus: (() => void) | undefined;

	onMount() {
		this.#setup();
		this.#render();
	}

	setProps(props: Partial<WaypointProps>) {
		if (props.targetId !== undefined) this.#props.targetId = props.targetId;
		if (props.image !== undefined) this.#props.image = props.image;
		if (props.settings !== undefined) this.#props.settings = props.settings;
		if (this.isConnected) { this.#setup(); this.#render(); }
	}

	#setup() {
		const { targetId, image, settings } = this.#props;
		if (!image || !targetId) return;

		const micrio = this.getMicrio();
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

		const customCoords = settings?.coords ?? clone(autoCoords);
		const isCustom = customCoords.custom;
		this.#coords = isCustom ? customCoords : autoCoords;

		const click = () => {
			if (image.$settings._markers?.noMarkerActions) return;
			this.#clicked = true;
			image.openedView = undefined;
			image.state.marker.set(undefined);
			micrio.open(targetId, { vector: this.#vector });
		};

		const focus = () => {
			if (image.$settings._markers?.noMarkerActions) return;
			(this.parentNode as HTMLElement)?.scrollTo(0, 0);
			clearTimeout(this.#fto);
			this.#fto = setTimeout(() => {
				const px = image.camera.getXY(this.#coords.x, this.#coords.y);
				if (!this.#clicked && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image.is360 ? px[3] > 4 : false)))
					image.camera.flyToCoo([this.#coords.x, this.#coords.y], { speed: 2, limit: true }).catch(() => { });
			}, 150);
		};

		const onmove = () => {
			if (this.#hidden) return;
			const matrix = image.camera.getMatrix(
				this.#coords.x, this.#coords.y,
				this.#coords.baseScale * this.#coords.scale,
				1, this.#coords.rotX, this.#coords.rotY, this.#coords.rotZ,
				0, 1, 1, true
			).join(',');
			this.style.transform = `matrix3d(${matrix})`;
			this.classList.toggle('direction-up', v[1] < 0);
			this.classList.toggle('direction-down', v[1] > 0);
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

		this.#unsubs.push(image.state.view.subscribe(onmove));
		DataLoader.getData(targetId).then(d => { if (d) this.#targetImage = d; this.#render(); });

		micrio.dispatchEvent(new CustomEvent('wp-print', { detail: this.#iface }));

		// Store handlers
		this.#click = click;
		this.#focus = focus;
	}

	#render() {
		if (this.#hidden) { this.style.display = 'none'; return; }

		const { settings } = this.#props;
		const micrio = this.getMicrio();
		const $_lang = micrio ? get(micrio._lang) : 'en';
		const $i18n = get(i18n);
		const spaceData = micrio?.spaceData;

		const title = settings?.i18n?.[$_lang]?.title || this.#targetImage?.i18n?.[$_lang]?.title;
		const icon = spaceData?.icons?.[settings?.customIconIdx ?? -1];

		this.classList.toggle('clicked', this.#clicked);

		this.replaceChildren();
		createElement('micrio-button', {
			setProps: {
				type: icon ? undefined : 'arrow-up',
				icon: icon || undefined,
				title: title ?? $i18n.waypointFollow,
				onclick: this.#click,
				onfocus: this.#focus,
			},
			parent: this
		});
	}

	onDestroy() {
		clearTimeout(this.#fto);
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioWaypoint.tag, MicrioWaypoint);
