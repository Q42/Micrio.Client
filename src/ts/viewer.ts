import Svelte from '../svelte/Main.svelte';
import { HTMLMicrioElement } from './element';
import { VERSION } from './version';

HTMLMicrioElement.Svelte = Svelte;
HTMLMicrioElement.VERSION = VERSION;
customElements.define('micr-io', HTMLMicrioElement);

console.log('%c\u25C8' + '%c Micrio' + ' %cv'+VERSION+' - https://micr.io/', 'color: #00d4ee', 'color: #c5ff5b', 'color: inherit');
