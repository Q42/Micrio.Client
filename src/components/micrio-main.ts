import { MicrioElement } from '$core/component';
import type { HTMLMicrioElement } from '$core/element';
import type { Models } from '$types/models';
import type { Readable, Writable } from '$core/store';
import type { MicrioImage } from '$core/image';
import { get, tick, writable } from '$core/store';
import { once } from '$ts/utils/store';
import { DataLoader } from '$ts/utils/dataLoader';
import './micrio-icon';
import './micrio-button';
import './micrio-button-group';
import './micrio-progress-circle';
import type { ProgressCircleProps } from './micrio-progress-circle';
import './micrio-progress-bar';
import './micrio-logo';
import './micrio-article';
import '$media/subtitles';
import './micrio-details';
import './micrio-error';
import './micrio-controls';
import '$media/fullscreen';
import './micrio-zoom-buttons';
import './micrio-logo-org';
import './micrio-waypoint';
import './micrio-marker-content';
import './micrio-menu';
import './micrio-toolbar';
import './micrio-audio-controller';
import '$media/media';
import '$media/media-controls';
import './micrio-marker-popup';
import './micrio-marker';
import './micrio-markers';
import './micrio-dial';
import './micrio-minimap';
import './micrio-audio-location';
import './micrio-events';
import './micrio-embed';
import './micrio-image-embeds';
import './micrio-tour';
import './micrio-popover';
import './micrio-gallery';
import './micrio-serial-tour';
import './micrio-gallery-item';

function findPage(id: string, p: Models.ImageData.Menu[] | undefined): Models.ImageData.Menu | undefined {
	if (p) for (let i = 0, t; i < p.length; i++)
		if (p[i].id == id || (t = findPage(id, p[i].children))) return t ?? p[i];
	return undefined;
}

export interface MainProps {
	micrio: HTMLMicrioElement;
	noHTML?: boolean;
	noLogo?: boolean;
	loadingProgress?: number;
	error?: string | undefined;
}

export class MicrioMain extends MicrioElement<MainProps> {
	static tag = 'micrio-main';
	static styles = `micrio-main{display:contents}`;

	#props: MainProps = { micrio: null! };
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
		const micrio = this.#props.micrio;
		if (!micrio) return;

		this.provide('micrio', micrio);

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
		const micrio = this.#props.micrio;
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
			document.createElement('micrio-audio-controller')
		);

		this.#show('media', !!videoSrc && !!$info, () => {
			return document.createElement('div');
		});

		this.#show('logo', showLogo, () =>
			document.createElement('micrio-logo')
		);

		this.#show('toolbar', showToolbar, () =>
			document.createElement('micrio-toolbar')
		);

		{
			const $visible = (get(micrio.visible) as MicrioImage[]).filter(i => !i.opts?.isEmbed);
			const ids = $visible.map(i => i.id).join(',');
			if (showMarkers && ids !== this.#lastMarkerIds) {
				for (const el of this.querySelectorAll(':scope > micrio-markers')) el.remove();
				this.#elements.set('markers', null);
				this.#lastMarkerIds = ids;
				for (const img of $visible) {
					const el = document.createElement('micrio-markers') as MicrioElement;
					el.setProps({ image: img });
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
					const el = document.createElement('micrio-image-embeds') as MicrioElement;
					el.setProps({ image: img });
					const before = this.#getBefore('embeds');
					if (before) this.insertBefore(el, before);
					else this.appendChild(el);
				}
			} else if (!showEmbeds) {
				for (const el of this.querySelectorAll(':scope > micrio-image-embeds')) el.remove();
				this.#lastEmbedIds = '';
			}
		}

		this.#show('controls', showControls, () => {
			const el = document.createElement('micrio-controls') as MicrioElement;
			el.setProps({ hasAudio: hasAudio || !!(videoSrc && video && !video.muted) });
			return el;
		});

		this.#show('orgLogo', showOrgLogo && !!this.#logoOrg, () => {
			const el = document.createElement('micrio-logo-org') as MicrioElement;
			el.setProps({ organisation: this.#logoOrg! });
			return el;
		});

		const $gallery = get(micrio.gallery);
		this.#show('gallery', !!$settings?.omni || !!$gallery, () => {
			const el = document.createElement('micrio-gallery') as MicrioElement;
			el.setProps({ controller: $gallery ?? undefined });
			return el;
		});

		this.#show('details', showDetails && !!this.#info && !!this.#data, () => {
			const el = document.createElement('micrio-details') as MicrioElement;
			el.setProps({ info: get(this.#info!), data: get(this.#data!) });
			return el;
		});

		// Per-image marker popups — each image's open marker gets its own popup
		{
			const visible = (get(micrio.visible) as MicrioImage[]).filter(i => !i.opts?.isEmbed);
			const currentPopupIds = new Set<string>();
			for (const img of visible) {
				const m = get(img.state.marker);
				if (m && typeof m != 'string') {
					const key = 'popup-' + img.id;
					currentPopupIds.add(key);
					const existing = this.#elements.get(key) as MicrioElement | undefined;
					if (existing?.isConnected) {
						existing.setProps?.({ marker: m });
					} else {
						existing?.remove();
						const el = document.createElement('micrio-marker-popup') as MicrioElement;
						el.setProps({ marker: m });
						this.#elements.set(key, el);
						this.appendChild(el);
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
			const el = document.createElement(tag) as MicrioElement;
			el.setProps({ tour: $tour!, noHTML });
			return el;
		});

		this.#show('popover', !!$popover, () => {
			const el = document.createElement('micrio-popover') as MicrioElement;
			el.setProps({ popover: $popover! });
			return el;
		});

		this.#show('error', !!error, () => {
			const el = document.createElement('micrio-error') as MicrioElement;
			el.setProps({ message: error! });
			return el;
		});

		this.#show('progress', loadingProgress < 1, () => {
			const el = document.createElement('micrio-progress-circle') as MicrioElement<ProgressCircleProps>;
			el.setProps({ progress: loadingProgress });
			return el;
		});
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMain.tag, MicrioMain);
