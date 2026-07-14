import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import type { Unsubscriber } from '$ts/store';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import { once } from '$ts/utils/store';
import { languageNames } from '$ts/i18n/locale';

export interface ControlsProps {
	hasAudio?: boolean;
}

export class MicrioControls extends MicrioElement<ControlsProps> {
	static tag = 'micrio-controls';
	static styles = `micrio-controls{position:absolute;right:var(--micrio-border-margin);bottom:var(--micrio-border-margin);padding:0;margin:0;transition:transform .25s ease,opacity .25s ease;direction:rtl;z-index:2}
micrio-controls.hidden{transform:translateX(calc(100% + var(--micrio-border-margin)));opacity:0;pointer-events:none}
micrio-controls .primary:not(.portrait){right:calc(50% + var(--micrio-border-margin))}
micrio-controls .primary.portrait{bottom:calc(50% + var(--micrio-border-margin))}
micrio-controls .grid-close{top:var(--micrio-border-margin);bottom:auto;position:absolute;right:0}
micr-io[data-switching]>micrio-controls,micr-io[data-tour-active]>micrio-controls{opacity:0;pointer-events:none}
micrio-controls>micrio-button,micrio-controls>menu{padding:0;margin:8px 0;display:block;width:var(--micrio-button-size)}
micrio-controls menu.popout{padding:0;width:var(--micrio-button-size);height:var(--micrio-button-size);white-space:pre;direction:rtl;pointer-events:none;box-shadow:var(--micrio-button-shadow);border-radius:var(--micrio-border-radius);backdrop-filter:var(--micrio-background-filter)}
micrio-controls menu.popout:focus-within{pointer-events:all}
micrio-controls menu.popout micrio-button{pointer-events:all;transition:border-radius .2s ease,opacity .2s ease;--micrio-button-shadow:none;--micrio-background-filter:none}
micrio-controls menu.popout:hover>micrio-button:first-child{border-radius:0 var(--micrio-border-radius) var(--micrio-border-radius) 0}
micrio-controls menu.popout>micrio-button:not(:first-child){display:inline-block;padding:0;transition:opacity .2s ease;border-radius:0}
micrio-controls menu.popout>micrio-button:last-child{border-radius:var(--micrio-border-radius) 0 0 var(--micrio-border-radius)}
micrio-controls menu.popout:not(:focus-within)>micrio-button:not(:first-child){pointer-events:none;opacity:0}`;

	#props: ControlsProps = {};
	#unsubs: (() => void)[] = [];
	#built = false;
	#showCultures = false;
	#showSocial = false;
	#showFullscreen = false;
	#secondaryControls: MicrioImage | null = null;
	#secondaryPortrait = false;
	#gridFocussed: MicrioImage | undefined;
	#gridClickable: 'focus' | 'zoom' | false = false;
	#grid: any = undefined;

	#aside1!: HTMLElement;
	#muteBtn: any;
	#shareBtn: any;
	#langMenu: HTMLElement | undefined;
	#group1!: HTMLElement;
	#zoomGroup: any;
	#fsGroup: any;
	#aside2!: HTMLElement;
	#aside3!: HTMLElement;

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const { state: micrioState, isMuted, _lang } = micrio;
		const { tour, popup } = micrioState;
		const { controls, zoom, hidden, hover } = micrio.state.ui;

		const share = () => {
			if (navigator.share && micrio.$current?.$info) {
				const cData = micrio.$current.$data?.i18n?.[get(_lang)];
				navigator.share({
					title: micrio.$current.$info?.title,
					text: cData?.description || `${micrio.$current.$info.width} x ${micrio.$current.$info.height} | Micrio`,
					url: location.href
				});
			}
		};

		const splitStart = (e: any) => {
			const img = e.detail as MicrioImage;
			this.#secondaryPortrait = micrio.canvas.viewport.portrait;
			if (!img.opts.isPassive) this.#secondaryControls = img;
			this.#sync();
		};

		const splitStop = () => {
			this.#secondaryControls = null;
			this.#sync();
		};

		micrio.addEventListener('splitscreen-start', splitStart);
		micrio.addEventListener('splitscreen-stop', splitStop);
		this.#unsubs.push(() => {
			micrio.removeEventListener('splitscreen-start', splitStart);
			micrio.removeEventListener('splitscreen-stop', splitStop);
		});

		const readInfo = (s: Models.ImageInfo.Settings) => {
			zoom.set(!s.noZoom);
			controls.set(!s.noControls);
			this.#showCultures = !!s.ui?.controls?.cultureSwitch;
			this.#showSocial = !!s.social;
			this.#showFullscreen = !!s.fullscreen;
			this.#sync();
		};

		if (micrio.$current) readInfo(micrio.$current.$settings);

		let settingsUnsub: Unsubscriber | undefined;
		let gridUnsub: Unsubscriber | undefined;

		this.#unsubs.push(micrio.current.subscribe(c => {
			if (c) {
				once(c.info).then(i => {
					if (!i || (get(tour) && 'steps' in get(tour)!)) return;
					settingsUnsub?.();
					settingsUnsub = c.settings.subscribe(readInfo);
				});
			}
			const g = micrio.canvases[0]?.grid;
			if (g !== this.#grid) {
				gridUnsub?.();
				this.#grid = g;
				if (g) {
					this.#gridClickable = g.clickable;
					gridUnsub = g.focussed.subscribe(v => {
						this.#gridFocussed = v;
						this.#sync();
					});
				}
			}
		}));

		this.#unsubs.push(hover.subscribe(() => this.#sync()));
		this.#unsubs.push(hidden.subscribe(() => this.#sync()));
		this.#unsubs.push(controls.subscribe(() => this.#sync()));
		this.#unsubs.push(zoom.subscribe(() => this.#sync()));
		this.#unsubs.push(tour.subscribe(() => this.#sync()));
		this.#unsubs.push(popup.subscribe(() => this.#sync()));

		(this as any).__toggleMute = () => { isMuted.set(!get(isMuted)); };
		(this as any).__share = share;
		(this as any).__setLang = (l: string) => { micrio.lang = l; };
		(this as any).__gridBack = () => this.#grid?.back();

		this.#build();
		this.#sync();
	}

	setProps(props: Partial<ControlsProps>) {
		Object.assign(this.#props, props);
	}

	// ── Build DOM once ──

	#build() {
		if (this.#built) return;

		// Main aside
		this.#aside1 = document.createElement('aside');
		this.#aside1.addEventListener('pointerover', () => {
			(this.inject<HTMLMicrioElement>('micrio'))?.state.ui.hover.set(true);
		});
		this.#aside1.addEventListener('pointerout', (e) => {
			if (!e.currentTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
				(this.inject<HTMLMicrioElement>('micrio'))?.state.ui.hover.set(false);
		});
		this.#aside1.addEventListener('focusin', () => {
			(this.inject<HTMLMicrioElement>('micrio'))?.state.ui.hover.set(true);
		});
		this.#aside1.addEventListener('focusout', (e) => {
			if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
				(this.inject<HTMLMicrioElement>('micrio'))?.state.ui.hover.set(false);
		});
		this.appendChild(this.#aside1);

		// Mute button placeholder
		this.#muteBtn = document.createElement('micrio-button');
		this.#muteBtn.className = 'ctrl-mute';
		this.#aside1.appendChild(this.#muteBtn);

		// Language menu placeholder
		this.#langMenu = document.createElement('menu');
		this.#langMenu.className = 'popout ctrl-lang';
		this.#langMenu.setAttribute('tabindex', '0');
		const langBtn = document.createElement('micrio-button');
		langBtn.className = 'ctrl-lang-trigger';
		this.#langMenu.appendChild(langBtn);
		this.#aside1.appendChild(this.#langMenu);

		// Share button placeholder
		this.#shareBtn = document.createElement('micrio-button');
		this.#shareBtn.className = 'ctrl-share';
		this.#aside1.appendChild(this.#shareBtn);

		// ButtonGroup for zoom + fullscreen
		this.#group1 = document.createElement('micrio-button-group');
		this.#zoomGroup = document.createElement('micrio-zoom-buttons');
		this.#zoomGroup.className = 'ctrl-zoom';
		this.#group1.appendChild(this.#zoomGroup);
		this.#fsGroup = document.createElement('micrio-fullscreen');
		this.#fsGroup.className = 'ctrl-fs';
		this.#group1.appendChild(this.#fsGroup);
		this.#aside1.appendChild(this.#group1);

		// Secondary controls placeholder (split screen)
		this.#aside2 = document.createElement('aside');
		this.#aside2.className = 'primary';
		const group2 = document.createElement('micrio-button-group');
		const zoom2 = document.createElement('micrio-zoom-buttons');
		group2.appendChild(zoom2);
		this.#aside2.appendChild(group2);
		this.appendChild(this.#aside2);

		// Grid close placeholder
		this.#aside3 = document.createElement('aside');
		this.#aside3.className = 'grid-close';
		this.appendChild(this.#aside3);

		this.#built = true;
	}

	// ── Sync state to existing DOM (no rebuild) ──

	#sync() {
		if (!this.#built || !this.isConnected) return;

		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const $i18n = get(i18n);
		const $isMuted = get(micrio.isMuted);
		const $_lang = get(micrio._lang);
		const $controls = get(micrio.state.ui.controls);
		const $hidden = get(micrio.state.ui.hidden);
		const $hover = get(micrio.state.ui.hover);
		const $zoom = get(micrio.state.ui.zoom);
		const $popup = get(micrio.state.popup);
		const $tour = get(micrio.state.tour);
		const $current = micrio.$current;
		const info = $current?.$info;
		const cultures = info?.revision ? Object.keys(info.revision) : [];
		const isMobile = micrio.canvas.$isMobile;

		const showMute = !!('micrioAudioContext' in window || this.#props.hasAudio);
		const hasCultures = this.#showCultures && cultures.length > 1;
		const hasSocial = this.#showSocial && ('share' in navigator);
		const hasFullscreen = this.#showFullscreen && !($tour && 'steps' in $tour && ($tour as any).isSerialTour);
		const hasControls = $controls && (showMute || hasCultures || hasSocial || $zoom || hasFullscreen);
		const onlyFullscreen = hasFullscreen && !!$popup && isMobile;
		const gridPanZoomCells = !!$current?.grid && $current.grid.panZoom == 'cells';

		this.classList.toggle('hidden', $hidden && !$hover);

		if (!hasControls) { this.style.display = 'none'; return; }
		this.style.display = '';

		// Mute button
		this.#showEl(this.#muteBtn, showMute);
		this.#muteBtn.setProps({
			type: $isMuted ? 'volume-off' : 'volume-up',
			title: $isMuted ? $i18n.audioUnmute : $i18n.audioMute,
			onclick: (this as any).__toggleMute
		});

		// Language menu
		this.#showEl(this.#langMenu!, hasCultures && !onlyFullscreen);
		if (hasCultures) {
			const trigger = this.#langMenu!.querySelector('.ctrl-lang-trigger') as any;
			if (trigger) trigger.setProps({ type: 'a11y', title: $i18n.switchLanguage });

			// Add/remove language buttons
			const existing = this.#langMenu!.querySelectorAll(':scope > micrio-button:not(.ctrl-lang-trigger)');
			existing.forEach(el => el.remove());

			for (const l of cultures) {
				const b = document.createElement('micrio-button') as any;
				b.setProps({
					title: languageNames?.of(l) ?? l,
					active: l === $_lang,
					onclick: () => { (this as any).__setLang(l); }
				});
				b.appendChild(document.createTextNode(l.toUpperCase()));
				this.#langMenu!.appendChild(b);
			}
		}

		// Share button
		this.#showEl(this.#shareBtn, hasSocial && !onlyFullscreen);
		if (hasSocial) {
			this.#shareBtn.setProps({ type: 'share', title: $i18n.share, onclick: (this as any).__share });
		}

		// Zoom buttons
		const zoomVisible = $zoom && !onlyFullscreen && !gridPanZoomCells;
		this.#showEl(this.#zoomGroup.closest('micrio-button-group') || this.#group1, true);
		this.#showEl(this.#zoomGroup, zoomVisible);
		this.#showEl(this.#group1, true);

		// Fullscreen
		this.#showEl(this.#fsGroup, hasFullscreen);
		if (hasFullscreen) {
			this.#fsGroup.setProps({ el: micrio });
		}

		// Split-screen secondary controls
		const hasSecondary = $zoom && !!this.#secondaryControls;
		this.#showEl(this.#aside2, hasSecondary);
		if (hasSecondary) {
			this.#aside2.classList.toggle('portrait', this.#secondaryPortrait);
		}

		// Grid close button
		const showGridClose = !!this.#gridFocussed && this.#gridClickable == 'focus' && !$popup && !$tour;
		this.#showEl(this.#aside3, showGridClose);
		if (showGridClose) {
			const existingBtn = this.#aside3.querySelector('micrio-button');
			if (!existingBtn) {
				const btn = document.createElement('micrio-button') as any;
				btn.setProps({ type: 'close', title: $i18n.close, onclick: (this as any).__gridBack });
				this.#aside3.appendChild(btn);
			}
		}
	}

	#showEl(el: HTMLElement, show: boolean) {
		el.style.display = show ? '' : 'none';
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioControls.tag, MicrioControls);
