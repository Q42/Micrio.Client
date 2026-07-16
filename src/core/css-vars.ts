export const cssVars = `
html {
	--micrio-color: #fff;
	--micrio-color-hover: #45A4E4;
	--micrio-border-radius: 4px;
	--micrio-background: rgba(41,41,41,0.75);
	--micrio-background-filter: blur(8px);
	--micrio-popover-background: rgba(41,41,41,0.75);
	--micrio-scrubber-background: rgba(255,255,255,.25);

	--micrio-icon-size: 18px;
	--micrio-text-align: left;
	--micrio-line-height: 1.5em;

	--micrio-border-margin: 16px;

	--micrio-button-size: 48px;
	--micrio-button-shadow: 0 4px 8px rgba(0,0,0,.33);

	--micrio-marker-size: 16px;
	--micrio-marker-text-color: #fff;
	--micrio-marker-text-shadow: 0px 2px 4px rgba(0,0,0,0.6);
	--micrio-marker-highlight: #00d4ee;
	--micrio-marker-color: #fff;
	--micrio-marker-border-radius: 100%;
	--micrio-marker-border-color: rgba(255,255,255,.2);
	--micrio-marker-border-size: 8px;
	--micrio-marker-icon: none;
	--micrio-marker-transition: background-color 0.25s ease, opacity 0.15s ease, border-width .15s ease, width .15s ease, height .15s ease;

	--micrio-popup-shadow: 0 8px 16px rgba(0,0,0,.33);
	--micrio-popup-padding: 16px;

	--micrio-progress-bar-background: rgba(255,255,255,.25);
	--micrio-progress-bar-height: 4px;

	--micrio-waypoint-size: 120px;
}
micr-io[data-light-mode] {
	--micrio-color: #000;
	--micrio-color-hover: #196DA6;
	--micrio-background: rgba(255,255,255,0.66);
	--micrio-progress-bar-background: rgba(0,0,0,.25);
	--micrio-popover-background: rgba(211,211,211,0.75);
	--micrio-scrubber-background: rgba(255,255,255,.5);
}
@media (prefers-color-scheme: light) {
	micr-io[data-auto-scheme] {
		--micrio-color: #000;
		--micrio-color-hover: #196DA6;
		--micrio-background: rgba(255,255,255,0.66);
		--micrio-progress-bar-background: rgba(0,0,0,.25);
		--micrio-popover-background: rgba(211,211,211,0.75);
	}
}
@media (max-width: 500px) {
	html {
		--micrio-border-margin: 5px;
		--micrio-button-size: 48px;
	}
}
`;
