import { MicrioElement } from '$core/component';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import { i18n } from '$core/i18n/strings';

class MicrioZoomButtons extends MicrioElement {
	static tag = 'micrio-zoom-buttons';

	#btnIn!: MicrioElement;
	#btnOut!: MicrioElement;

	_onMount() {
		const micrio = this._getMicrio();
		if (!micrio) return;

		const resolveTarget = () => {
			const imgs = get(micrio._visible).filter(i => i.id);
			return imgs.length === 1 ? imgs[0] : micrio.$current;
		};

		this.#btnIn = createElement('micrio-button', {parent: this}) as MicrioElement;
		this.#btnIn._setProps({ type: 'zoomIn', onclick: () => resolveTarget()?.camera.zoomIn() });

		this.#btnOut = createElement('micrio-button', {parent: this}) as MicrioElement;
		this.#btnOut._setProps({ type: 'zoomOut', onclick: () => resolveTarget()?.camera.zoomOut()});

		const update = () => {
			const img = resolveTarget();
			const $i18n = get(i18n);

			this.#btnIn._setProps({ title: $i18n._zoomIn, disabled: img?.camera.isZoomedIn() ?? true });
			this.#btnOut._setProps({ title: $i18n._zoomOut, disabled: img?.camera.isZoomedOut() });
		};

		this._addCleanup(micrio.current.subscribe(() => update()));
		this._addCleanup(micrio._visible.subscribe(() => update()));

		const onZoom = () => update();
		micrio.addEventListener('zoom', onZoom);
		this._addCleanup(() => micrio.removeEventListener('zoom', onZoom));

		update();
	}

}

customElements.define(MicrioZoomButtons.tag, MicrioZoomButtons);
