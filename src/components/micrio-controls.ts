import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import type { Unsubscriber } from '$ts/store';
import { get, tick } from '$ts/store';
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
:global(micr-io[data-switching])>micrio-controls,:global(micr-io[data-tour-active])>micrio-controls{opacity:0;pointer-events:none}
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

	#showCultures = false;
	#showSocial = false;
	#showFullscreen = false;
	#secondaryControls: MicrioImage | null = null;
	#secondaryPortrait = false;
	#gridFocussed: MicrioImage | undefined;
	#gridClickable: 'focus' | 'zoom' | false = false;
	#grid: any = undefined;

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
			this.#renderAll();
		};

		const splitStop = () => {
			this.#secondaryControls = null;
			this.#renderAll();
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
			this.#renderAll();
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
						this.#renderAll();
					});
				}
			}
		}));

		this.#unsubs.push(hover.subscribe(() => this.#renderAll()));
		this.#unsubs.push(hidden.subscribe(() => this.#renderAll()));
		this.#unsubs.push(controls.subscribe(() => this.#renderAll()));
		this.#unsubs.push(zoom.subscribe(() => this.#renderAll()));
		this.#unsubs.push(tour.subscribe(() => this.#renderAll()));
		this.#unsubs.push(popup.subscribe(() => this.#renderAll()));

		// Store event handlers for rendering
		(this as any).__share = share;
		(this as any).__toggleMute = () => isMuted.set(!get(isMuted));
		(this as any).__setLang = (l: string) => { micrio.lang = l; };
		(this as any).__gridBack = () => this.#grid?.back();

		tick().then(() => this.#renderAll());
	}

	setProps(props: Partial<ControlsProps>) {
		Object.assign(this.#props, props);
	}

	#renderAll() {
		this.#render();
	}

	#render() {
		if (!this.isConnected) return;
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

		const showMute = 'micrioAudioContext' in window || this.#props.hasAudio;
		const hasCultures = this.#showCultures && cultures.length > 1;
		const hasSocial = this.#showSocial && ('share' in navigator);
		const hasFullscreen = this.#showFullscreen && !($tour && 'steps' in $tour && ($tour as any).isSerialTour);
		const hasControls = $controls && (showMute || hasCultures || hasSocial || $zoom || hasFullscreen);
		const onlyFullscreen = hasFullscreen && !!$popup && isMobile;
		const gridPanZoomCells = !!$current?.grid && $current.grid.panZoom == 'cells';

		if (!hasControls) { this.innerHTML = ''; return; }

		// Build the controls HTML structure imperatively
		this.replaceChildren();

		const aside = document.createElement('aside');
		aside.className = '';
		aside.classList.toggle('hidden', $hidden && !$hover);
		aside.addEventListener('pointerover', () => micrio.state.ui.hover.set(true));
		aside.addEventListener('pointerout', (e) => {
			if (!e.currentTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
				micrio.state.ui.hover.set(false);
		});
		aside.addEventListener('focusin', () => micrio.state.ui.hover.set(true));
		aside.addEventListener('focusout', (e) => {
			if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
				micrio.state.ui.hover.set(false);
		});

		if (!onlyFullscreen) {
			// Mute button
			if (showMute) {
				const btn = document.createElement('micrio-button') as any;
				btn.setProps({
					type: $isMuted ? 'volume-off' : 'volume-up',
					title: $isMuted ? $i18n.audioUnmute : $i18n.audioMute,
					onclick: (this as any).__toggleMute
				});
				aside.appendChild(btn);
			}

			// Language switch
			if (hasCultures) {
				const menu = document.createElement('menu');
				menu.className = 'popout';
				menu.setAttribute('tabindex', '0');

				const langBtn = document.createElement('micrio-button') as any;
				langBtn.setProps({ type: 'a11y', title: $i18n.switchLanguage });
				menu.appendChild(langBtn);

				for (const l of cultures) {
					const b = document.createElement('micrio-button') as any;
					b.setProps({
						title: languageNames?.of(l) ?? l,
						active: l === $_lang,
						onclick: () => { (this as any).__setLang(l); }
					});
					// Add text content
					b.appendChild(document.createTextNode(l.toUpperCase()));
					menu.appendChild(b);
				}
				aside.appendChild(menu);
			}

			// Share button
			if (hasSocial) {
				const btn = document.createElement('micrio-button') as any;
				btn.setProps({ type: 'share', title: $i18n.share, onclick: (this as any).__share });
				aside.appendChild(btn);
			}
		}

		// ButtonGroup with zoom and fullscreen
		const group = document.createElement('micrio-button-group') as any;

		if ($zoom && !onlyFullscreen && !gridPanZoomCells) {
			if (this.#secondaryControls) {
				const zoom = document.createElement('micrio-zoom-buttons') as any;
				zoom.setProps({ image: this.#secondaryControls });
				group.appendChild(zoom);
			} else {
				const zoom = document.createElement('micrio-zoom-buttons') as any;
				group.appendChild(zoom);
			}
		}

		if (hasFullscreen) {
			const fs = document.createElement('micrio-fullscreen') as any;
			fs.setProps({ el: micrio });
			group.appendChild(fs);
		}
		aside.appendChild(group);

		this.appendChild(aside);

		// Secondary zoom controls for split-screen
		if ($zoom && this.#secondaryControls) {
			const aside2 = document.createElement('aside');
			aside2.className = 'primary';
			aside2.classList.toggle('portrait', this.#secondaryPortrait);

			const group2 = document.createElement('micrio-button-group') as any;
			const zoom2 = document.createElement('micrio-zoom-buttons') as any;
			group2.appendChild(zoom2);
			aside2.appendChild(group2);
			this.appendChild(aside2);
		}

		// Grid close button
		if (this.#gridFocussed && this.#gridClickable == 'focus' && !$popup && !$tour) {
			const aside3 = document.createElement('aside');
			aside3.className = 'grid-close';
			const closeBtn = document.createElement('micrio-button') as any;
			closeBtn.setProps({ type: 'close', title: $i18n.close, onclick: (this as any).__gridBack });
			aside3.appendChild(closeBtn);
			this.appendChild(aside3);
		}
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioControls.tag, MicrioControls);
