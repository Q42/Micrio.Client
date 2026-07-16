import { MicrioElement } from '$ts/component';
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
	static styles = `micrio-controls{display:contents}
micrio-controls aside:not(.grid-close){position:absolute;right:var(--micrio-border-margin);bottom:var(--micrio-border-margin);padding:0;margin:0;direction:rtl;z-index:2;transition:transform .25s ease,opacity .25s ease}
micrio-controls aside:not(.grid-close).hidden:not(:hover){transform:translateX(calc(100% + var(--micrio-border-margin)));opacity:0;pointer-events:none}
micrio-controls aside.primary:not(.portrait){right:calc(50% + var(--micrio-border-margin))}
micrio-controls aside.primary.portrait{bottom:calc(50% + var(--micrio-border-margin))}
micrio-controls aside.grid-close{top:var(--micrio-border-margin);bottom:auto;position:absolute;right:var(--micrio-border-margin);max-width:calc(100% - var(--micrio-border-margin) * 2);z-index:2}
micr-io[data-switching]>micrio-controls,micr-io[data-tour-active]>micrio-controls{opacity:0;pointer-events:none}
micrio-controls>micrio-button,micrio-controls>menu{padding:0;margin:8px 0;display:block;width:var(--micrio-button-size)}
micrio-controls menu.ctrl-lang{position:relative;padding:0;margin:8px 0;width:var(--micrio-button-size);min-height:var(--micrio-button-size)}
micrio-controls .lang-items{position:absolute;right:100%;top:0;display:none;flex-direction:row;background:var(--micrio-background);backdrop-filter:var(--micrio-background-filter);border-radius:var(--micrio-border-radius);box-shadow:var(--micrio-button-shadow);white-space:nowrap}
micrio-controls menu.ctrl-lang:hover .lang-items,micrio-controls menu.ctrl-lang:focus-within .lang-items{display:flex}
micrio-controls .lang-items micrio-button{--micrio-button-shadow:none;--micrio-background-filter:none}
micrio-controls .lang-items .micrio-button{padding:0}
micrio-controls .lang-items .micrio-button>span{width:var(--micrio-button-size)}
micrio-controls .lang-items .micrio-button.active{background:var(--micrio-color-hover);color:var(--micrio-button-background,var(--micrio-background))}`;

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
	#lastCultures = '';

	#toggleMute = () => {
		const micrio = this.getMicrio();
		if (!micrio) return;
		micrio.isMuted.set(!get(micrio.isMuted));
	};

	#share = () => {
		const micrio = this.getMicrio();
		if (!micrio || !navigator.share) return;
		if (micrio.$current?.$info) {
			const cData = micrio.$current.$data?.i18n?.[get(micrio._lang)];
			navigator.share({
				title: micrio.$current.$info?.title,
				text: cData?.description || `${micrio.$current.$info.width} x ${micrio.$current.$info.height} | Micrio`,
				url: location.href
			});
		}
	};

	#setLang = (l: string) => {
		this.getMicrio()!.lang = l;
	};

	#gridBack = () => this.#grid?.back();

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
		const micrio = this.getMicrio();
		if (!micrio) return;

		const { state: micrioState, _lang } = micrio;
		const { tour, popup } = micrioState;
		const { controls, zoom, hidden } = micrio.state.ui;

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

		this.watchLater(hidden, () => this.#sync());
		this.watchLater(controls, () => this.#sync());
		this.watchLater(zoom, () => this.#sync());
		this.watchLater(tour, () => this.#sync());
		this.watchLater(popup, () => this.#sync());
		this.watchLater(_lang, () => this.#sync());

		this.#build();
		this.#sync();
	}

	setProps(props: Partial<ControlsProps>) {
		Object.assign(this.#props, props);
	}

	// ── Build structural DOM once ──

	#build() {
		if (this.#built) return;

		this.#aside1 = document.createElement('aside');
		this.#aside1.addEventListener('pointerover', () => {
			(this.getMicrio())?.state.ui.hover.set(true);
		});
		this.#aside1.addEventListener('pointerout', (e) => {
			if (!e.currentTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
				(this.getMicrio())?.state.ui.hover.set(false);
		});
		this.#aside1.addEventListener('focusin', () => {
			(this.getMicrio())?.state.ui.hover.set(true);
		});
		this.#aside1.addEventListener('focusout', (e) => {
			if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
				(this.getMicrio())?.state.ui.hover.set(false);
		});
		this.appendChild(this.#aside1);

		this.#aside2 = document.createElement('aside');
		this.#aside2.className = 'primary';
		this.appendChild(this.#aside2);

		this.#aside3 = document.createElement('aside');
		this.#aside3.className = 'grid-close';
		this.appendChild(this.#aside3);

		this.#built = true;
	}

	// ── Sync state — create/remove elements on demand ──

	#sync() {
		if (!this.#built || !this.isConnected) return;

		const micrio = this.getMicrio();
		if (!micrio) return;

		const $i18n = get(i18n);
		const $isMuted = get(micrio.isMuted);
		const $_lang = get(micrio._lang);
		const $controls = get(micrio.state.ui.controls);
		const $hidden = get(micrio.state.ui.hidden);
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
		const hasFullscreen = this.#showFullscreen && !($tour && 'steps' in $tour && $tour.isSerialTour);
		const hasControls = $controls && (showMute || hasCultures || hasSocial || $zoom || hasFullscreen);
		const onlyFullscreen = hasFullscreen && !!$popup && isMobile;
		const gridPanZoomCells = !!$current?.grid && $current.grid.panZoom == 'cells';

		this.#aside1?.classList.toggle('hidden', !!$hidden);

		if (!hasControls) {
			this.#aside1.replaceChildren();
			this.#aside2.replaceChildren();
			this.#aside3.replaceChildren();
			return;
		}

		// Mute button
		if (showMute) {
			if (!this.#muteBtn?.isConnected) {
				this.#muteBtn?.remove();
				this.#muteBtn = document.createElement('micrio-button');
				this.#muteBtn.className = 'ctrl-mute';
				this.#aside1.prepend(this.#muteBtn);
			}
			this.#muteBtn.setProps({
				type: $isMuted ? 'volume-off' : 'volume-up',
				title: $isMuted ? $i18n.audioUnmute : $i18n.audioMute,
				onclick: this.#toggleMute
			});
		} else if (this.#muteBtn?.isConnected) {
			this.#muteBtn.remove();
		}

		// Language menu
		if (hasCultures && !onlyFullscreen) {
			if (!this.#langMenu?.isConnected) {
				this.#langMenu?.remove();
				this.#langMenu = document.createElement('menu');
				this.#langMenu.className = 'ctrl-lang';
				this.#langMenu.setAttribute('tabindex', '0');
				const trigger = document.createElement('micrio-button');
				trigger.className = 'ctrl-lang-trigger';
				this.#langMenu.appendChild(trigger);
				const items = document.createElement('div');
				items.className = 'lang-items';
				this.#langMenu.appendChild(items);
				this.#aside1.insertBefore(this.#langMenu, this.#shareBtn?.isConnected ? this.#shareBtn : null);
			}
			const trigger = this.#langMenu.querySelector('.ctrl-lang-trigger') as MicrioElement;
			trigger?.setProps({ type: 'a11y', title: $i18n.switchLanguage });

			const items = this.#langMenu.querySelector('.lang-items')!;
			const culturesKey = cultures.join(',');
			if (culturesKey !== this.#lastCultures) {
				this.#lastCultures = culturesKey;
				items.innerHTML = '';

				for (const l of cultures) {
					const b = document.createElement('micrio-button') as MicrioElement;
					b.setProps({
						title: languageNames?.of(l) ?? l,
						onclick: () => { this.#setLang(l); }
					});
					b.appendChild(document.createTextNode(l.toUpperCase()));
					items.appendChild(b);
				}
			}
			// Update active state on all language buttons
			const langBtns = items.querySelectorAll(':scope > micrio-button');
			for (let i = 0; i < langBtns.length; i++) {
				const inner = langBtns[i].querySelector('.micrio-button');
				if (inner) inner.classList.toggle('active', cultures[i].toLowerCase() === $_lang.toLowerCase());
			}
		} else if (this.#langMenu?.isConnected) {
			this.#langMenu.remove();
		}

		// Share button
		if (hasSocial && !onlyFullscreen) {
			if (!this.#shareBtn?.isConnected) {
				this.#shareBtn?.remove();
				this.#shareBtn = document.createElement('micrio-button');
				this.#shareBtn.className = 'ctrl-share';
				this.#aside1.insertBefore(this.#shareBtn, this.#group1?.isConnected ? this.#group1 : null);
			}
			this.#shareBtn.setProps({ type: 'share', title: $i18n.share, onclick: this.#share });
		} else if (this.#shareBtn?.isConnected) {
			this.#shareBtn.remove();
		}

		// Zoom + fullscreen button group
		const zoomVisible = $zoom && !onlyFullscreen && !gridPanZoomCells;
		const showGroup = zoomVisible || hasFullscreen;

		if (showGroup) {
			if (!this.#group1?.isConnected) {
				this.#group1?.remove();
				this.#group1 = document.createElement('micrio-button-group');
				this.#aside1.appendChild(this.#group1);
			}
			if (zoomVisible) {
				if (!this.#zoomGroup?.isConnected) {
					this.#zoomGroup?.remove();
					this.#zoomGroup = document.createElement('micrio-zoom-buttons');
					this.#zoomGroup.className = 'ctrl-zoom';
					if (this.#fsGroup?.isConnected) this.#group1.insertBefore(this.#zoomGroup, this.#fsGroup);
					else this.#group1.appendChild(this.#zoomGroup);
				}
			} else if (this.#zoomGroup?.isConnected) {
				this.#zoomGroup.remove();
			}
			if (hasFullscreen) {
				if (!this.#fsGroup?.isConnected) {
					this.#fsGroup?.remove();
					this.#fsGroup = document.createElement('micrio-fullscreen');
					this.#fsGroup.className = 'ctrl-fs';
					this.#group1.appendChild(this.#fsGroup);
				}
				this.#fsGroup.setProps({ el: micrio });
			} else if (this.#fsGroup?.isConnected) {
				this.#fsGroup.remove();
			}
		} else if (this.#group1?.isConnected) {
			this.#group1.remove();
		}

		// Split-screen secondary controls
		const hasSecondary = $zoom && !!this.#secondaryControls;
		if (hasSecondary) {
			if (!this.#aside2?.isConnected) {
				this.#aside2?.remove();
				this.#aside2 = document.createElement('aside');
				this.#aside2.className = 'primary';
				const group2 = document.createElement('micrio-button-group');
				const zoom2 = document.createElement('micrio-zoom-buttons');
				group2.appendChild(zoom2);
				this.#aside2.appendChild(group2);
				this.appendChild(this.#aside2);
			}
			this.#aside2.classList.toggle('portrait', this.#secondaryPortrait);
		} else if (this.#aside2?.isConnected) {
			this.#aside2.remove();
		}

		// Grid close button
		const showGridClose = !!this.#gridFocussed && this.#gridClickable == 'focus' && !$popup && !$tour;
		if (showGridClose) {
			if (!this.#aside3?.isConnected) {
				this.#aside3?.remove();
				this.#aside3 = document.createElement('aside');
				this.#aside3.className = 'grid-close';
				const btn = document.createElement('micrio-button') as MicrioElement;
				btn.setProps({ type: 'close', title: $i18n.close, onclick: this.#gridBack });
				this.#aside3.appendChild(btn);
				this.appendChild(this.#aside3);
			}
		} else if (this.#aside3?.isConnected) {
			this.#aside3.remove();
		}
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioControls.tag, MicrioControls);
