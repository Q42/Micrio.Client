import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import { i18n } from '$core/i18n/strings';
import './menu';
import '$ui/button';
import './toolbar.css';
import { randomUUID } from '$utils/id';

class MicrioToolbar extends MicrioElement {
	static tag = 'micrio-toolbar';

	#data: Models.ImageData.ImageData | undefined;
	#shown = false;
	#isMobile = false;
	#toggle = () => {
		this.#shown = !this.#shown;
		this.#render();
	};

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const { _lang } = micrio;

		this.#isMobile = window.innerWidth <= 500;
		const resize = () => {
			this.#isMobile = window.innerWidth <= 500;
			if (!this.#isMobile) this.#shown = false;
			this.#render();
		};

		this.#render();

		this.addCleanup(micrio.current.subscribe(c => {
			if (!c) return;
			this.addCleanup(c.data.subscribe(d => {
				this.#data = d;
				this.#render();
			}));
			this.addCleanup(c.settings.subscribe(() => this.syncDisplay?.()));
		}));

		this.addCleanup(micrio.state.tour.subscribe(() => this.#render()));
		this.addCleanup(micrio.state.marker.subscribe(() => this.#render()));
		this.addCleanup(micrio.state.popover.subscribe(() => this.#render()));
		this.addCleanup(_lang.subscribe(() => this.#render()));

		window.addEventListener('resize', resize);
		this.addCleanup(() => window.removeEventListener('resize', resize));
	}

	#render() {
		if (!this.#data) return;
		const micrio = this.getMicrio();
		if (!micrio) return;
		const { _lang, spaceData, state: micrioState } = micrio;
		const $_lang = get(_lang);
		const $tour = get(micrioState.tour);
		const $marker = get(micrioState.marker);
		const $popover = get(micrioState.popover);
		const $i18n = get(i18n);
		const originalId = (micrio.$current as MicrioImage)?.id;

		const hasTourLang = (t: any): boolean => !!t.i18n?.[$_lang];
		const hasPageLang = (p: Models.ImageData.Menu): boolean => !!p.i18n?.[$_lang];
		const hidden = !!$tour || !!$marker || !!$popover;

		const markerTours = ((this.#data?.markerTours ?? []).concat(spaceData?.markerTours ?? [])).filter(hasTourLang);
		const hasMarkerTours = markerTours.length > 0;
		const videoTours = this.#data?.tours?.filter(hasTourLang) ?? [];
		const hasVideoTours = videoTours.length > 0;
		const hasBothTourTypes = hasMarkerTours && hasVideoTours;
		const mainPages = this.#data?.pages
			? this.#data.pages.filter(p => !p.id?.startsWith('_') && hasPageLang(p))
				.concat(this.#data.pages.filter(p => p.id?.startsWith('_')))
			: undefined;
		const empty = !(mainPages?.length || hasMarkerTours || hasVideoTours);
		const pageIds = (mainPages || []).map((p: any) => p.id).join(',');
		const tourIds = markerTours.map((t: any) => t.id).join(',') + '|' + videoTours.map((t: any) => t.id).join(',');
		const key = [pageIds, tourIds, hidden, $_lang, this.#isMobile, this.#shown].join('::');
		if (!this.checkRenderKey(key)) return;

		if (empty || hidden) { this.replaceChildren(); return; }

		this.replaceChildren();

		if (this.#isMobile && this.#shown) {
			createElement('div', {
				className: 'backdrop',
				events: { click: this.#toggle },
				parent: this
			});
		}

		const menu = createElement('menu', {
			className: (this.#isMobile && this.#shown ? 'shown' : '') || undefined
		});

		const closeSheet = () => { if (this.#isMobile) { this.#shown = false; this.#render(); } };

		if (mainPages) {
			for (const page of mainPages) {
				createElement('micrio-menu', {
					setProps: { menu: page, originalId, onclose: closeSheet },
					parent: menu
				});
			}
		}

		if (hasMarkerTours) {
			createElement('micrio-menu', {
				setProps: {
					onclose: closeSheet,
					menu: {
						id: 'marker-tours',
						i18n: { [$_lang]: { title: hasBothTourTypes ? $i18n._markerTours : $i18n._tours } },
						children: markerTours.map((t) => ({
							id: t.id ?? randomUUID(),
							i18n: { [$_lang]: { title: t.i18n?.[$_lang]?.title ?? '(Untitled)' } },
							action: () => { t.initialStep = 0; micrioState.tour.set(t); }
						}))
					}
				},
				parent: menu
			});
		}

		if (hasVideoTours) {
			createElement('micrio-menu', {
				setProps: {
					onclose: closeSheet,
					menu: {
						id: 'video-tours',
						i18n: { [$_lang]: { title: hasBothTourTypes ? $i18n._videoTours : $i18n._tours } },
						children: videoTours.map((t: any) => ({
							id: t.id ?? randomUUID(),
							i18n: { [$_lang]: { title: t.i18n?.[$_lang]?.title ?? '(Untitled)' } },
							action: () => {
								if (micrio.$current && micrio.$current.id != originalId) micrio.open(originalId);
								micrioState.tour.set(t);
							}
						}))
					}
				},
				parent: menu
			});
		}

		this.appendChild(menu);
		this.syncDisplay?.();

		if (this.#isMobile) {
			createElement('micrio-button', {
				setProps: {
					title: $i18n._menuToggle,
					type: this.#shown ? 'close' : 'ellipsisVertical',
					className: 'transparent' + (this.querySelector('menu.indent') ? ' indent' : '') || undefined,
					onclick: this.#toggle
				},
				parent: this
			});
		}
	}

	protected syncDisplay() {
		const menuEl = this.querySelector('menu');
		if (menuEl) {
			const micrio = this.getMicrio();
			const indent = !(micrio?.$current?.$settings?.noLogo ?? false);
			menuEl.classList.toggle('indent', indent);
		}
	}


}

customElements.define(MicrioToolbar.tag, MicrioToolbar);
