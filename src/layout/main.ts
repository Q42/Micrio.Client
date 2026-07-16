import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { Readable, Writable } from '$core/store';
import type { MicrioImage } from '$core/image';
import { get, tick, writable } from '$core/store';
import { once } from '$utils/store';
import { DataLoader } from '$utils/dataLoader';
import { createElement } from '$utils/dom';
import '$ui/icon';
import '$ui/button';
import '$ui/button-group';
import '$ui/progress-circle';
import type { ProgressCircleProps } from '$ui/progress-circle';
import '$ui/progress-bar';
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

export class MicrioMain extends MicrioElement<MainProps> {
	static tag = 'micrio-main';
	static styles = `micrio-main{display:contents}`;

	#props: MainProps = {};
	#unsubs: (() => void)[] = [];
	#info: Readable<Models.ImageInfo.ImageInfo | undefined> | undefined;
	#data: Writable<Models.ImageData.ImageData | undefined> | undefined;
	#settings: Writable<Models.ImageInfo.Settings> | undefined;
	#firstInited = false;
	#logoOrg: Models.ImageInfo.Organisation | undefined;
	#lastMarkerIds = '';
	#lastEmbedIds = '';

	#layers = [
		'audio', 'media', 'logo', 'orgLogo', 'toolbar', 'gallery', 'controls', 'embeds', 'markers',
		'details', 'popup', 'tour', 'popover',
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

	#show(key: string, condition: boolean, build: () => HTMLElement) {
		const existing = this.#elements.get(key);
		if (condition) {
			if (existing?.isConnected) return;
			existing?.remove();
			const el = build();
			this.#elements.set(key, el);
			this.#place(key, el);
			if (!el.children.length) {
				el.remove();
				this.#elements.set(key, null);
			}
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
		this.#unsubs.push(micrio.isMuted.subscribe(b => volume.set(b ? 0 : 1)));

		this.provide('mediaPaused', writable<boolean>(false));

		const onlyMarkers = micrio.getAttribute('data-ui') == 'markers';
		if (onlyMarkers) this.#props.noHTML = true;

		const didStart: string[] = [];

		this.#unsubs.push(micrio.current.subscribe(c => {
			if (!c) return;
			this.#info = c.info;
			this.#settings = undefined;

			if (this.#info) {
				this.#unsubs.push(this.#info.subscribe(() => this.#queueSync()));
				once(this.#info).then(i => {
					if (i) {
						this.#firstInited = true;
						this.#settings = c.settings;
						if (this.#settings) this.#unsubs.push(this.#settings.subscribe(() => this.#queueSync()));
						if (!this.#logoOrg && DataLoader.getOrganisation()?.logo) this.#logoOrg = DataLoader.getOrganisation();
						this.#queueSync();
					}
				});
			}
			if ((this.#data = c.data) && didStart.indexOf(c.id) < 0) {
				this.#unsubs.push(this.#data.subscribe(() => this.#queueSync()));
				once(this.#data).then(async d => {
					if (!d) return;
					didStart.push(c.id);
					await tick().then(tick);
					if (get(micrio.state.popover) || get(micrio.state.marker) || get(micrio.state.tour)) return;
					const autoStart = c.$settings.start;
					if (autoStart) {
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
					}
				});
			}
			this.#queueSync();
		}));

		this.#unsubs.push(micrio.state.tour.subscribe(() => {
			const sub = this.#elements.get('subtitles') as MicrioElement;
			if (sub) sub.setProps?.({ raised: !!get(micrio.state.tour) });
		}));

		for (const store of [micrio.visible, micrio.gallery, micrio.state.popup, micrio.state.popover,
		micrio.state.tour, micrio.state.marker]) {
			this.#unsubs.push(store.subscribe(() => this.#queueSync()));
		}
		this.#unsubs.push(micrio._lang.subscribe(() => this.#queueSync()));

		this.#queueSync();
	}

	setProps(props: Partial<MainProps>) {
		Object.assign(this.#props, props);
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
		const $info = this.#info ? get(this.#info) : undefined;
		const $settings = (this.#settings ? get(this.#settings) : undefined) as Models.ImageInfo.Settings | undefined;
		const $data = this.#data ? get(this.#data) : undefined;
		const error = this.#props.error;
		const loadingProgress = this.#props.loadingProgress ?? 1;
		const noHTML = this.#props.noHTML ?? false;
		const noLogo = this.#props.noLogo ?? noHTML;

		const video = $settings?._360?.video;
		const videoSrc = video?.src;
		const positionalAudio = $data?.markers?.filter((m: any) => !!m.positionalAudio);
		const hasAudio = !!$data?.music?.items.length || !!positionalAudio?.length;
		const hasTourOrMarker = $tour || $marker;

		const showMarkers = !noHTML || (micrio.getAttribute('data-ui') == 'markers');
		const showLogo = !noLogo && (!$info || !noHTML) && !$settings?.noLogo && !$tour && !$marker && !$markerPopup;
		const showOrgLogo = !noHTML && showLogo && !$settings?.noOrgLogo && !!this.#logoOrg && !$popover;
		const showControls = !noHTML && !!$info;
		const showDetails = !noHTML && !hasTourOrMarker && !!$settings?.showInfo;
		const showToolbar = !noHTML && this.#firstInited && !$settings?.noToolbar;

		this.#show('audio', hasAudio && !!$data && !!$info, () =>
			createElement('micrio-audio-controller')
		);

		this.#show('media', !!videoSrc && !!$info, () => {
			return createElement('div');
		});

		this.#show('logo', showLogo, () =>
			createElement('micrio-logo')
		);

		this.#show('toolbar', showToolbar, () =>
			createElement('micrio-toolbar')
		);

		{
			const $visible = (get(micrio.visible) as MicrioImage[]).filter(i => !i.opts?.isEmbed);
			const markerImages = $visible.filter(i => !i.$settings?.skipMeta);
			const ids = markerImages.map(i => i.id).join(',');
			if (showMarkers && ids !== this.#lastMarkerIds) {
				for (const el of this.querySelectorAll(':scope > micrio-markers')) el.remove();
				this.#elements.set('markers', null);
				this.#lastMarkerIds = ids;
				for (const img of markerImages) {
					const el = createElement('micrio-markers', { setProps: { image: img } }) as MicrioElement;
					const before = this.#getBefore('markers');
					if (before) this.insertBefore(el, before);
					else this.appendChild(el);
					if (!this.#elements.get('markers')) this.#elements.set('markers', el);
				}
				} else if (!showMarkers) {
				for (const el of this.querySelectorAll(':scope > micrio-markers')) el.remove();
				this.#elements.set('markers', null);
				this.#lastMarkerIds = '';
			}
		}

		// Embeds — only for images whose data has embeds
		{
			const showEmbeds = micrio.getAttribute('data-embeds') != 'false';
			const $visible = get(micrio.visible) as MicrioImage[];
			const withEmbeds = $visible.filter(i => i.$data?.embeds?.length);
			const ids = withEmbeds.map(i => i.id).join(',');
			if (showEmbeds && ids !== this.#lastEmbedIds) {
				for (const el of this.querySelectorAll(':scope > micrio-image-embeds')) el.remove();
				this.#lastEmbedIds = ids;
				for (const img of withEmbeds) {
					const el = createElement('micrio-image-embeds', { setProps: { image: img } }) as MicrioElement;
					const before = this.#getBefore('embeds');
					if (before) this.insertBefore(el, before);
					else this.appendChild(el);
				}
			} else if (!showEmbeds) {
				for (const el of this.querySelectorAll(':scope > micrio-image-embeds')) el.remove();
				this.#lastEmbedIds = '';
			}
		}

		this.#show('controls', showControls, () =>
			createElement('micrio-controls', { setProps: { hasAudio: hasAudio || !!(videoSrc && video && !video.muted) } }) as MicrioElement
		);

		this.#show('orgLogo', showOrgLogo && !!this.#logoOrg, () =>
			createElement('micrio-logo-org', { setProps: { organisation: this.#logoOrg! } }) as MicrioElement
		);

		const $gallery = get(micrio.gallery);
		this.#show('gallery', !!$settings?.omni || !!$gallery, () =>
			createElement('micrio-gallery', { setProps: { controller: $gallery ?? undefined } }) as MicrioElement
		);

		this.#show('details', showDetails && !!this.#info && !!this.#data, () =>
			createElement('micrio-details', { setProps: { info: get(this.#info!), data: get(this.#data!) } }) as MicrioElement
		);

		// Per-image marker popups — each image's open marker gets its own popup
		{
			const visible = (get(micrio.visible) as MicrioImage[]).filter(i => !i.opts?.isEmbed);
			const currentPopupIds = new Set<string>();
			for (const img of visible) {
				const m = get(img.state.marker);
				if (m && typeof m != 'string' && m.popupType !== 'popover') {
					const key = 'popup-' + img.id;
					currentPopupIds.add(key);
					const existing = this.#elements.get(key) as MicrioElement | undefined;
					if (existing?.isConnected) {
						existing.setProps?.({ marker: m });
					} else {
						existing?.remove();
						const el = createElement('micrio-marker-popup', { setProps: { marker: m }, parent: this }) as MicrioElement;
						this.#elements.set(key, el);
					}
				}
			}
			// Remove popups for images that no longer have a marker set
			for (const [key, el] of this.#elements) {
				if (key.startsWith('popup-') && !currentPopupIds.has(key) && el?.isConnected) {
					el.remove();
					this.#elements.set(key, null);
				}
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
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMain.tag, MicrioMain);
