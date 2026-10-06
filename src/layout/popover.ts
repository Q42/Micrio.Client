import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { createElement } from '$utils/dom'
import { i18n } from '$core/i18n/strings'
import '$ui/button'
import './article'
import '$media/media'
import '$markers/marker-content'
import '$gallery/swipe-gallery'

/** Props for the popover/modal element @internal */
export interface PopoverProps {
	popover: Models.State.PopoverType
}
import './popover.css'

/** Custom element rendering a modal popover for pages, marker content, and galleries */
class MicrioPopover extends MicrioElement<PopoverProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-popover'

	#props: Partial<PopoverProps> = {}
	#dialog!: HTMLDialogElement

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio()
		if (!micrio) {
			return
		}

		this.#dialog = createElement('dialog', {
			events: {
				close: () => {
					const p = this.#props.popover
					if (p && 'marker' in p && p.marker && p.image?.state?.marker) {
						p.image.state.marker.set(undefined)
					}
					micrio.state.popover.set(undefined)
				},
				// No `click` handler: like in 6, clicking outside the popover does not
				// close it — only its buttons, ESC or clearing the state do.
			},
			parent: this,
		})

		// Button titles and content are translated, so re-render on a UI language change
		this._watchLater(micrio._lang, () => {
			this.#render()
		})

		this.#render()
	}

	/** @internal */
	_setProps(props: Partial<PopoverProps>) {
		if (props.popover !== undefined) {
			this.#props.popover = props.popover
		}
		if (this.isConnected) {
			this.#render()
		}
	}

	#render() {
		const p = this.#props.popover
		const micrio = this._getMicrio()
		if (!micrio || !p) {
			return
		}

		const $_lang = get(micrio._lang)
		const $i18n = get(i18n)

		const pageId = 'contentPage' in p ? p.contentPage?.id : ''
		const markerId = 'marker' in p ? p.marker?.id : ''
		// The gallery is part of the content too: without it, swapping one gallery for
		// another (a marker's images) kept the first one on screen
		const gallery = 'gallery' in p ? p.gallery : undefined
		const galleryKey = gallery ? `${gallery.length}:${p.galleryStart ?? ''}:${gallery[0]?.src ?? ''}` : ''
		const key = `${p?.constructor?.name ?? typeof p}::${pageId}::${markerId}::${galleryKey}::${$_lang}`
		if (!this._checkRenderKey(key)) {
			return
		}

		this.#dialog.replaceChildren()
		this.#dialog.classList.remove('article', 'page', 'has-media', 'gallery')

		const popupMarker = 'marker' in p ? p.marker : undefined
		const markerTour = 'markerTour' in p ? p.markerTour : undefined
		const page = 'contentPage' in p ? p.contentPage : undefined
		const stepsTour = markerTour && 'steps' in markerTour ? markerTour : undefined
		const isPartOfTour = Boolean(
			popupMarker && stepsTour && stepsTour.steps?.findIndex((s: string) => s.startsWith(popupMarker.id)) >= 0,
		)
		const isLastStep = isPartOfTour && stepsTour ? stepsTour.currentStep === stepsTour.steps.length - 1 : true
		/**
		 * A content page carrying its own `close` button ("Free exploration") does
		 * the closing itself, so the popover's close button is hidden (6 parity).
		 */
		const noCloseButton = Boolean(page?.buttons?.find((b) => b.type === 'close'))

		const advanceOrClose = (e?: Event) => {
			if (isPartOfTour && markerTour && 'steps' in markerTour) {
				const mt = markerTour
				if (e instanceof Event && isLastStep) {
					micrio.state.tour.set(undefined)
				} else {
					mt.next?.()
				}
			}
			if (this.#dialog?.open) {
				this.#dialog.close()
			}
		}

		/**
		 * Runs a content page's custom action button: closes the popover first,
		 * then performs the action (marker / marker tour / video tour). `link`
		 * buttons navigate through their own <a href>.
		 */
		const clickPageButton = (button: Models.ImageData.MenuPageButton) => {
			if (this.#dialog?.open) {
				this.#dialog.close()
			}
			if (button.type === 'close') {
				return
			}
			// Give the popover time to close before switching content, like in 6
			setTimeout(() => {
				const data = micrio.$current?.$data
				switch (button.type) {
					case 'marker': {
						micrio.$current?.state.marker.set(button.action)
						break
					}
					case 'mtour': {
						micrio.state.tour.set(data?.markerTours?.find((t) => t.id === button.action))
						break
					}
					case 'vtour': {
						micrio.state.tour.set(data?.tours?.find((t) => t.id === button.action))
						break
					}
				}
			}, 200)
		}

		// 6 parity: no aside at all when the page closes itself and no tour nav is needed
		if (!noCloseButton || isPartOfTour) {
			createElement('aside', {
				parent: this.#dialog,
				children: [
					createElement('micrio-button', {
						setProps: {
							type: !isPartOfTour || isLastStep ? 'close' : 'next',
							title: !isPartOfTour || isLastStep ? $i18n._closeMarker : $i18n._tourStepNext,
							onclick: advanceOrClose,
						},
					}),
				],
			})
		}

		if (page) {
			const cd = page.i18n?.[$_lang]
			this.#dialog.classList.add('page')

			const isVideoPage =
				cd?.embed !== undefined && (!cd.content || cd.content.length < 250) && !page.image && !page.buttons?.length
			const hasMedia = Boolean(cd?.embed) || Boolean(page.image)

			if (hasMedia) {
				this.#dialog.classList.add('has-media')
			}

			if (isVideoPage) {
				if (cd.embed !== undefined) {
					createElement('micrio-media', {
						setProps: { src: cd.embed, figcaption: cd.content, controls: true, autoplay: true },
						parent: this.#dialog,
					})
				}
			} else {
				this.#dialog.classList.add('article')
				const articleChildren: (Node | string | number | false | null | undefined)[] = []
				if (cd?.title) {
					articleChildren.push(createElement('h2', { textContent: cd.title }))
				}
				if (cd?.embed) {
					articleChildren.push(createElement('micrio-media', { setProps: { src: cd.embed, controls: true } }))
				}
				// Page image (dropped in the 7 rewrite)
				const pageImage = page.image as string | Models.Assets.Image | undefined
				const pageImageSrc = typeof pageImage === 'string' ? pageImage : pageImage?.src
				if (pageImageSrc) {
					articleChildren.push(createElement('img', { props: { src: pageImageSrc, alt: '' } }))
				}
				if (cd?.content) {
					articleChildren.push(createElement('div', { innerHTML: cd.content }))
				}
				createElement('article', { children: articleChildren, parent: this.#dialog })
			}

			// Page action buttons ("Start tour", "Free exploration", custom links;
			// dropped in the 7 rewrite — they were only read for the isVideoPage check)
			if (page.buttons?.length) {
				const menu = createElement('menu', {
					className: 'right',
					parent: this.#dialog,
				})
				for (const button of page.buttons) {
					createElement('micrio-button', {
						children: [button.i18nTitle?.[$_lang] ?? ''],
						setProps: {
							href: button.type === 'link' ? button.action : undefined,
							blankTarget: button.blankTarget,
							onclick: () => {
								clickPageButton(button)
							},
						},
						parent: menu,
					})
				}
			}
		}

		if ('gallery' in p && p.gallery?.length) {
			this.#dialog.classList.add('gallery')
			createElement('micrio-swipe-gallery', {
				setProps: { gallery: p.gallery, galleryStart: p.galleryStart, lang: $_lang },
				parent: this.#dialog,
			})
		}

		if ('marker' in p && p.marker) {
			const { marker } = p
			const content = marker.i18n?.[$_lang]
			const hasImages = Boolean(marker.images?.length)
			const hasPopoverContent =
				Boolean(content && content.body) || (hasImages && Boolean(p.contentPage?.i18n?.[$_lang]?.embed))

			if (content?.embedUrl) {
				createElement('micrio-media', {
					setProps: {
						src: content.embedUrl,
						uuid: marker.id,
						figcaption: content.embedDescription,
						controls: true,
						autoplay: marker.embedAutoPlay,
					},
					parent: this.#dialog,
				})
			} else if (hasImages) {
				createElement('micrio-swipe-gallery', {
					setProps: { gallery: marker.images, lang: $_lang },
					parent: this.#dialog,
				})
			}

			if (hasPopoverContent) {
				createElement('micrio-marker-content', {
					setProps: {
						marker,
						noEmbed: true,
						noGallery: true,
						noImages: !content || !content.embedUrl,
						onclose: advanceOrClose,
					},
					parent: this.#dialog,
				})
			}
		}

		if (!this.#dialog.open) {
			this.#dialog.showModal()
		}
	}

	/** @internal */
	_onDestroy() {
		if (this.#dialog?.open) {
			this.#dialog.close()
		}
	}
}

customElements.define(MicrioPopover.tag, MicrioPopover)
