import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get, tick } from '$core/store';
import { getSpaceVector } from '$utils/space';
import { createElement } from '$utils/dom';

export interface MarkerProps {
	marker: Models.ImageData.Marker;
	image?: MicrioImage;
	forceHidden?: boolean;
	coords?: Map<string, [number, number, number?, number?]>;
	overlapped?: boolean;
}

export class MicrioMarker extends MicrioElement<MarkerProps> {
	static tag = 'micrio-marker';
	static styles = `micrio-marker{position:absolute;display:block;transform:translate3d(var(--x,0),var(--y,0),0) translate(-50%,-50%) scale3d(var(--scale,1),var(--scale,1),1);top:0;left:0;will-change:transform}
micrio-marker:not(.cluster){animation:micrio-marker-fade .25s forwards}
micrio-marker.overlapped{display:none}
@keyframes micrio-marker-fade{from{opacity:0}to{opacity:1}}
micrio-marker.behind{pointer-events:none;opacity:0!important}
micrio-marker.mat3d{transform:var(--mat);top:50%;left:50%;transform-style:preserve-3d}
micrio-marker.mat3d button{position:absolute;transform:translate3d(-50%,-50%,0)}
micrio-marker button{display:block;width:var(--micrio-marker-size);height:var(--micrio-marker-size);color:var(--micrio-marker-text-color);position:relative;cursor:pointer;font:inherit;padding:0;margin:0;background:transparent none center center no-repeat;background-image:var(--micrio-marker-icon);background-size:contain;border:none}
micrio-marker label{position:absolute;top:50%;left:100%;text-align:var(--micrio-text-align);cursor:pointer;transform:translate(0,-50%);padding-left:10px;max-width:170px;width:max-content;white-space:pre-wrap;font-size:90%;font-weight:600;line-height:1em;text-shadow:var(--micrio-marker-text-shadow);opacity:0;pointer-events:none;transition:opacity .1s ease}
micrio-marker:hover{z-index:2}
micrio-marker:hover label,.show-titles micrio-marker label{opacity:1}
@media(max-width:640px){micrio-marker label{font-size:12px}}
.show-titles micrio-marker label{pointer-events:all}
micrio-marker label.static{transform:translate(-50%,4px) scale3d(calc(1/var(--scale,1)),calc(1/var(--scale,1)),1)}
micrio-marker.default button{box-sizing:content-box;background-clip:content-box;border-radius:var(--micrio-marker-border-radius);border:var(--micrio-marker-border-size) solid var(--micrio-marker-border-color);transition:var(--micrio-marker-transition);background-color:var(--micrio-marker-color)}
micrio-marker.default:hover,micrio-marker.default.opened{z-index:1}
micrio-marker.default:hover button,micrio-marker.default.opened button{background-color:var(--micrio-marker-highlight);border-width:0;width:calc(var(--micrio-marker-size,25px) + var(--micrio-marker-border-size,3px)*2);height:calc(var(--micrio-marker-size,25px) + var(--micrio-marker-border-size,3px)*2)}
micrio-marker.has-icon{--micrio-marker-icon:none}
micrio-marker.has-custom-icon{--micrio-marker-size:32px}
micrio-marker.default.has-icon button{color:#fff;width:calc(var(--micrio-marker-size) + 24px);height:calc(var(--micrio-marker-size) + 24px);background-color:var(--micrio-marker-border-color);border:none}
micrio-marker.default.has-icon.opened button svg,micrio-marker.default.has-icon:hover button svg{color:var(--micrio-marker-highlight)}
micrio-marker.default.has-custom-icon button{background-color:transparent}
micrio-marker.default.has-custom-icon.opened button,micrio-marker.default.has-custom-icon:hover button{background-color:var(--micrio-marker-highlight,var(--micrio-marker-color))}
micrio-marker.cluster button{border:2px solid var(--micrio-marker-color);background:var(--micrio-cluster-marker-background,#fff);color:var(--micrio-cluster-marker-color,#000);width:calc(var(--micrio-marker-size) + 12px);height:calc(var(--micrio-marker-size) + 12px);border-radius:100%;box-sizing:content-box}
micrio-marker.cluster:hover button{background:var(--micrio-marker-highlight,#fff);border-color:var(--micrio-marker-highlight,#fff)}
micrio-marker.cluster label{pointer-events:none;display:none}
micrio-marker:empty{display:none}
micrio-marker img{max-width:100%;max-height:100%;display:block;margin:auto}`;

	#props: MarkerProps = { marker: null! };
	#opened = false;
	#behindCam = false;
	#x = 0;
	#y = 0;
	#scaleVal = 1;
	#w = 0;
	#matrix = '';
	#fto: any;
	// Omni arc visibility: target frame index and [start, end] frame range
	#omniIndex = 0;
	#omniArc: [number, number] | undefined;

	onMount() {
		const { marker, image, forceHidden = false } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio || !image || !marker) return;

		const markerImages = MicrioElement.markerImages as Map<string, MicrioImage>;
		if (!markerImages.has(marker.id) && image) markerImages.set(marker.id, image);

		const events = micrio.events;
		const $_lang = get(micrio._lang);
		const markerSettings = image.$settings._markers ?? {};
		const content = marker.i18n?.[$_lang];
		const data = marker.data ?? {};
		const noTitles = marker.data?.showTitle === false || !!markerSettings.noTitles || !!image.$settings.omni?.sideLabels;
		const noToolTips = /[?&]micrioNoTooltips/.test(location.search) || !!image.$settings.omni?.sideLabels;

		// Derive marker view from video tour
		if (marker.videoTour) {
			const vt = marker.videoTour;
			const timeline = vt.i18n?.[$_lang]?.timeline;
			if (timeline?.length) marker.view = timeline[0].rect;
		}

		const showLabel = content && (!noTitles) && (content.label || content.title);
		const cluster = marker.type == 'cluster';
		const icon = !cluster && marker.type == 'link' ? 'link' : marker.type == 'media' ? 'play' : undefined;
		const customIcon = marker.data?.customIconIdx != undefined
			? image.$settings._markers?.customIcons?.[marker.data.customIconIdx]
			: marker.data?.icon || markerSettings.markerIcon;
		const hasIcon = !!icon || !!customIcon;
		const defaultClass = hasIcon || marker.type == 'default';

		// Omni arc: precompute target frame and visible range from marker rotation/visibleArc
		const omni = image.$settings.omni;
		if (image.isOmni && omni) {
			const rot = (marker.rotation ?? 0) + (marker.backside ? Math.PI : 0);
			this.#omniIndex = image.camera.getOmniFrame(rot) ?? 0;
			if (marker.visibleArc) {
				const a0 = image.camera.getOmniFrame(marker.visibleArc[0]);
				const a1 = image.camera.getOmniFrame(marker.visibleArc[1]);
				if (a0 != null && a1 != null) this.#omniArc = [a0, a1];
			}
		}

		const scales = !!marker.data?.scales || !!image.$settings.markersScale;
		const moved = () => {
			if (image.is360 && scales) {
				this.#matrix = image.camera.getMatrix(marker.x, marker.y, 1, 1, 0, 0, 0).join(',');
				this.style.setProperty('--mat', `matrix3d(${this.#matrix})`);
				this.classList.add('mat3d');
			} else {
				const xy = image.camera.getXYDirect(marker.x, marker.y, {
					radius: marker.radius, rotation: marker.rotation
				});
				[this.#x, this.#y, this.#scaleVal, this.#w] = xy;
				if (image.is360) this.#behindCam = this.#w > 0;
				else if (image.isOmni && omni) {
					if (this.#omniArc && marker.rotation != null) {
						const numFrames = omni.frames / (omni.layers?.length ?? 1);
						let delta = (image.swiper?.currentIndex ?? 0) - this.#omniIndex;
						if (delta > numFrames / 2) delta -= numFrames;
						if (delta < -numFrames / 2) delta += numFrames;
						this.#behindCam = delta <= this.#omniArc[0] || delta >= this.#omniArc[1];
					} else if (omni.distance) {
						this.#behindCam = this.#w < 0;
					}
				}
				this.style.setProperty('--x', `${this.#x}px`);
				this.style.setProperty('--y', `${this.#y}px`);
				if (scales) {
					this.style.setProperty('--scale', `${this.#scaleVal}`);
				}
				this.classList.remove('mat3d');
				this.classList.toggle('behind', this.#behindCam);
			}
		};

		const click = () => {
			if (marker.onclick) return marker.onclick(marker);
			if (markerSettings.noMarkerActions) return;
			if (marker.type == 'cluster') {
				if (marker.view && micrio.$current?.$info) {
					image.camera.flyToView(marker.view, { area: image.opts?.area, limitZoom: true });
				}
			} else {
				image.state.marker.set(marker);
			}
		};

		const focus = () => {
			if (markerSettings.noMarkerActions) return;
			(this.parentNode as HTMLElement)?.scrollTo(0, 0);
			clearTimeout(this.#fto);
			this.#fto = setTimeout(() => {
				const px = image.camera.getXY(marker.x, marker.y);
				if (!this.#opened && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image.is360 ? px[3] > 4 : false)))
					image.camera.flyToCoo([marker.x, marker.y], { speed: 2, limit: true }).catch(() => { });
			}, 150);
		};

		const activated = async () => {
			if (this.#opened) return;
			this.#opened = true;
			this.classList.add('opened');
			clearTimeout(this.#fto);
			if (markerSettings.noMarkerActions) return;
			events.dispatch('marker-open', marker);
			const $tour = get(micrio.state.tour);
			if ($tour && (!('steps' in $tour) || !$tour.steps?.some((s: string) => s.startsWith(marker.id)))) micrio.state.tour.set(undefined);
			await tick();
			if (marker.view && !data.noAnimate && !marker.videoTour) {
				const opts: any = { area: image.opts?.area };
				if (image.isOmni) opts.omniIndex = this.#omniIndex;
				image.camera.flyToView(marker.view, opts).then(openContent).catch(() => {
					image.openedView = undefined;
					image.state.marker.set(undefined);
				});
			} else {
				openContent();
			}
		};

		const openContent = async () => {
			if (cluster) return;
			if (image.state.$marker != marker) return image.state.marker.set(marker);
			if (markerSettings.noMarkerActions) return;

			const $tour = get(micrio.state.tour);
			events.dispatch('marker-opened', marker);
			if (marker.popupType != 'popup' || (!content?.title && !content?.body && !content?.bodySecondary && !content?.embedUrl && !marker.images?.length && !marker.videoTour)) {
				// no popup - handle popover or video tour
				if (marker.popupType == 'popover') {
					micrio.state.popover.set({ marker, image, markerTour: $tour && 'steps' in $tour ? $tour : undefined });
				} else if (marker.videoTour && !$tour) {
					micrio.state.tour.set(marker.videoTour);
					const unsub = micrio.state.tour.subscribe(t => {
						if (!t) { unsub(); image.state.marker.set(undefined); }
					});
				}
			} else {
				tick().then(() => micrio.state.popup.set(marker));
			}

			const linkId = data.micrioLink?.id;
			if (linkId) {
				tick().then(() => {
					image.camera.stop();
					micrio.open(linkId, { vector: getSpaceVector(micrio, linkId)?.vector });
				});
			}
		};

		const close = () => {
			this.classList.remove('opened');
			events.dispatch('marker-closed', marker);
			micrio.state.popover.set(undefined);
			micrio.state.popup.set(undefined);
		};

		this.addCleanup(image.state.marker.subscribe(m => {
			if (typeof m == 'string' && m == marker.id) image.state.marker.set(marker);
			else if (m == marker) activated();
			else if (!m && !data.alwaysOpen) {
				if (this.#opened) close();
				else this.classList.remove('opened');
				this.#opened = false;
			}
		}));

		if (!marker.noMarker) {
			this.addCleanup(image.state.view.subscribe(() => {
				moved();
			}));
		}

		if (!forceHidden) {
			tick().then(() => {
				const $popup = get(micrio.state.popup);
				const $tour = get(micrio.state.tour);
				if (this.#opened && !marker.noMarker && $popup && $popup != marker && !$tour) {
					image.state.marker.set(undefined);
				} else if (data.alwaysOpen) {
					openContent();
				}
			});
		}

		// Build DOM
		this.classList.toggle('cluster', cluster);
		this.classList.toggle('default', !!defaultClass);
		this.classList.toggle('has-icon', hasIcon);
		this.classList.toggle('has-custom-icon', !!customIcon);

		if (!marker.htmlElement && !marker.noMarker) {
			const btn = createElement('button', {
				props: {
					...(noToolTips || cluster ? {} : { title: content?.label || content?.title || '' }),
					id: marker.id
				},
				attrs: { 'data-scroll-through': '' },
				events: {
					click,
					focus,
					blur: () => clearTimeout(this.#fto),
					mouseenter: () => micrio.state.markerHoverId.set(marker.id),
					mouseleave: () => micrio.state.markerHoverId.set(undefined)
				},
				parent: this
			});

			if (customIcon) {
				createElement('img', {
					props: {
						src: typeof customIcon == 'string' ? customIcon : customIcon.src,
						alt: ''
					},
					parent: btn
				});
			} else if (icon) {
				createElement('micrio-icon', {
					attrs: { name: icon },
					parent: btn
				});
			}

			if (showLabel) {
				createElement('label', {
					textContent: content?.label || content?.title || '',
					attrs: {
						for: marker.id,
						'data-scroll-through': ''
					},
					parent: btn
				});
			}
		}

		// Initial position
		if (!marker.noMarker) moved();

		// Marker tags as classes
		if (marker.tags) marker.tags.forEach(c => this.classList.add(c));
	}

	setProps(props: Partial<MarkerProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		clearTimeout(this.#fto);
	}
}

customElements.define(MicrioMarker.tag, MicrioMarker);
