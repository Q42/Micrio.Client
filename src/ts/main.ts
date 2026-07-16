/**
 * Main entry point for the Micrio library.
 * Imports the root micrio-main custom element and the main custom element class,
 * defines the custom element, and logs the version to the console.
 */

import '../components/micrio-main'; // Import and register the root UI custom element
import { HTMLMicrioElement } from '$core/element'; // Import the main custom element class
import { VERSION } from '$core/version'; // Import the library version string

// Assign the version string to the custom element class for static access.
HTMLMicrioElement.VERSION = VERSION;

// Define the custom HTML element <micr-io> using the prepared class.
// This makes the element available for use in HTML.
customElements.define('micr-io', HTMLMicrioElement);

// Log a styled message to the console indicating the library version and website.
console.info('%c\u25C8' + '%c Micrio' + ' %cv'+VERSION+' - https://micr.io/', 'color: #00d4ee', 'color: #c5ff5b', 'color: inherit');
