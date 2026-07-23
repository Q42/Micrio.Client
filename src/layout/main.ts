import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { Writable } from '$core/store';
import type { MicrioImage } from '$core/image';
import { get, tick, writable } from '$core/store';
import { DataLoader } from '$utils/dataLoader';
import { createElement } from '$utils/dom';
import '$ui/icon';
import '$ui/button';
import '$ui/button-group';
import '$ui/progress-circle';
import type { ProgressCircleProps } from '$ui/progress-circle';
import './logo';
import './article';
import '$media/subtitles';
import './details';
import './error';
import '$layout/nav/controls';
import '$media/fullscreen';
import '$layout/nav/zoom-buttons';
import './logo-org';
import '$markers/waypoint';
import '$markers/marker-content';
import './menu';
import './toolbar';
import '$audio/audio-controller';
import '$media/media';
import '$media/media-controls';
import '$markers/marker-popup';
import '$markers/marker';
import '$markers/markers';
import '$ui/dial';
import '$layout/nav/minimap';
import '$audio/audio-location';
import '$media/events';
import '$embed/embed';
import '$embed/image-embeds';
import '$tour/tour';
import './popover';
import '$gallery/gallery';
import '$tour/serial-tour';


function findPage(id: string, p: Models.ImageData.Menu[] | undefined): Models.ImageData.Menu | undefined {
	if (p) for (let i = 0, t; i < p.length; i++)
		if (p[i].id == id || (t = findPage(id, p[i].children))) return t ?? p[i];
	return undefined;
}

export interface MainProps {
	noHTML?: boolean;
	noLogo?: boolean;
	loadingProgress?: number;
	error?: string | undefined;
}
import './main.css';

class MicrioMain extends MicrioElement<MainProps> {
	static tag = 'micrio-main';

	#props: MainProps = {};
	#info: Models.ImageInfo.ImageInfo | undefined;
	#settings: Writable<Models.ImageInfo.Settings> | undefined;
	#firstInited = false;
	#logoOrg: Models.ImageInfo.Organisation | undefined;
	#activePopupMarkerId: string | undefined;
	#markerElements = new Map<string, MicrioElement>();
	#embedElements = new Map<string, MicrioElement>();

	#layers = [
		'audio', 'media', 'logo', 'orgLogo', 'details', 'toolbar', 'grid', 'gallery', 'controls', 'embeds', 'markers',
		'popup', 'tour', 'popover', 'minimap',
		'error', 'progress'
	];

	#elements = new Map<string, HTMLElement | null>();

	#getBefore(key: string): Node | null {
		const idx = this.#layers.indexOf(key);
		for (let i = idx + 1; i < this.#layers.length; i++) {
			const el = this.#elements.get(this.#layers[i]);
			if (el?.isConnected) return el;
		}
		return null;
	}

	#place(key: string, el: HTMLElement) {
		if (el.isConnected) return;
		const before = this.#getBefore(key);
		if (before) this.insertBefore(el, before);
		else this.appendChild(el);
	}

	#show(key: string, condition: boolean, build: () => HTMLElement, update?: (el: HTMLElement) => void) {
		const existing = this.#elements.get(key);
		if (condition) {
			if (existing?.isConnected) {
				update?.(existing);
				return;
			}
			existing?.remove();
			const el = build();
			this.#elements.set(key, el);
			this.#place(key, el);
		} else if (existing?.isConnected) {
			existing.remove();
			this.#elements.set(key, null);
		}
	}

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const volume = writable<number>(get(micrio.isMuted) ? 0 : 1);
		this.provide('volume', volume);
		this.addCleanup(micrio.isMuted.subscribe(b => volume.set(b ? 0 : 1)));

		this.provide('mediaPaused', writable<boolean>(false));

		const onlyMarkers = micrio.getAttribute('data-ui') == 'markers';
		if (onlyMarkers) this.#props.noHTML = true;

		const didStart: string[] = [];

		this.addCleanup(micrio.current.subscribe(c => {
			if (!c) return;
			this.#info = c.$info;
			this.#settings = undefined;

			this.#firstInited = true;
			this.#settings = c.settings;
			if (this.#settings) this.addCleanup(this.#settings.subscribe(() => this.#queueSync()));
			if (!this.#logoOrg && DataLoader.getOrganisation()?.logo) this.#logoOrg = DataLoader.getOrganisation();
			this.#queueSync();

			if (this.isConnected) this.#sync();

			const d = c.$data;
			if (d && didStart.indexOf(c.id) < 0) {
				didStart.push(c.id);
				const autoStart = c.$settings.start;
				if (autoStart) {
					tick().then(tick).then(() => {
						if (get(micrio.state.popover) || get(micrio.state.marker) || get(micrio.state.tour)) return;
						switch (autoStart.type) {
							case 'marker': c.state.marker.set(autoStart.id); break;
							case 'markerTour': {
								const mt = d.markerTours?.find((t: any) => t.id == autoStart.id);
								if (mt) micrio.state.tour.set(mt); break;
							}
							case 'tour': {
								const vt = d.tours?.find((t: any) => t.id == autoStart.id);
								if (vt) micrio.state.tour.set(vt); break;
							}
							case 'page': {
								const page = findPage(autoStart.id, d.pages);
								if (page) micrio.state.popover.set({ contentPage: page, showLangSelect: true }); break;
							}
						}
					});
				}
			}
			this.#queueSync();
		}));

		this.addCleanup(micrio.state.tour.subscribe(() => {
			const sub = this.#elements.get('subtitles') as MicrioElement;
			if (sub) sub.setProps?.({ raised: !!get(micrio.state.tour) });
		}));

		for (const store of [micrio.visible, micrio.gallery, micrio.state.popup, micrio.state.popover,
		micrio.state.tour, micrio.state.marker]) {
			this.addCleanup(store.subscribe(() => this.#queueSync()));
		}
		this.addCleanup(micrio._lang.subscribe(() => this.#queueSync()));

		this.#queueSync();
	}

	setProps(props: Partial<MainProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#queueSync();
	}

	#syncQueued = false;
	#queueSync() {
		if (this.#syncQueued) return;
		this.#syncQueued = true;
		requestAnimationFrame(() => {
			this.#syncQueued = false;
			if (this.isConnected) this.#sync();
		});
	}

	#sync() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const $tour = get(micrio.state.tour);
		const $marker = get(micrio.state.marker);
		const $markerPopup = get(micrio.state.popup);
		const $popover = get(micrio.state.popover);
		const $info = this.#info;
		const $settings = (this.#settings ? get(this.#settings) : undefined) as Models.ImageInfo.Settings | undefined;
		const $data = micrio.$current ? get(micrio.$current.data) : undefined;
		const error = this.#props.error;
		const loadingProgress = this.#props.loadingProgress ?? 1;
		const noHTML = this.#props.noHTML ?? false;
		const noLogo = this.#props.noLogo ?? noHTML;
		const isMobile = micrio.canvas.$isMobile;

		const _360 = micrio.$current?.is360
		const video = _360 ? $settings!._360!.video : undefined;
		const videoSrc = video?.src;
		this.classList.toggle('is360', _360);
		const positionalAudio = $data?.markers?.filter((m: any) => !!m.positionalAudio);
		const hasAudio = !!$data?.music?.items.length || !!positionalAudio?.length;
		const hasTourOrMarker = $tour || $marker;

		const showMarkers = !noHTML || (micrio.getAttribute('data-ui') == 'markers');
		const showLogo = !noLogo && (!$info || !noHTML) && !$settings?.noLogo && !$marker && !$markerPopup;
		const showOrgLogo = !noHTML && showLogo && !$settings?.noOrgLogo && !!this.#logoOrg && !$popover;
		const showControls = !noHTML && !!$info && !$settings?.noControls;
		const showDetails = !noHTML && !hasTourOrMarker && !!$settings?.showInfo;
		const showToolbar = !noHTML && this.#firstInited && !$settings?.noToolbar;
		const showMinimap = !noHTML && !!$info && $settings?.minimap !== false && !$settings?.noControls && !!micrio.$current?.thumbSrc && !($markerPopup && isMobile);

		this.#show('audio', hasAudio && !!$data && !!$info, () =>
			createElement('micrio-audio-controller')
		);

		this.#show('media', !!videoSrc && !!$info, () => {
			return createElement('div');
		});

		this.#show('logo', showLogo, () =>
			createElement('micrio-logo')
		);

		this.#show('details', showDetails && !!$data, () =>
			createElement('micrio-details', { setProps: { info: this.#info!, data: $data! } }) as MicrioElement
		);

		this.#show('toolbar', showToolbar, () =>
			createElement('micrio-toolbar')
		);

		const $visible = get(micrio.visible);
		this.#syncImageLayer(this.#markerElements, 'micrio-markers', 'markers', $visible, showMarkers,
			(i) => !i.opts?.isEmbed && (!!i.$data?.markers?.length || !!micrio.spaceData)
		);

		this.#syncImageLayer(this.#embedElements, 'micrio-image-embeds', 'embeds', $visible,
			micrio.getAttribute('data-embeds') != 'false',
			(i) => !!i.$data?.embeds?.length
		);

		this.#show('controls', showControls, () =>
			createElement('micrio-controls', { setProps: { hasAudio: hasAudio || !!(videoSrc && video && !video.muted) } }) as MicrioElement
		);

		this.#show('orgLogo', showOrgLogo && !!this.#logoOrg, () =>
			createElement('micrio-logo-org', { setProps: { organisation: this.#logoOrg! } }) as MicrioElement
		);

		const $gallery = get(micrio.gallery);
		const grid = micrio.$current?.grid;
		if (grid) this.#place('grid', grid);

		this.#show('gallery', !!$settings?.omni || !!($gallery?.config?.type !== 'grid' && $gallery), () =>
			createElement('micrio-gallery', { setProps: { controller: $gallery ?? undefined } }) as MicrioElement
		);

		this.#show('minimap', showMinimap,
			() => createElement('micrio-minimap', { setProps: { image: micrio.$current! } }) as MicrioElement,
			(el) => (el as MicrioElement).setProps?.({ image: micrio.$current! })
		);

		// Marker popup — only created when micrio.state.popup is set (after flyTo completes)
		const $popupMarker = get(micrio.state.popup);
		const hasPopup = $popupMarker != null && $popupMarker.popupType !== 'popover';

		const existing = this.#elements.get('popup');

		if (hasPopup) {
			const shouldReplace = existing?.isConnected && (
				$popupMarker!.id !== this.#activePopupMarkerId ||
				existing.classList.contains('destroying')
			);
			if (shouldReplace) {
				existing.remove();
				this.#elements.set('popup', null);
			}
			this.#activePopupMarkerId = $popupMarker!.id;

			if (!this.#elements.get('popup')?.isConnected) {
				this.#elements.set('popup',
					createElement('micrio-marker-popup', { setProps: { marker: $popupMarker! }, parent: this }) as MicrioElement
				);
			}
		} else {
			// Don't remove — let the popup animate out via its destroying class
			if (!existing?.isConnected) {
				this.#elements.set('popup', null);
				this.#activePopupMarkerId = undefined;
			}
		}

		this.#show('tour', !!$tour, () => {
			const isSerial = $tour && 'steps' in $tour && $tour.isSerialTour;
			const tag = isSerial ? 'micrio-serial-tour' : 'micrio-tour';
			return createElement(tag, { setProps: { tour: $tour!, noHTML } }) as MicrioElement;
		});

		this.#show('popover', !!$popover, () =>
			createElement('micrio-popover', { setProps: { popover: $popover! } }) as MicrioElement
		);

		this.#show('error', !!error, () =>
			createElement('micrio-error', { setProps: { message: error! } }) as MicrioElement
		);

		this.#show('progress', loadingProgress < 1, () =>
			createElement('micrio-progress-circle', { setProps: { progress: loadingProgress } }) as MicrioElement<ProgressCircleProps>
		);

		if (loadingProgress < 1) {
			const el = this.#elements.get('progress') as MicrioElement<ProgressCircleProps> | undefined;
			if (el?.isConnected) el.setProps?.({ progress: loadingProgress });
		}
	}

	#syncImageLayer(
		map: Map<string, MicrioElement>,
		tag: string,
		layerKey: string,
		visible: MicrioImage[],
		enabled: boolean,
		hasContent: (img: MicrioImage) => boolean,
	) {
		const filtered = visible.filter((i): i is MicrioImage => hasContent(i));
		const visibleIds = new Set(filtered.map(i => i.id));

		for (const [id, el] of map) {
			if (!visibleIds.has(id)) {
				el.remove();
				map.delete(id);
			}
		}

		if (enabled) {
			for (const img of filtered) {
				if (map.has(img.id)) continue;
				const el = createElement(tag, { setProps: { image: img } }) as MicrioElement;
				map.set(img.id, el);
				const before = this.#getBefore(layerKey);
				if (before) this.insertBefore(el, before);
				else this.appendChild(el);
			}
		} else {
			for (const el of map.values()) el.remove();
			map.clear();
		}

		this.#elements.set(layerKey, map.values().next().value ?? null);
	}


}

customElements.define(MicrioMain.tag, MicrioMain);
