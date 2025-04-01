<script lang="ts">
	/**
	 * Article.svelte - Simple wrapper component for displaying rich text content.
	 *
	 * Primarily used within MarkerContent to render the `body` and `bodySecondary` HTML.
	 * It adds basic styling and ensures external links open in a new tab.
	 */

	/** Optional additional CSS class name for the article element. */
	export let cn:string|null=null;

	/**
	 * Event handler to force external links within the slotted content to open in a new tab.
	 * Applied on click, keydown, and pointerdown to cover various interaction methods.
	 * @param e The triggering event.
	 */
	function linkInNewWindow(e:PointerEvent|KeyboardEvent) {
		// Check if the event target is an anchor element and the href doesn't start with '#' (internal link)
		if(e.target && e.target instanceof HTMLAnchorElement && !e.target.getAttribute('href')?.startsWith('#'))
			e.target.target = '_blank'; // Set target to _blank
	}
</script>

<!--
	Main article container.
	- Applies the optional CSS class `cn`.
	- Stops propagation of click events to prevent unintended interactions (e.g., closing a popup).
	- Attaches the linkInNewWindow handler to ensure external links open correctly.
	- Ignores a11y warning because the click/keydown handlers are specifically for link behavior within the content.
-->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<article class={cn} on:click|stopPropagation on:keydown={linkInNewWindow} on:pointerdown={linkInNewWindow}><slot /></article>

<style>
	article {
		/* Basic text styling using CSS variables */
		text-align: var(--micrio-text-align);
		line-height: var(--micrio-line-height, 1.5em);
	}
	/* Remove top margin from the first child element within the article */
	article > :global(*:first-child) {
		margin-top: 0;
	}
	/* Remove bottom margin from the last child element within the article */
	article > :global(*:last-child) {
		margin-bottom: 0;
	}
	/* Style links within paragraphs */
	article :global(p a) {
		color: var(--micrio-color-hover, inherit); /* Use hover color or inherit */
		word-wrap: break-word; /* Prevent long links from breaking layout */
	}
</style>
