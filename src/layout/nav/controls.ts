import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { Unsubscriber } from '$core/store';
import { get } from '$core/store';
import { i18n } from '$core/i18n/strings';

import { createElement } from '$utils/dom';
import { languageNames } from '$core/i18n/locale';

/** Props for the navigation controls element @internal */
export interface ControlsProps {
	/** Whether the image has audio that can be muted/unmuted */
	hasAudio?: boolean;
}
import './controls.css';

/** Custom element rendering bottom navigation controls (mute, language, share, zoom, fullscreen) */
class MicrioControls extends MicrioElement<ControlsProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-controls';

	#props: ControlsProps = {};
	#built = false;
	#showCultures = false;
	#showSocial = false;
	#showFullscreen = false;
	#lastCultures = '';

	#toggleMute = () => {
		const micrio = this._getMicrio();
		if (!micrio) return;
		micrio._isMuted.set(!get(micrio._isMuted));
	};

	#share = () => {
		const micrio = this._getMicrio();
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
		this._getMicrio()!.lang = l;
	};

	#aside1!: HTMLElement;
	#muteBtn: any;
	#shareBtn: any;
	#langMenu: HTMLElement | undefined;
	#langItemsEl: HTMLElement | undefined;
	#group1!: HTMLElement;
	#zoomGroup: any;
	#fsGroup: any;

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio();
		if (!micrio) return;

		const { state: micrioState, _lang } = micrio;
		const { tour, popup } = micrioState;

		const readInfo = (s: Models.ImageInfo.Settings) => {
			this.#showCultures = !!s.ui?.controls?.cultureSwitch;
			this.#showSocial = !!s.social;
			if (s.fullscreen !== undefined) this.#showFullscreen = !!s.fullscreen;
			this.#sync();
		};

		if (micrio.$current) readInfo(micrio.$current.$settings);

		let settingsUnsub: Unsubscriber | undefined;

		this._addCleanup(micrio.current.subscribe(c => {
			if (c) {
				if (get(tour) && 'steps' in get(tour)!) return;
				settingsUnsub?.();
				settingsUnsub = c._settings.subscribe(readInfo);
			}
		}));

		this._watchLater(tour, () => this.#sync());
		this._watchLater(popup, () => this.#sync());
		this._watchLater(_lang, () => this.#sync());
		this._watchLater(micrio._isMuted, () => this.#sync());

		const observer = new MutationObserver(() => this.#sync());
		observer.observe(micrio, { attributes: true, attributeFilter: ['class'] });
		this._addCleanup(() => observer.disconnect());

		this.#build();
		this.#sync();
	}

	/** @internal */
	_setProps(props: Partial<ControlsProps>) {
		Object.assign(this.#props, props);
	}

	// ── Build structural DOM once ──

	#build() {
		if (this.#built) return;

		this.#aside1 = createElement('aside', {
			parent: this
		});

		this.#built = true;
	}

	// ── Sync state — create/remove elements on demand ──

	#sync() {
		if (!this.#built || !this.isConnected) return;

		const micrio = this._getMicrio();
		if (!micrio) return;

		const $i18n = get(i18n);
		const $isMuted = get(micrio._isMuted);
		const $_lang = get(micrio._lang);
		const $current = micrio.$current;
		const $settings = $current?.$settings;
		const $zoom = !$settings?.noZoom;
		const $popup = get(micrio.state.popup);
		const info = $current?.$info;
		const cultures = info?.revision ? Object.keys(info.revision) : [];
		const isMobile = micrio.canvas.$isMobile;

		const showMute = !!('micrioAudioContext' in window || this.#props.hasAudio);
		const hasCultures = this.#showCultures && cultures.length > 1;
		const hasSocial = this.#showSocial && ('share' in navigator);
		const hasControls = showMute || hasCultures || hasSocial || $zoom || this.#showFullscreen;
		const onlyFullscreen = this.#showFullscreen && !!$popup && isMobile;
		const gridPanZoomCells = !!$current?.grid && $current?.$settings?.grid?.panZoom == 'cells';
		const zoomVisible = $zoom && !onlyFullscreen && !gridPanZoomCells;
		const showGroup = showMute || zoomVisible || this.#showFullscreen;

		if (($popup && isMobile) || !hasControls) {
			this.#aside1.replaceChildren();
			return;
		}

		// Language menu
		if (hasCultures && !onlyFullscreen) {
			if (!this.#langMenu?.isConnected) {
				this.#langMenu?.remove();
				this.#langItemsEl = undefined;
				this.#lastCultures = '';
				this.#langMenu = createElement('menu', {
					attrs: { tabindex: '0' },
					children: [
						createElement('micrio-button'),
						this.#langItemsEl = createElement('div')
					]
				});
				this.#aside1.insertBefore(this.#langMenu, this.#shareBtn?.isConnected ? this.#shareBtn : null);
			}
			const trigger = this.#langMenu.querySelector('micrio-button') as MicrioElement;
			trigger?._setProps({ type: 'a11y', title: $i18n._switchLanguage });

			const items = this.#langItemsEl!;
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
				const inner = langBtns[i].querySelector('button, a');
				if (inner) inner.classList.toggle('active', cultures[i].toLowerCase() === $_lang.toLowerCase());
			}
		} else if (this.#langMenu?.isConnected) {
			this.#langMenu.remove();
		}

		// Share button
		if (hasSocial && !onlyFullscreen) {
			if (!this.#shareBtn?.isConnected) {
				this.#shareBtn?.remove();
				this.#shareBtn = createElement('micrio-button');
				this.#aside1.insertBefore(this.#shareBtn, this.#group1?.isConnected ? this.#group1 : null);
			}
			this.#shareBtn._setProps({ type: 'share', title: $i18n._share, onclick: this.#share });
		} else if (this.#shareBtn?.isConnected) {
			this.#shareBtn.remove();
		}

		// Button group (mute, zoom, fullscreen)
		if (showGroup) {
			if (!this.#group1?.isConnected) {
				this.#group1?.remove();
				this.#group1 = createElement('micrio-button-group', { parent: this.#aside1 });
			}
			// Mute button (inserted first)
			if (showMute) {
				if (!this.#muteBtn?.isConnected) {
					this.#muteBtn?.remove();
					this.#muteBtn = createElement('micrio-button');
					this.#group1.prepend(this.#muteBtn);
				}
				this.#muteBtn._setProps({
					type: $isMuted ? 'muted' : 'unmuted',
					title: $isMuted ? $i18n._audioUnmute : $i18n._audioMute,
					onclick: this.#toggleMute
				});
			} else if (this.#muteBtn?.isConnected) {
				this.#muteBtn.remove();
			}
			if (zoomVisible) {
				if (!this.#zoomGroup?.isConnected) {
					this.#zoomGroup?.remove();
					this.#zoomGroup = createElement('micrio-zoom-buttons');
					if (this.#fsGroup?.isConnected) this.#group1.insertBefore(this.#zoomGroup, this.#fsGroup);
					else this.#group1.appendChild(this.#zoomGroup);
				}
			} else if (this.#zoomGroup?.isConnected) {
				this.#zoomGroup.remove();
			}
			if (this.#showFullscreen) {
				if (!this.#fsGroup?.isConnected) {
					this.#fsGroup?.remove();
					this.#fsGroup = createElement('micrio-fullscreen', { parent: this.#group1 });
				}
				this.#fsGroup._setProps({ el: micrio });
			} else if (this.#fsGroup?.isConnected) {
				this.#fsGroup.remove();
			}
		} else if (this.#group1?.isConnected) {
			this.#group1.remove();
		}

	}

}

customElements.define(MicrioControls.tag, MicrioControls);
