import { createElement } from '$utils/dom'
import { MicrioElement } from '$core/component'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'

import './embed'

/** Properties for the image embeds container component. @internal */
export interface ImageEmbedsProps {
	/** The parent MicrioImage whose embeds will be rendered. */
	image: MicrioImage
}
import './image-embeds.css'

/** Custom element that renders all embeds for a Micrio image by watching the image data for embed definitions. */
class MicrioImageEmbeds extends MicrioElement<ImageEmbedsProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-image-embeds'

	#props: Partial<ImageEmbedsProps> = {}
	#embedObjects = new Map<string, Models.ImageData.Embed>()

	/** @internal */
	_onMount() {
		const { image } = this.#props
		if (!image) {
			return
		}

		const micrio = this._getMicrio()
		if (micrio) {
			// The overlay fades out while the viewer switches images and back in when the
			// new image is up, so its embeds do not jump between repainted positions.
			this._watch(micrio._switching, (s) => {
				this.classList.toggle('inactive', s)
			})
		}

		this._watch(image.data, (d) => {
			const embeds = d?.embeds ?? []
			const expected = new Set<string>()
			const keys = embeds.map((embed, idx) => embed.uuid || `idx:${idx}`)
			for (const k of keys) {
				expected.add(k)
			}

			// Remove embeds that were deleted
			for (const el of this.querySelectorAll<HTMLElement>(':scope > micrio-embed')) {
				const key = el.dataset.embedKey
				if (!key || !expected.has(key)) {
					el.remove()
					if (key) {
						this.#embedObjects.delete(key)
					}
				}
			}

			// Mount only new or changed embed references (preserves live running <video> embeds!)
			for (let i = 0; i < embeds.length; i++) {
				const embed = embeds[i]
				const key = keys[i]
				let el = this.querySelector<HTMLElement>(`:scope > micrio-embed[data-embed-key="${CSS.escape(key)}"]`)
				if (el && this.#embedObjects.get(key) !== embed) {
					el.remove()
					this.#embedObjects.delete(key)
					el = null
				}
				if (!el) {
					const attrs: Record<string, string> = { 'data-embed-key': key }
					if (embed.uuid) {
						attrs['data-uuid'] = embed.uuid
					}
					createElement('micrio-embed', {
						attrs,
						parent: this,
						setProps: { embed, image },
					})
					this.#embedObjects.set(key, embed)
				}
			}

			// A rebuild that drops an embed (or empties the list) leaves its WebGL sub-image
			// unclaimed; the children that were re-created above have re-adopted theirs.
			image._releaseOrphans()
		})
	}

	/** @internal */
	_setProps(props: Partial<ImageEmbedsProps>) {
		if (props.image !== undefined) {
			this.#props.image = props.image
		}
	}

	/** @internal */
	_onDestroy() {
		this.#embedObjects.clear()
	}
}

customElements.define(MicrioImageEmbeds.tag, MicrioImageEmbeds)
