import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { once } from '$ts/utils/store';
import { i18n } from '$ts/i18n/strings';
import './micrio-menu';
import '$ui/button';

export class MicrioToolbar extends MicrioElement {
	static tag = 'micrio-toolbar';
	static styles = `micrio-toolbar{display:contents}
micrio-toolbar menu.micrio-toolbar{position:absolute;top:calc(var(--micrio-border-margin) - (var(--micrio-button-size) / 2 - 27px));left:var(--micrio-border-margin);margin:0;padding:0;color:#fff;text-shadow:1px 1px 2px #000;transition:transform .25s ease;z-index:1}
@media(max-width:500px){micrio-toolbar .micrio-button.toggle{position:absolute;top:var(--micrio-border-margin);left:0;height:34px;width:34px;box-shadow:none;z-index:2}
micrio-toolbar .micrio-button.toggle.indent{left:35px}
micrio-toolbar menu.micrio-toolbar{transform:translate3d(0,0,0);width:100%;height:100%;background:rgba(0,0,0,0.75);top:0;left:0;padding:32px 0;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;backdrop-filter:var(--micrio-background-filter);z-index:1}
micrio-toolbar menu.micrio-toolbar:not(.shown){transform:translate3d(calc(-100% - var(--micrio-border-margin) * 2),0,0)}
}
@media(min-width:501px){micrio-toolbar menu.indent{margin-left:calc(var(--micrio-border-margin) * 2 + 25px)}
micrio-toolbar menu>.micrio-menu:not(:hover)>button.micrio-menu{margin-bottom:-15px}
micrio-toolbar .micrio-toolbar>micrio-menu{color:#fff;margin-right:var(--micrio-border-margin);border-radius:var(--micrio-border-radius)}
micrio-toolbar .micrio-toolbar>micrio-menu:hover,micrio-toolbar .micrio-toolbar>micrio-menu:focus-within{backdrop-filter:var(--micrio-background-filter);background:var(--micrio-background);box-shadow:var(--micrio-button-shadow)}
}`;

	#unsubs: (() => void)[] = [];
	#data: Models.ImageData.ImageData | undefined;
	#shown = false;
	#isMobile = false;
	#toggle = () => this.#shown = !this.#shown;

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const { _lang } = micrio;

		this.#isMobile = window.innerWidth <= 500;
		const resize = () => { this.#isMobile = window.innerWidth <= 500; this.#render(); };

		this.#render();

		this.#unsubs.push(micrio.current.subscribe(c => {
			if (!c) return;
			this.#unsubs.push(c.data.subscribe(d => {
				this.#data = d;
				this.#render();
			}));
			once(c.info).then(() => this.#unsubs.push(c.settings.subscribe(() => this.syncDisplay?.())));
		}));

		this.#unsubs.push(micrio.state.tour.subscribe(() => this.#render()));
		this.#unsubs.push(micrio.state.marker.subscribe(() => this.#render()));
		this.#unsubs.push(micrio.state.popover.subscribe(() => this.#render()));
		this.#unsubs.push(_lang.subscribe(() => this.#render()));

		window.addEventListener('resize', resize);
		this.#unsubs.push(() => window.removeEventListener('resize', resize));
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

		if (empty || hidden) { this.innerHTML = ''; return; }

		this.replaceChildren();

		const menu = document.createElement('menu');
		menu.className = 'micrio-toolbar';
		menu.classList.toggle('shown', !hidden && this.#shown);

		if (mainPages) {
			for (const page of mainPages) {
				const child = document.createElement('micrio-menu') as MicrioElement;
				child.setProps({ menu: page, originalId, onclose: () => { if (this.#isMobile) this.#shown = false; } });
				menu.appendChild(child);
			}
		}

		if (hasMarkerTours) {
			const child = document.createElement('micrio-menu') as MicrioElement;
			child.setProps({
				onclose: () => { if (this.#isMobile) this.#shown = false; },
				menu: {
					id: 'marker-tours',
					i18n: { [$_lang]: { title: hasBothTourTypes ? $i18n.markerTours : $i18n.tours } },
					children: markerTours.map((t) => ({
						id: t.id ?? crypto.randomUUID(),
						i18n: { [$_lang]: { title: t.i18n?.[$_lang]?.title ?? '(Untitled)' } },
						action: () => { t.initialStep = 0; micrioState.tour.set(t); }
					}))
				}
			});
			menu.appendChild(child);
		}

		if (hasVideoTours) {
			const child = document.createElement('micrio-menu') as MicrioElement;
			child.setProps({
				onclose: () => { if (this.#isMobile) this.#shown = false; },
				menu: {
					id: 'video-tours',
					i18n: { [$_lang]: { title: hasBothTourTypes ? $i18n.videoTours : $i18n.tours } },
					children: videoTours.map((t: any) => ({
						id: t.id ?? crypto.randomUUID(),
						i18n: { [$_lang]: { title: t.i18n?.[$_lang]?.title ?? '(Untitled)' } },
						action: () => {
							if (micrio.$current && micrio.$current.id != originalId) micrio.open(originalId);
							micrioState.tour.set(t);
						}
					}))
				}
			});
			menu.appendChild(child);
		}

		this.appendChild(menu);
		this.syncDisplay?.();

		if (this.#isMobile) {
			const btn = document.createElement('micrio-button') as MicrioElement;
			btn.setProps({
				title: $i18n.menuToggle,
				type: this.#shown ? 'close' : 'ellipsis-vertical',
				className: 'toggle transparent' + (this.querySelector('.micrio-toolbar.indent') ? ' indent' : ''),
				onclick: this.#toggle
			});
			this.appendChild(btn);
		}
	}

	protected syncDisplay() {
		const menuEl = this.querySelector('.micrio-toolbar');
		if (menuEl) {
			const micrio = this.getMicrio();
			const indent = !(micrio?.$current?.$settings?.noLogo ?? false);
			menuEl.classList.toggle('indent', indent);
		}
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioToolbar.tag, MicrioToolbar);
