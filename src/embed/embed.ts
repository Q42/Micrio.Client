import { createElement, type ElementOptions } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { HTMLMicrioElement } from '$core/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { once } from '$utils/store';
import { Browser } from '$utils/browser';
import { GLEmbedVideo } from '$media/embedvideo';

export interface EmbedProps {
	embed: Models.ImageData.Embed;
	image: MicrioImage;
	marker?: Models.ImageData.Marker;
}

export class MicrioEmbed extends MicrioElement<EmbedProps> {
	static tag = 'micrio-embed';
	static styles = `
micrio-embed{display:contents}
micrio-embed>.embed-container{position:absolute;display:block;top:0;left:0;transform:translate3d(calc(var(--x,0) - 50%),calc(var(--y,0) - 50%),0) scale3d(var(--s),var(--s),1);opacity:var(--opacity,1);direction:ltr;will-change:transform,opacity}
micrio-embed>.embed-container.embed3d{top:50%;left:50%}
micrio-embed>.embed-container.embed3d.behind{pointer-events:none;opacity:0!important}
micrio-embed>.embed-container.no-events{pointer-events:none}
micrio-embed>.embed-container.hide-when-paused{transition:opacity .25s}
micrio-embed>.embed-container.hide-when-paused:has(figure.paused){opacity:0}
micrio-embed>.embed-container.inactive{opacity:0;pointer-events:none}
micrio-embed>.embed-container>*{position:absolute;margin:0;transform:translate3d(-50%,-50%,0) scale3d(var(--scale,1),var(--scale,1),1);cursor:pointer}
micrio-embed>.embed-container>:global(*:not(button)){width:auto!important}
micrio-embed>.embed-container>img{max-width:none}
micrio-embed>.embed-container>button{--scale:1;--ratio:1;padding:0;margin:0;background:transparent;border:none;width:100px;aspect-ratio:var(--ratio)}
micrio-embed>.embed-container>button,micrio-embed>.embed-container>img{touch-action:none}
`;

	#props: EmbedProps = { embed: null!, image: null! };

	#micrio!: HTMLMicrioElement;
	#info!: Models.ImageInfo.ImageInfo;
	#glImage?: MicrioImage;
	#glVideo?: GLEmbedVideo;
	#container?: HTMLElement;
	#videoEl?: HTMLVideoElement;
	#figureEl?: HTMLElement;
	#moveRaf: number | undefined;
	#loopDelayTo: any;

	#is360 = false;
	#autoplay = true;
	#isSVG = false;
	#isSmall = false;
	#screenIsHDR = false;
	#embedImageAsHtml = false;
	#printGL = false;
	#noEvents = false;
	#href: string | undefined;
	#hrefBlankTarget = false;
	#isRawVideo = false;
	#hasHtml = false;
	#paused = false;
	#widthCapped = 0;
	#hideWhenPaused = false;

	#w = 0;
	#h = 0;
	#cX = 0;
	#cY = 0;
	#s = 1;
	#rotX = 0;
	#rotY = 0;
	#rotZ = 0;
	#scaleX = 1;
	#scaleY = 1;
	#x = 0;
	#y = 0;
	#scaleVal = 0;
	#matrix = '';
	#isBehind = false;
	#buttonStyle = '';

	onMount() {
		const { embed, image, marker } = this.#props;
		this.#micrio = this.getMicrio()!;
		if (!this.#micrio || !embed || !image) return;

		if (embed.src?.startsWith('/r2')) embed.src = 'http://localhost:6100' + embed.src;

		this.#info = image.$info!;
		if (!this.#info) return;

		if (!embed.uuid) embed.uuid = crypto.randomUUID();

		this.#is360 = image.is360;
		this.#autoplay = embed.video?.autoplay ?? true;

		const grid = image.grid;
		if (grid) {
			const focused = grid.focussed;
			const markersShown = grid.markersShown;
			const updateInactive = () => {
				const f = get(focused);
				const ms = markersShown ? get(markersShown) : undefined;
				const inactive = !!(grid && f && f != image && ms && ms.indexOf(image) < 0);
				this.#container?.classList.toggle('inactive', inactive);
			};
			this.watch(focused, updateInactive);
			if (markersShown) this.watch(markersShown, updateInactive);
		}

		this.#glImage = image.embeds.find(i => i.uuid == embed.uuid || i.$info?.title == embed.uuid) as MicrioImage | undefined;

		this.#screenIsHDR = window.matchMedia('(dynamic-range: high)').matches || Browser.OSX;

		this.#isSVG = embed.src?.toLowerCase().endsWith('.svg') ?? false;
		this.#isSmall = embed.width && embed.height ? embed.width * embed.height < 1048576 : false;

		const isIOS14 = /iPhone OS 14_/i.test(navigator.userAgent);
		const glAttr = 'data-embeds-inside-gl';
		const glAttrValue = this.#micrio.getAttribute(glAttr);
		this.#embedImageAsHtml = this.#isSVG || isIOS14 || (!this.#screenIsHDR && !this.#micrio.hasAttribute(glAttr) && !!embed.video) || glAttrValue == 'false';

		this.#printGL = !this.#embedImageAsHtml && !!(
			(embed.micrioId && (!this.#isSmall || !embed.src))
			|| (embed.video && !embed.video.controls && !embed.video.transparent)
		);

		this.#noEvents = !embed.clickAction && !embed.frameSrc && !marker;
		this.#href = embed.clickAction == 'href' ? embed.clickTarget : undefined;
		this.#hrefBlankTarget = !!(this.#href && embed.clickTargetBlank);

		this.#isRawVideo = this.#printGL && !!embed.video;
		this.#hasHtml = !this.#printGL || !!embed.clickAction;
		this.#hideWhenPaused = !!embed.hideWhenPaused;

		if (embed.video && !embed.video.controls) {
			embed.video.muted = true;
		}

		this.#readPlacement();

		if (this.#hasHtml) this.#buildDOM(embed, marker);

		if (this.#printGL) this.#printInsideGL();

		const camOwner = image.camera?.image;
		const moveSrc = camOwner && camOwner !== image ? camOwner : image;

		if (this.#hasHtml || !!embed.video?.pauseWhenSmallerThan || !!embed.video?.pauseWhenLargerThan) {
			this.watch(moveSrc.state.view, () => this.#moved());
			this.watch(moveSrc.viewport, () => this.#moved());
		}

		this.addEventListener('change', this.#onChange);
	}

	#readPlacement() {
		const { embed } = this.#props;
		const a = embed.area;
		this.#w = a[2];
		this.#h = a[3];
		this.#cX = a[0] + this.#w / 2;
		this.#cY = a[1] + this.#h / 2;
		this.#s = embed.scale || 1;
		this.#rotX = embed.rotX ?? 0;
		this.#rotY = embed.rotY ?? 0;
		this.#rotZ = embed.rotZ ?? 0;
		this.#scaleX = embed.scaleX ?? 1;
		this.#scaleY = embed.scaleY ?? 1;

		const isGLEmbeddedMicrio = this.#printGL && embed.micrioId && embed.width;
		const htmlButtonEmbedScale = isGLEmbeddedMicrio ? 10 : 1;

		let scale = this.#w * this.#info.width / (embed.width ?? 100) / (!this.#printGL ? this.#s : embed.width ? this.#w : 1) * (this.#is360 ? Math.PI / 2 : 1);

		const styles: string[] = [];

		if (isGLEmbeddedMicrio && embed.width) {
			scale = this.#w / (embed.width / this.#info.width) * htmlButtonEmbedScale * (this.#is360 ? Math.PI / 2 : 1);
			styles.push(`width:${embed.width / htmlButtonEmbedScale}px`);
		}

		styles.push(`--ratio:${this.#w / this.#h * this.#info.width / this.#info.height};--scale:${scale}`);

		if (this.#isSVG && embed.height) {
			styles.push(`height:${embed.height}px`);
		}

		this.#buttonStyle = styles.join(';');

		if (embed.video) {
			if (embed.video.width > embed.video.height)
				this.#widthCapped = Math.min(embed.video.width, this.#w * this.#info.width, 2048);
			else
				this.#widthCapped = Math.min(embed.video.height, this.#h * this.#info.height, 2048) / (embed.video.height / embed.video.width);
		}
	}

	#buildDOM(embed: Models.ImageData.Embed, marker?: Models.ImageData.Marker) {
		const tag = this.#href ? 'a' : 'div';

		const opts: ElementOptions = {
			className: 'embed-container',
			events: {
				click: () => this.#click(),
				keypress: () => this.#click()
			},
			parent: this
		};
		if (embed.id) opts.id = 'e-' + embed.id;
		if (this.#href) {
			opts.props = { href: this.#href };
			if (this.#hrefBlankTarget) opts.attrs = { target: '_blank' };
		} else {
			opts.props = { role: 'figure' };
		}

		this.#container = createElement(tag, opts);

		this.#container.classList.toggle('no-events', this.#noEvents);
		this.#container.classList.toggle('hide-when-paused', this.#hideWhenPaused && !this.#printGL && !!embed.video);

		if (embed.video && !this.#printGL) {
			this.#buildVideoContent(embed);
		} else if (embed.frameSrc) {
			this.#buildIframeContent(embed);
		} else if (!this.#printGL && embed.src) {
			const imgProps: Record<string, unknown> = { src: embed.src, alt: 'Embed' };
			if (this.#isSVG && embed.width) imgProps.width = embed.width;
			if (this.#isSVG && embed.height) imgProps.height = embed.height;
			createElement('img', {
				props: imgProps,
				style: this.#buttonStyle,
				attrs: { 'data-scroll-through': '' },
				parent: this.#container
			});
		} else {
			const btnProps: Record<string, unknown> = {};
			const $_lang = get(this.#micrio._lang);
			const title = embed.title || (marker?.i18n?.[$_lang]?.title);
			if (title) btnProps.title = title;
			createElement('button', {
				props: Object.keys(btnProps).length ? btnProps : undefined,
				style: this.#buttonStyle,
				attrs: { 'data-scroll-through': '', 'aria-label': 'embed-button' },
				parent: this.#container
			});
		}
	}

	#buildVideoContent(embed: Models.ImageData.Embed) {
		const video = embed.video!;
		const width = this.#widthCapped;
		const height = width / (video.width / video.height);
		const wCalc = this.#w * this.#info.width;
		const relScale = wCalc / width;

		this.#figureEl = createElement('figure');

		const vid = createElement('video', {
			props: {
				src: video.src!,
				width: Math.round(width),
				height: Math.round(height),
				controls: !!video.controls,
				loop: !!video.loop && (!video.loopAfter || video.loopAfter <= 0),
				muted: !!video.muted,
				playsInline: true,
				crossOrigin: 'anonymous',
				preload: 'metadata'
			}
		});

		if (relScale !== 1) {
			vid.style.transform = `scale(${relScale})`;
		}

		if (video.transparent && video.hasH265 && video.src?.endsWith('.webm')) {
			createElement('source', {
				props: {
					src: video.src.replace('.webm', '.mp4'),
					type: 'video/mp4;codecs=hvc1'
				},
				parent: vid
			});
		}

		this.#figureEl.appendChild(vid);
		this.#container!.appendChild(this.#figureEl);
		this.#videoEl = vid;

		if (embed.id && this.#props.image) {
			this.#props.image.setEmbedMediaElement(embed.id, vid);
		}

		if (video.loop && video.loopAfter != null && video.loopAfter > 0) {
			vid.loop = false;
			const onEnded = () => {
				this.#loopDelayTo = setTimeout(() => {
					if (!this.#paused) vid.play().catch(() => {});
				}, video.loopAfter! * 1000);
			};
			vid.addEventListener('ended', onEnded);
		}

		if (!this.#paused && this.#autoplay) {
			vid.play().catch(() => {});
		}
	}

	#buildIframeContent(embed: Models.ImageData.Embed) {
		createElement('iframe', {
			parent: this.#container,
			props: {
				src: embed.frameSrc!,
				width: String(Math.round(this.#w * this.#info.width)),
				height: String(Math.round(this.#h * this.#info.height))
			},
			attrs: {
				frameborder: '0',
				allow: 'autoplay; encrypted-media',
				allowfullscreen: ''
			}
		});
	}

	#printInsideGL() {
		const { embed, image } = this.#props;
		if (!image) return;

		const opacity = embed.hideWhenPaused ? 0.01 : (embed.opacity ?? 1);

		if (this.#glImage && (this.#glImage.ptr >= 0 || image.embeds.includes(this.#glImage))) {
			this.#glImage.camera.setArea(embed.area as Models.Camera.View);
			this.#glImage.camera.setRotation(this.#rotX, this.#rotY, this.#rotZ);
			if (this.#glImage.ptr >= 0) image.engine.fadeImage(this.#glImage.ptr, opacity);
		} else {
			this.#glImage = image.addEmbed({
				id: embed.video ? embed.id : embed.micrioId,
				title: embed.uuid,
				width: embed.width,
				height: embed.height,
				isPng: embed.isPng,
				isWebP: embed.isWebP,
				isDeepZoom: embed.isDeepZoom,
				path: this.#info.tileBasePath ?? this.#info.path,
				isSingle: !!embed.video,
				isVideo: !!embed.video,
				settings: {
					_360: { rotX: this.#rotX, rotY: this.#rotY, rotZ: this.#rotZ }
				},
			}, embed.area as Models.Camera.View, { opacity, asImage: false });
		}

		if (this.#isRawVideo) {
			once(this.#glImage!.visible, { targetValue: true }).then(() => {
				this.#glVideo = new GLEmbedVideo(image.engine, this.#glImage!, embed, this.#paused, () => this.#moved());
			});
		}

		image.engine.render();
	}

	#moved() {
		if (this.#moveRaf !== undefined) return;
		this.#moveRaf = requestAnimationFrame(() => {
			this.#moveRaf = undefined;
			this.#applyPosition();
		});
	}

	#applyPosition() {
		const { embed, image } = this.#props;
		if (!image?.engine.ready) return;

		const vp = get(image.viewport);
		const view = get(image.state.view);

		if (view && vp?.[2] > 0 && vp?.[3] > 0 && view[2] > 0 && view[3] > 0) {
			this.#x = vp[0] + (this.#cX - view[0]) / view[2] * vp[2];
			this.#y = vp[1] + (this.#cY - view[1]) / view[3] * vp[3];
			this.#scaleVal = vp[2] / (view[2] * this.#info.width);
		} else {
			const coo = image.camera.getXYDirect(this.#cX, this.#cY);
			[this.#x, this.#y, this.#scaleVal] = Array.from(coo) as [number, number, number];
		}

		if (this.#is360) {
			const mat = image.camera.getMatrix(this.#cX, this.#cY, this.#s, 1, this.#rotX, this.#rotY, this.#rotZ, undefined, this.#scaleX, this.#scaleY);
			this.#matrix = Array.from(mat).join(',');
		}

		if (this.#container) {
			const style = this.#is360
				? `transform:matrix3d(${this.#matrix});`
				: `--x:${this.#x}px;--y:${this.#y}px;--s:${this.#scaleVal};`;

			const opStyle = embed.opacity !== undefined && embed.opacity !== 1
				? `--opacity:${embed.opacity};`
				: '';

			this.#container.style.cssText = style + opStyle;
			this.#container.classList.toggle('embed3d', this.#is360);
			if (this.#is360) {
				this.#container.classList.toggle('behind', this.#isBehind);
			}
		}

		if ((embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan) && this.#w) {
			this.#paused = this.#shouldPause();
			if (this.#glVideo?._vid) {
				if (this.#paused) {
					if (!this.#glVideo._vid.paused) this.#glVideo._vid.pause();
				} else {
					if (this.#glVideo._vid.paused) {
						this.#glVideo.cancelTimeout();
						if (image?.$settings?.embedRestartWhenShown) this.#glVideo._vid.currentTime = 0;
						this.#glVideo._vid.play();
					}
				}
			}
			this.#syncVideoPause(image);
		}
	}

	#syncVideoPause(image: MicrioImage) {
		if (!this.#videoEl) return;
		if (this.#figureEl) this.#figureEl.classList.toggle('paused', this.#paused);
		if (this.#paused) {
			if (!this.#videoEl.paused) this.#videoEl.pause();
		} else {
			if (this.#videoEl.paused) {
				if (image?.$settings?.embedRestartWhenShown) this.#videoEl.currentTime = 0;
				this.#videoEl.play().catch(() => {});
			}
		}
	}

	#shouldPause(): boolean {
		const { embed } = this.#props;
		if (!embed.video?.pauseWhenSmallerThan && !embed.video?.pauseWhenLargerThan) return !this.#autoplay;
		const screenSize = this.#scaleVal
			? Math.max(
				(this.#w * this.#info.width) * this.#scaleVal / this.#micrio.canvas.viewport.width,
				(this.#h * this.#info.height) * this.#scaleVal / this.#micrio.canvas.viewport.height
			)
			: 0;
		return !!(
			(embed.video.pauseWhenSmallerThan && screenSize < embed.video.pauseWhenSmallerThan)
			|| (embed.video.pauseWhenLargerThan && screenSize > embed.video.pauseWhenLargerThan)
		);
	}

	#click() {
		const { embed, image, marker } = this.#props;
		const markerId = embed.clickAction == 'markerId' ? embed.clickTarget : marker?.id;
		if (!markerId || !image || this.#href) return;
		image.state.marker.set(markerId);
	}

	#onChange(e: Event) {
		if (e && 'detail' in e) {
			const emb = e.detail as Models.ImageData.Embed;
			const target = this.#props.embed as Record<string, any>;
			for (const x in emb) {
				target[x] = (emb as Record<string, any>)[x];
			}
		}
		this.#readPlacement();
		this.#moved();
	}

	setProps(props: Partial<EmbedProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		clearTimeout(this.#loopDelayTo);
		this.#glVideo?.unmount();

		const { embed, image } = this.#props;
		if (this.#glImage && this.#glImage.ptr >= 0 && image) {
			image.engine.fadeImage(this.#glImage.ptr, 0);
			image.engine.render();
		}

		if (embed.video && embed.id && image) {
			image.setEmbedMediaElement(embed.id);
		}

		this.removeEventListener('change', this.#onChange);
		if (this.#container) {
			this.#container.removeEventListener('click', this.#click);
			this.#container.removeEventListener('keypress', this.#click);
		}
	}
}

customElements.define(MicrioEmbed.tag, MicrioEmbed);
