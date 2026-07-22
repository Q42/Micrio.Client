import { MicrioElement } from '$core/component';
import './button-group.css';

class MicrioButtonGroup extends MicrioElement {
	static tag = 'micrio-button-group';
}

customElements.define(MicrioButtonGroup.tag, MicrioButtonGroup);
