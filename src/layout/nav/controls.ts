import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { Unsubscriber } from '$core/store';
import { get } from '$core/store';
import { i18n } from '$core/i18n/strings';

import { createElement } from '$utils/dom';
import { languageNames } from '$core/i18n/locale';

export interface ControlsProps {
	hasAudio?: boolean;
}

export class MicrioControls extends MicrioElement<ControlsProps> {
	static tag = 'micrio-controls';
	static styles = `micrio-controls{display:contents}
micrio-controls aside:not(.grid-close){position:absolute;right:var(--micrio-border-margin);bottom:var(--micrio-border-margin);padding:0;margin:0;direction:rtl;z-index:2;transition:transform .25s ease,opacity .25s ease}
micr-io.hide-ui micrio-controls aside:not(.grid-close):not(:hover){transform:translateX(calc(100% + var(--micrio-border-margin)));opacity:0;pointer-events:none}
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
	#built = false;
	#showCultures = false;
	#showSocial = false;
	#showFullscreen = false;
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

	#aside1!: HTMLElement;
	#muteBtn: any;
	#shareBtn: any;
	#langMenu: HTMLElement | undefined;
	#group1!: HTMLElement;
	#zoomGroup: any;
	#fsGroup: any;

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const { state: micrioState, _lang } = micrio;
		const { tour, popup } = micrioState;
		const { controls, zoom } = micrio.state.ui;

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

		this.addCleanup(micrio.current.subscribe(c => {
			if (c) {
				if (get(tour) && 'steps' in get(tour)!) return;
				settingsUnsub?.();
				settingsUnsub = c.settings.subscribe(readInfo);
			}
		}));

		this.watchLater(controls, () => this.#sync());
		this.watchLater(zoom, () => this.#sync());
		this.watchLater(tour, () => this.#sync());
		this.watchLater(popup, () => this.#sync());
		this.watchLater(_lang, () => this.#sync());

		const observer = new MutationObserver(() => this.#sync());
		observer.observe(micrio, { attributes: true, attributeFilter: ['class'] });
		this.addCleanup(() => observer.disconnect());

		this.#build();
		this.#sync();
	}

	setProps(props: Partial<ControlsProps>) {
		Object.assign(this.#props, props);
	}

	// ── Build structural DOM once ──

	#build() {
		if (this.#built) return;

		this.#aside1 = createElement('aside', {
			events: {
				pointerover: () => { (this.getMicrio())?.state.ui.hover.set(true); },
				pointerout: (e: Event) => {
					const pe = e as PointerEvent;
					if (!pe.currentTarget || !(pe.currentTarget as HTMLElement).contains(pe.relatedTarget as Node))
						(this.getMicrio())?.state.ui.hover.set(false);
				},
				focusin: () => { (this.getMicrio())?.state.ui.hover.set(true); },
				focusout: (e: Event) => {
					const fe = e as FocusEvent;
					if (!(fe.currentTarget as HTMLElement).contains(fe.relatedTarget as Node))
						(this.getMicrio())?.state.ui.hover.set(false);
				}
			},
			parent: this
		});

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

		if (!hasControls) {
			this.#aside1.replaceChildren();
			return;
		}

		// Mute button
		if (showMute) {
			if (!this.#muteBtn?.isConnected) {
				this.#muteBtn?.remove();
				this.#muteBtn = createElement('micrio-button', { className: 'ctrl-mute' });
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
				this.#langMenu = createElement('menu', {
					className: 'ctrl-lang',
					attrs: { tabindex: '0' },
					children: [
						createElement('micrio-button', { className: 'ctrl-lang-trigger' }),
						createElement('div', { className: 'lang-items' })
					]
				});
				this.#aside1.insertBefore(this.#langMenu, this.#shareBtn?.isConnected ? this.#shareBtn : null);
			}
			const trigger = this.#langMenu.querySelector('.ctrl-lang-trigger') as MicrioElement;
			trigger?.setProps({ type: 'a11y', title: $i18n.switchLanguage });

			const items = this.#langMenu.querySelector('.lang-items')!;
			const culturesKey = cultures.join(',');
			if (culturesKey !== this.#lastCultures) {
				this.#lastCultures = culturesKey;
				items.replaceChildren();

				for (const l of cultures) {
					createElement('micrio-button', {
						setProps: {
							title: languageNames?.of(l) ?? l,
							onclick: () => { this.#setLang(l); }
						},
						children: [l.toUpperCase()],
						parent: items as HTMLElement
					});
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
				this.#shareBtn = createElement('micrio-button', { className: 'ctrl-share' });
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
				this.#group1 = createElement('micrio-button-group', { parent: this.#aside1 });
			}
			if (zoomVisible) {
				if (!this.#zoomGroup?.isConnected) {
					this.#zoomGroup?.remove();
					this.#zoomGroup = createElement('micrio-zoom-buttons', { className: 'ctrl-zoom' });
					if (this.#fsGroup?.isConnected) this.#group1.insertBefore(this.#zoomGroup, this.#fsGroup);
					else this.#group1.appendChild(this.#zoomGroup);
				}
			} else if (this.#zoomGroup?.isConnected) {
				this.#zoomGroup.remove();
			}
			if (hasFullscreen) {
				if (!this.#fsGroup?.isConnected) {
					this.#fsGroup?.remove();
					this.#fsGroup = createElement('micrio-fullscreen', { className: 'ctrl-fs', parent: this.#group1 });
				}
				this.#fsGroup.setProps({ el: micrio });
			} else if (this.#fsGroup?.isConnected) {
				this.#fsGroup.remove();
			}
		} else if (this.#group1?.isConnected) {
			this.#group1.remove();
		}

	}

}

customElements.define(MicrioControls.tag, MicrioControls);
