/**
 * Main entry point for the Micrio library.
 * Imports the root Svelte component and the main custom element class,
 * links them, defines the custom element, and logs the version to the console.
 */

import Svelte from '../svelte/Main.svelte'; // Import the root Svelte UI component
import { HTMLMicrioElement } from './element'; // Import the main custom element class
import { VERSION } from './version'; // Import the library version string

// Assign the Svelte component constructor to the custom element class
// This allows the custom element to instantiate the Svelte UI internally.
HTMLMicrioElement.Svelte = Svelte;
// Assign the version string to the custom element class for static access.
HTMLMicrioElement.VERSION = VERSION;

// Define the custom HTML element <micr-io> using the prepared class.
// This makes the element available for use in HTML.
customElements.define('micr-io', HTMLMicrioElement);

// Log a styled message to the console indicating the library version and website.
console.log('%c\u25C8' + '%c Micrio' + ' %cv'+VERSION+' - https://micr.io/', 'color: #00d4ee', 'color: #c5ff5b', 'color: inherit');
