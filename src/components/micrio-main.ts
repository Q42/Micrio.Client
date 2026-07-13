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
	#sections: Map<string, HTMLElement> = new Map();
	#info: Readable<Models.ImageInfo.ImageInfo | undefined> | undefined;
	#data: Writable<Models.ImageData.ImageData | undefined> | undefined;
	#settings: Writable<Models.ImageInfo.Settings> | undefined;
	#firstInited = false;
	#logoOrg: Models.ImageInfo.Organisation | undefined;

	onMount() {
		const micrio = this.#props.micrio;
		if (!micrio) return; // Props not yet set — setProps will be called
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

		const showEmbeds = micrio.getAttribute('data-embeds') != 'false';

		this.#info = undefined;
		this.#data = undefined;
		this.#settings = undefined;
		this.#firstInited = false;
		this.#logoOrg = undefined;
		const didStart: string[] = [];

		this.#unsubs.push(micrio.current.subscribe(c => {
			if (!c) return;
			this.#info = c.info;
			this.#settings = undefined;

			// Re-render when the current image's info/data/settings stores change
			if (this.#info) {
				this.#unsubs.push(this.#info.subscribe(() => this.#scheduleRender()));
				once(this.#info).then(i => {
					if (i) {
						this.#firstInited = true;
						this.#settings = c.settings;
						if (this.#settings) this.#unsubs.push(this.#settings.subscribe(() => this.#scheduleRender()));
						if (!this.#logoOrg && DataLoader.getOrganisation()?.logo) this.#logoOrg = DataLoader.getOrganisation();
						this.#scheduleRender();
					}
				});
			}
			if ((this.#data = c.data) && didStart.indexOf(c.id) < 0) {
				this.#unsubs.push(this.#data.subscribe(() => this.#scheduleRender()));
				once(this.#data).then(async d => {
					if (!d) return;
					didStart.push(c.id);
					await tick().then(tick);
					if (get(micrio.state.popover) || get(micrio.state.marker) || get(micrio.state.tour)) return;
					const autoStart = c.$settings.start;
					if (autoStart) {
						switch (autoStart.type) {
							case 'marker': c.state.marker.set(autoStart.id); break;
							case 'markerTour':
								const mt = d.markerTours?.find((t: any) => t.id == autoStart.id);
								if (mt) micrio.state.tour.set(mt); break;
							case 'tour':
								const vt = d.tours?.find((t: any) => t.id == autoStart.id);
								if (vt) micrio.state.tour.set(vt); break;
							case 'page':
								const page = findPage(autoStart.id, d.pages);
								if (page) micrio.state.popover.set({ contentPage: page, showLangSelect: true } as any); break;
						}
					}
				});
			}
			this.#scheduleRender();
		}));

		let subsRaised = false;
		srt.subscribe(s => setTimeout(() => {
			const el = this.#sections.get('subtitles');
			if (el) el.innerHTML = '';
			if (s) {
				const sub = document.createElement('micrio-subtitles') as any;
				sub.setProps({ src: s, raised: subsRaised });
				(this.#sections.get('subtitles') || this).appendChild(sub);
			}
		}, 20));

		for (const store of [micrio.visible, micrio.gallery, micrio.state.popup, micrio.state.popover,
		micrio.state.tour, micrio.state.marker, micrio.loading, micrio.switching]) {
			this.#unsubs.push(store.subscribe(() => this.#scheduleRender()));
		}
		this.#unsubs.push(micrio._lang.subscribe(() => this.#scheduleRender()));

		(this as any).__c = { micrio, onlyMarkers, showEmbeds };
		(this as any).__stores = { srt, volume };
		(this as any).__markerImages = markerImages;

		this.#scheduleRender();
	}

	setProps(props: Partial<MainProps>) {
		Object.assign(this.#props, props);
	}

	#renderQueued = false;
	#scheduleRender() {
		if (this.#renderQueued) return;
		this.#renderQueued = true;
		requestAnimationFrame(() => {
			this.#renderQueued = false;
			if (this.isConnected) this.#render();
		});
	}

	#render() {
		const c = (this as any).__c as { micrio: HTMLMicrioElement; onlyMarkers: boolean; showEmbeds: boolean };
		const { micrio, onlyMarkers } = c;

		const $tour = get(micrio.state.tour);
		const $marker = get(micrio.state.marker);
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

		const showMarkers = !noHTML || onlyMarkers;
		const showLogo = !noLogo && (!$info || !noHTML) && !($settings as any)?.noLogo;
		const showOrgLogo = !noHTML && showLogo && !($settings as any)?.noOrgLogo && this.#logoOrg;
		const showControls = !noHTML && !!$info;
		const showDetails = !noHTML && !hasTourOrMarker && ($settings as any)?.showInfo;
		const showToolbar = !noHTML && this.#firstInited && !($settings as any)?.noToolbar;

		this.replaceChildren();

		if (hasAudio && $data && $info) {
			const audioCtrl = document.createElement('micrio-audio-controller');
			this.appendChild(audioCtrl);
		}

		if (videoSrc && $info) {
			// TODO: micrio-media
		}

		if (showLogo) {
			const logo = document.createElement('micrio-logo');
			this.appendChild(logo);
		}

		if (showToolbar) {
			const toolbar = document.createElement('micrio-toolbar');
			this.appendChild(toolbar);
		}

		if (showMarkers) {
			const $visible = get(micrio.visible) as MicrioImage[];
			for (const image of $visible) {
				const markers = document.createElement('micrio-markers') as any;
				markers.setProps({ image });
				this.appendChild(markers);
			}
		}

		if (showControls) {
			const controls = document.createElement('micrio-controls') as any;
			controls.setProps({ hasAudio: hasAudio || !!(videoSrc && video && !video.muted) });
			this.appendChild(controls);
		}

		if (showOrgLogo && this.#logoOrg) {
			const org = document.createElement('micrio-logo-org') as any;
			org.setProps({ organisation: this.#logoOrg });
			this.appendChild(org);
		}

		if (showDetails && this.#info && this.#data) {
			const details = document.createElement('micrio-details') as any;
			details.setProps({ info: get(this.#info), data: get(this.#data) });
			this.appendChild(details);
		}

		const subsSection = this.#ensureSection('subtitles');
		if (subsSection.children.length > 0) this.appendChild(subsSection);

		if (error || loadingProgress < 1) {
			if (error) {
				const err = document.createElement('micrio-error') as any;
				err.setProps({ message: error });
				this.appendChild(err);
			}
			if (loadingProgress < 1) {
				const circle = document.createElement('micrio-progress-circle') as any;
				circle.setProgress(loadingProgress);
				this.appendChild(circle);
			}
		}
	}

	#ensureSection(id: string): HTMLElement {
		let el = this.#sections.get(id);
		if (!el) {
			el = document.createElement('section');
			el.style.display = 'none';
			this.#sections.set(id, el);
		}
		return el;
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMain.tag, MicrioMain);
