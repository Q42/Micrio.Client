import { MicrioElement } from '$core/component';
import { parseTime } from '$utils/time';

export interface ProgressBarProps {
	currentTime?: number;
	duration: number;
	ended?: boolean;
}

export class MicrioProgressBar extends MicrioElement<ProgressBarProps> {
	static tag = 'micrio-progress-bar';
	static styles = `micrio-progress-bar{display:flex;width:auto;color:var(--micrio-color);background:var(--micrio-background);line-height:8px;flex:1;align-items:center;cursor:default}
micrio-progress-bar .bars{flex:1;display:flex;height:var(--micrio-progress-bar-height);background:var(--micrio-progress-bar-background);position:relative}
micrio-progress-bar .bars>*{height:100%;width:100%;display:block;box-sizing:border-box;position:relative;cursor:pointer;overflow:hidden}
micrio-progress-bar .bars>*::before{display:block;position:absolute;content:' ';background:var(--micrio-color);height:100%;pointer-events:none;width:var(--progress,0%);will-change:width}
micrio-progress-bar .bars::after{content:'';position:absolute;display:block;width:16px;height:16px;left:var(--progress);top:50%;transform:translate3d(-50%,-50%,0);background-color:var(--micrio-color);pointer-events:none;border-radius:8px}
micrio-progress-bar .time{display:block;font-size:90%;min-width:50px;text-align:center;padding:0 10px;font-variant-numeric:tabular-nums}`;

	#props: ProgressBarProps = { duration: 0 };

	onMount() {
		this.#render();
	}

	setProps(props: Partial<ProgressBarProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	#render() {
		const p = this.#props;
		const currentTime = p.currentTime ?? 0;
		const duration = p.duration || 1;
		const percent = Math.round((currentTime / duration) * 10000) / 100;
		const timeText = parseTime(p.ended || !currentTime || currentTime <= 0 ? duration : currentTime - duration);

		const existing = this.querySelector(':scope > .container');
		if (existing) {
			(existing as HTMLElement).style.setProperty('--progress', `${percent}%`);
			(existing as HTMLElement).style.setProperty('--time', `'${timeText}'`);
			const timeEl = existing.querySelector('.time');
			if (timeEl) timeEl.textContent = timeText;
			return;
		}

		const container = document.createElement('div');
		container.className = 'container';
		container.style.setProperty('--progress', `${percent}%`);
		container.style.setProperty('--time', `'${timeText}'`);
		container.addEventListener('click', e => e.stopPropagation());
		container.addEventListener('keydown', e => e.stopPropagation());

		const bars = document.createElement('div');
		bars.className = 'bars';
		container.appendChild(bars);

		const time = document.createElement('div');
		time.className = 'time';
		time.textContent = timeText;
		container.appendChild(time);

		this.appendChild(container);
	}
}

customElements.define(MicrioProgressBar.tag, MicrioProgressBar);
