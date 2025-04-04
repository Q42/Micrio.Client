<script lang="ts">
	/**
	 * Button.svelte - A reusable button component for the Micrio UI.
	 *
	 * Renders either a `<button>` or an `<a>` tag based on the `href` prop.
	 * Displays an icon (either standard Font Awesome via `type` or custom image via `icon`)
	 * and/or slotted content. Handles disabled and active states.
	 */

	import type { IconName } from './Icon.svelte'; // Type for standard icon names
	import type { Models } from '../../types/models';

	import Icon from './Icon.svelte'; // Icon rendering component

	// --- Props ---
	interface Props {
		/** Optional standard icon name to display. */
		type?: IconName|undefined;
		/** Optional custom icon image data to display. */
		icon?: Models.Assets.Image|undefined;
		/** Text for the title attribute (tooltip) and aria-label. */
		title?: string|null;
		/** If true, disable the button/link. */
		disabled?: boolean;
		/** If true, apply the 'active' CSS class. */
		active?: boolean;
		/** Additional CSS class names to apply. */
		className?: string;
		/** If provided, renders an `<a>` tag with this URL instead of a `<button>`. */
		href?: string|undefined;
		/** If `href` is provided, sets `target="_blank"` on the `<a>` tag. */
		blankTarget?: boolean;
		/** If true, adds the 'no-click' class (disables pointer events via CSS). */
		noClick?: boolean;
		children?: import('svelte').Snippet;
		onclick?: Function;
		onfocus?: Function;
		onpointerdown?: Function;
	}

	let {
		type = undefined,
		icon = undefined,
		title = null,
		disabled = false,
		active = false,
		className = '',
		href = undefined,
		blankTarget = false,
		noClick = false,
		children,
		onclick,
		onfocus,
		onpointerdown
	}: Props = $props();

</script>

<!--
	Dynamically render either an <a> or <button> element.
	- `this={href ? 'a' : 'button'}`: Selects the element type.
	- `href`, `target`: Applied only if it's an anchor.
	- `disabled`: Applied only if it's a button.
	- `title`, `aria-label`: Set for accessibility.
	- `role`, `tabindex`: Set appropriately for button/link semantics.
	- `class`: Combines base class, type class, custom class, and state classes.
	- Event forwarding: `onclick`, `onfocus`, `onpointerdown` allow parent components to listen.
-->
<svelte:element
	this={href ? 'a' : 'button'}
	{href}
	target={blankTarget ? '_blank' : undefined}
	disabled={disabled ? true : undefined}
	{title}
	aria-label={title}
	role={href ? undefined : 'button'}
	tabindex={href ? undefined : 0}
	class="micrio-button {type??''} {className}"
	class:active
	class:no-click={noClick}
	onclick={(e:Event) => onclick?.(e)}
	onfocus={(e:Event) => onfocus?.(e)}
	onpointerdown={(e:Event) => onpointerdown?.(e)}
>{#if type}<!-- Render standard icon if `type` is provided -->
<Icon name={type} />{:else if icon}<!-- Render custom icon if `icon` data is provided -->
<img src={icon.src} alt="Icon" />{/if}<!-- Render any slotted content (e.g., text) -->{@render children?.()}
</svelte:element>

<style>
.micrio-button {
	/* Basic styling */
	margin: 0;
	padding: 0 8px; /* Horizontal padding for text content */
	cursor: pointer;
	box-sizing: border-box;
	display: inline-block; /* Allow inline placement */
	vertical-align: bottom; /* Align with other inline elements */
	transition: opacity .25s ease;
	font: inherit; /* Use parent font */
	font-size: 90%; /* Slightly smaller text */
	position: relative; /* For potential absolute children */
	touch-action: none; /* Prevent default touch actions like scrolling */

	/* Theming using CSS variables */
	color: var(--micrio-color);
	background: var(--micrio-button-background, var(--micrio-background, none)) var(--background, none) center center no-repeat; /* Background color/image */
	background-size: 24px; /* Default size for background icons */
	min-width: var(--micrio-button-size); /* Ensure minimum size */
	height: var(--micrio-button-size);
	line-height: var(--micrio-button-size); /* Center text vertically */
	border: none; /* No default border */
	border-radius: var(--micrio-border-radius);
	box-shadow: var(--micrio-button-shadow);
	backdrop-filter: var(--micrio-background-filter);
	text-decoration: none; /* Remove underline for links */
}
.micrio-button:hover {
	outline: none; /* Remove default focus outline */
}
/* Style for transparent buttons */
.micrio-button.transparent, .micrio-button.transparent:hover {
	background-color: transparent;
	backdrop-filter: none;
}
/* Transition for children (e.g., icon opacity) */
.micrio-button > :global(*) {
	transition: opacity .25s ease;
}
/* Disabled state */
.micrio-button:disabled {
	pointer-events: none; /* Disable interaction */
	cursor: default; /* Use default cursor */
}
.micrio-button:disabled > :global(*) {
	opacity: .4; /* Dim content */
}
/* Class to manually disable pointer events */
.micrio-button.no-click {
	pointer-events: none;
}
/* Custom icon image styling */
img {
	display: block;
	margin: 0 auto; /* Center image */
	pointer-events: none; /* Prevent image dragging */
	max-width: 100%; /* Ensure image fits */
	max-height: 100%;
}
/* Styling for slotted icons (Icon component or custom img) */
.micrio-button > :global(*) {
	height: var(--micrio-icon-size) !important; /* Use icon size variable */
	width: var(--micrio-icon-size);
	font-size: var(--micrio-icon-size); /* For Font Awesome icons */
	fill: var(--micrio-color); /* SVG fill color */
	display: block;
	margin: 0 auto; /* Center icon */
}
/* Active state styling */
.micrio-button.active {
	color: var(--micrio-color-hover);
}
.micrio-button.active :global(svg) {
	fill: var(--micrio-color-hover);
}

/* Hover styles (only apply if hover is supported) */
@media (hover: hover) {
	.micrio-button:hover {
		background-color: var(--micrio-button-background-hover, var(--micrio-button-background, var(--micrio-background)));
		color: var(--micrio-color-hover);
	}
	.micrio-button:hover :global(svg) {
		fill: var(--micrio-color-hover);
		stroke: var(--micrio-color-hover); /* Apply to stroke as well */
	}
	/* Focus outline */
	.micrio-button:focus {
		outline: 1px solid var(--micrio-color-hover);
	}
}
</style>
