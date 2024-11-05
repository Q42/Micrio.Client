<script lang="ts">
	import Icon from '../ui/Icon.svelte';

	export let message:string;
</script>

<div><Icon name="error" />{message}</div>

<style>
	div {
		position: absolute;
		background: rgba(0,0,0,.75) none 10px center no-repeat;
		text-align: center;
		border-radius: 5px;
		top: 50%;
		left: 50%;
		transform: translate(-50%,-50%);
		color: #fff;
		border: 1px solid white;
		padding: 10px;
		white-space: pre-wrap;
		user-select: text;
		line-height: 24px;
	}

	div :global(*) {
		vertical-align: middle;
		height: 24px;
		width: 24px;
		fill: var(--micrio-color);
		margin-right: 10px;
	}

	@media screen and (max-width: 520px) {
		div {
			box-sizing: border-box;
			width: 90%;
		}
	}

</style>

