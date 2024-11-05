<script lang="ts">
	export let className:string = '';

</script>

<div class={className}><slot /></div>

<style>
	div {
		box-shadow: var(--micrio-button-shadow);
		border-radius: var(--micrio-border-radius);
		backdrop-filter: var(--micrio-background-filter);
		background: var(--micrio-button-background, var(--micrio-background, none));
	}
	div:empty {
		display: none;
	}
	div > :global(.micrio-button) {
		display: block;
		box-shadow: none;
		--micrio-background-filter: none;
		--micrio-button-background: none;
	}
	div :global(.micrio-button) {
		border-radius: 0;
	}
	div :global(.micrio-button:first-child) {
		border-radius: var(--micrio-border-radius) var(--micrio-border-radius) 0 0;
	}
	div :global(.micrio-button:last-child) {
		border-radius: 0 0 var(--micrio-border-radius) var(--micrio-border-radius);
	}
	@media (max-width: 500px) {
		div > :global(*) {
			height: calc(var(--micrio-button-size) - 4px);
		}
		div :global(.micrio-button:first-child) {
			padding-top: 0;
		}
		div :global(.micrio-button:last-child) {
			padding-bottom: 0;
		}
	}
</style>
