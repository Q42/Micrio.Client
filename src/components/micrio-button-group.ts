import { MicrioElement } from '$ts/component';

export class MicrioButtonGroup extends MicrioElement {
	static tag = 'micrio-button-group';
	static styles = `micrio-button-group{display:block;box-shadow:var(--micrio-button-shadow);border-radius:var(--micrio-border-radius);backdrop-filter:var(--micrio-background-filter);background:var(--micrio-button-background,var(--micrio-background,none))}
micrio-button-group:empty{display:none}
micrio-button-group>.micrio-button{display:block;box-shadow:none;--micrio-background-filter:none;--micrio-button-background:none}
micrio-button-group .micrio-button{border-radius:0}
micrio-button-group .micrio-button:first-child{border-radius:var(--micrio-border-radius) var(--micrio-border-radius) 0 0}
micrio-button-group .micrio-button:last-child{border-radius:0 0 var(--micrio-border-radius) var(--micrio-border-radius)}
@media(max-width:500px){micrio-button-group>*{height:calc(var(--micrio-button-size) - 4px)}
micrio-button-group .micrio-button:first-child{padding-top:0}
micrio-button-group .micrio-button:last-child{padding-bottom:0}
}`;

	onMount() {
		const _this = this as unknown as HTMLElement;
		_this.style.display = 'block';
	}
}

customElements.define(MicrioButtonGroup.tag, MicrioButtonGroup);
