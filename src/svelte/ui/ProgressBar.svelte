<script lang="ts">
	import { parseTime } from '../../ts/utils';

	export let currentTime:number = 0;
	export let duration:number;
	export let ended:boolean = false;

</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="container" on:click|stopPropagation on:keydown|stopPropagation style={`--progress: ${Math.round(((currentTime||0) / duration) * 10000) / 100}%;--time: '${parseTime(currentTime||0)}';`}>
	<div class="bars"><slot /></div><div class="time">{parseTime(ended || currentTime <= 0 ? duration : (currentTime||0) - duration)}</div>
</div>

<style>
	div.container {
		display: flex;
		width: auto;
		color: var(--micrio-color);
		background: var(--micrio-background);
		line-height: 8px;
		flex: 1;
		align-items: center;
		cursor: default;
	}
	div.bars {
		flex: 1;
		display: flex;
		height: var(--micrio-progress-bar-height);
		background: var(--micrio-progress-bar-background);
		position: relative;
	}
	div.bars > :global(*) {
		height: 100%;
		width: 100%;
		display: block;
		box-sizing: border-box;
		position: relative;
		cursor: pointer;
		overflow: hidden;
		cursor: pointer;
	}
	div.bars > :global(*::before) {
		display: block;
		position: absolute;
		content: ' ';
		background: var(--micrio-color);
		height: 100%;
		pointer-events: none;
		width: var(--perc, 0);
		will-change: width;
	}
	div.bars::after {
		content: '';
		position: absolute;
		display: block;
		width: 16px;
		height: 16px;
		left: var(--progress);
		top: 50%;
		transform: translate3d(-50%,-50%,0);
		background-color: var(--micrio-color);
		pointer-events: none;
		border-radius: 8px;
	}
	div.time {
		display: block;
		font-size: 90%;
		min-width: 50px;
		text-align: center;
		padding: 0 10px;
	}
</style>
