<script lang="ts">
	/**
	 * Error.svelte - Displays an error message overlay.
	 *
	 * This simple component shows a centered message with an error icon
	 * when the `error` prop is set on the main Main.svelte component.
	 */

	import Icon from '../ui/Icon.svelte';

	/** The error message string to display. */
	export let message:string;
</script>

<!-- Main container for the error message -->
<div>
	<!-- Error icon -->
	<Icon name="error" />
	<!-- The error message text -->
	{message}
</div>

<style>
	div {
		/* Positioning: centered overlay */
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%,-50%);

		/* Appearance */
		background: rgba(0,0,0,.75); /* Semi-transparent black background */
		color: #fff; /* White text */
		border: 1px solid white;
		border-radius: 5px;
		padding: 10px;
		text-align: center;
		white-space: pre-wrap; /* Allow wrapping within the message */
		user-select: text; /* Allow selecting the error text */
		line-height: 24px; /* Align text with icon */
		z-index: 10; /* Ensure it's above other UI */
	}

	/* Styling for the icon within the div */
	div :global(svg) { /* Target the SVG element rendered by the Icon component */
		vertical-align: middle;
		height: 24px;
		width: 24px;
		fill: var(--micrio-color); /* Use theme color for icon */
		margin-right: 10px; /* Space between icon and text */
	}

	/* Responsive adjustments for smaller screens */
	@media screen and (max-width: 520px) {
		div {
			box-sizing: border-box;
			width: 90%; /* Use most of the screen width */
		}
	}

</style>
