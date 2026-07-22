import { MicrioElement } from '$core/component';
import styles from './button-group.css?inline';

class MicrioButtonGroup extends MicrioElement {
	static tag = 'micrio-button-group';
	static styles = styles;
}

customElements.define(MicrioButtonGroup.tag, MicrioButtonGroup);
