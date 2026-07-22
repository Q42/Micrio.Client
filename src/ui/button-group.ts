import { MicrioElement } from '$core/component';

class MicrioButtonGroup extends MicrioElement {
	static tag = 'micrio-button-group';
	static styles = `micrio-button-group{display:block;box-shadow:var(--micrio-button-shadow);border-radius:var(--micrio-border-radius)}
micrio-button-group:empty{display:none}
micrio-button-group .micrio-button{border-radius:0;box-shadow:none;}
micrio-button-group>micrio-button:first-child>.micrio-button,micrio-button-group>micrio-zoom-buttons:first-child>micrio-button:first-child>.micrio-button{border-radius:var(--micrio-border-radius) var(--micrio-border-radius) 0 0}
micrio-button-group>micrio-button:last-child>.micrio-button,micrio-button-group>micrio-fullscreen:last-child>micrio-button:last-child>.micrio-button{border-radius:0 0 var(--micrio-border-radius) var(--micrio-border-radius)}
@media(max-width:500px){micrio-button-group .micrio-button{height:calc(var(--micrio-button-size) - 4px)}
}`;
}

customElements.define(MicrioButtonGroup.tag, MicrioButtonGroup);
