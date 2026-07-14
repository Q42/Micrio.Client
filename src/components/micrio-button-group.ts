import { MicrioElement } from '$ts/component';

export class MicrioButtonGroup extends MicrioElement {
	static tag = 'micrio-button-group';
	static styles = `micrio-button-group{display:block;overflow:hidden;box-shadow:var(--micrio-button-shadow);border-radius:var(--micrio-border-radius);backdrop-filter:var(--micrio-background-filter);background:var(--micrio-button-background,var(--micrio-background,none))}
micrio-button-group:empty{display:none}
micrio-button-group .micrio-button{border-radius:0}
@media(max-width:500px){micrio-button-group .micrio-button{height:calc(var(--micrio-button-size) - 4px)}
}`;
}

customElements.define(MicrioButtonGroup.tag, MicrioButtonGroup);
