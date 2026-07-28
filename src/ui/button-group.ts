import { MicrioElement } from '$core/component';
import './button-group.css';

/** Web component that groups buttons together. */
class MicrioButtonGroup extends MicrioElement {
	/** The custom element tag name. @internal */
	static tag = 'micrio-button-group';
}

customElements.define(MicrioButtonGroup.tag, MicrioButtonGroup);
