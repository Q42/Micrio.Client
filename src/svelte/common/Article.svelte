<script lang="ts">
	export let cn:string|null=null;

	function linkInNewWindow(e:PointerEvent|KeyboardEvent) {
		if(e.target && e.target instanceof HTMLAnchorElement && !e.target.getAttribute('href')?.startsWith('#'))
			e.target.target = '_blank';
	}
</script>

<article class={cn} on:click|stopPropagation on:keydown={linkInNewWindow} on:pointerdown={linkInNewWindow}><slot /></article>

<style>
	article {
		text-align: var(--micrio-text-align);
		line-height: var(--micrio-line-height, 1.5em);
	}
	article > :global(*:first-child) {
		margin-top: 0;
	}
	article > :global(*:last-child) {
		margin-bottom: 0;
	}
	article :global(p a) {
		color: var(--micrio-color-hover, inherit);
		word-wrap: break-word;
	}
</style>
