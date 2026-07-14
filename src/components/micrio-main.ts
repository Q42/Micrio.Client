import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { Readable, Writable } from '$ts/store';
import type { MicrioImage } from '$ts/image';
import { get, tick, writable } from '$ts/store';
import { once } from '$ts/utils/store';
import { DataLoader } from '$ts/utils/dataLoader';
import './micrio-icon';
import './micrio-button';
import './micrio-button-group';
import './micrio-progress-circle';
import './micrio-progress-bar';
import './micrio-logo';
import './micrio-article';
import './micrio-subtitles';
import './micrio-details';
import './micrio-error';
import './micrio-controls';
import './micrio-fullscreen';
import './micrio-zoom-buttons';
import './micrio-logo-org';
import './micrio-waypoint';
import './micrio-marker-content';
import './micrio-menu';
import './micrio-toolbar';
import './micrio-audio-controller';
import './micrio-media';
import './micrio-media-controls';
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

	#layers = [
		'audio', 'media', 'logo', 'toolbar', 'markers', 'controls',
		'orgLogo', 'details', 'popup', 'tour', 'popover', 'subtitles',
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
		} else if (existing?.isConnected) {
			existing.remove();
			this.#elements.set(key, null);
		}
	}

	onMount() {
		const micrio = this.#props.micrio;
		if (!micrio) return;

		this.provide('micrio', micrio);
		this.provide('markerImages', new Map<string, MicrioImage>());

		const volume = writable<number>(get(micrio.isMuted) ? 0 : 1);
		this.provide('volume', volume);
		this.#unsubs.push(micrio.isMuted.subscribe(b => volume.set(b ? 0 : 1)));

		this.provide('mediaPaused', writable<boolean>(false));

		const srt = writable<string>('');
		this.provide('srt', srt);

		const markerImages = new Map<string, MicrioImage>();
		this.provide('markerImages', markerImages);

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
								if (page) micrio.state.popover.set({ contentPage: page, showLangSelect: true } as any); break;
							}
						}
					}
				});
			}
			this.#queueSync();
		}));

		srt.subscribe(s => setTimeout(() => {
			const existing = this.#elements.get('subtitles');
			if (s) {
				existing?.remove();
				const sub = document.createElement('micrio-subtitles') as any;
				sub.setProps({ src: s, raised: false });
				this.#elements.set('subtitles', sub);
				this.#place('subtitles', sub);
			} else {
				existing?.remove();
				this.#elements.set('subtitles', null);
			}
		}, 20));

		for (const store of [micrio.visible, micrio.gallery, micrio.state.popup, micrio.state.popover,
		micrio.state.tour, micrio.state.marker, micrio.loading, micrio.switching]) {
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

		const video = ($settings as any)?._360?.video;
		const videoSrc = video?.src;
		const positionalAudio = ($data as any)?.markers?.filter((m: any) => !!m.positionalAudio);
		const hasAudio = !!($data as any)?.music?.items.length || !!positionalAudio?.length;
		const hasTourOrMarker = $tour || $marker;

		const showMarkers = !noHTML || (micrio.getAttribute('data-ui') == 'markers');
		const showLogo = !noLogo && (!$info || !noHTML) && !($settings as any)?.noLogo && !$tour && !$marker && !$markerPopup;
		const showOrgLogo = !noHTML && showLogo && !($settings as any)?.noOrgLogo && !!this.#logoOrg && !$popover;
		const showControls = !noHTML && !!$info;
		const showDetails = !noHTML && !hasTourOrMarker && ($settings as any)?.showInfo;
		const showToolbar = !noHTML && this.#firstInited && !($settings as any)?.noToolbar;

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
			// Remove all existing marker elements
			for (const el of this.querySelectorAll(':scope > micrio-markers')) el.remove();
			this.#elements.set('markers', null);
			if (showMarkers) {
				const $visible = get(micrio.visible) as MicrioImage[];
				for (const img of $visible) {
					const el = document.createElement('micrio-markers') as any;
					el.setProps({ image: img });
					const before = this.#getBefore('markers');
					if (before) this.insertBefore(el, before);
					else this.appendChild(el);
					if (!this.#elements.get('markers')) this.#elements.set('markers', el);
				}
			}
		}

		this.#show('controls', showControls, () => {
			const el = document.createElement('micrio-controls') as any;
			el.setProps({ hasAudio: hasAudio || !!(videoSrc && video && !video.muted) });
			return el;
		});

		this.#show('orgLogo', showOrgLogo && !!this.#logoOrg, () => {
			const el = document.createElement('micrio-logo-org') as any;
			el.setProps({ organisation: this.#logoOrg! });
			return el;
		});

		this.#show('details', showDetails && !!this.#info && !!this.#data, () => {
			const el = document.createElement('micrio-details') as any;
			el.setProps({ info: get(this.#info!), data: get(this.#data!) });
			return el;
		});

		this.#show('popup', !!$markerPopup, () => {
			const el = document.createElement('micrio-marker-popup') as any;
			el.setProps({ marker: $markerPopup! });
			return el;
		});

		this.#show('tour', !!$tour, () => {
			const el = document.createElement('micrio-tour') as any;
			el.setProps({ tour: $tour!, noHTML });
			return el;
		});

		this.#show('popover', !!$popover, () => {
			const el = document.createElement('micrio-popover') as any;
			el.setProps({ popover: $popover! });
			return el;
		});

		this.#show('error', !!error, () => {
			const el = document.createElement('micrio-error') as any;
			el.setProps({ message: error! });
			return el;
		});

		this.#show('progress', loadingProgress < 1, () => {
			const el = document.createElement('micrio-progress-circle') as any;
			el.setProgress(loadingProgress);
			return el;
		});
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMain.tag, MicrioMain);
