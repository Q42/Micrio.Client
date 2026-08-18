/**
 * # Micrio Grid — API demo & test interface
 *
 * Loaded by `templates/grid/grid.html`. It waits for the grid controller and
 * then builds a small control panel that exercises the public Grid API:
 *
 *   - `grid.set()`            — re-layout + transitions between configurations
 *   - `grid.gridFocus()`      — focus / zoom into a single image
 *   - `grid.blur()` / `back()`— leave the focused image
 *   - `grid.reset()`          — back to the initial layout
 *   - `grid.enlarge()`        — grow a single cell
 *   - `grid.action()`         — named actions (`focus`, `flyTo`, `focusTagged`, …)
 *
 * It also injects **demo markers** into the paintings, sharing tag names
 * (`architecture`, `animals`, `boats`, `figures`, `landscape`) so the
 * `focusTagged` / `focusWithTagged` actions can pull up every painting that
 * contains the same motif.
 *
 * Important: this file only uses the *public* Micrio API. Internal fields that
 * are prefixed with `_` (e.g. `grid._images`, `micrio._canvases`) are renamed
 * by the production minifier, so they work against the dev source but break
 * against the compiled / CDN bundles. Everything here (event names, `$`-getters,
 * public methods, `micrio.gallery.gotoId()`) survives minification.
 */

import type { HTMLMicrioElement } from '$core/element';
import type { Grid } from '$grid/grid';
import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';

type GridImage = Models.Grid.GridImage;
type View = Models.Camera.View;
type Marker = Models.ImageData.Marker;
type FocusTransition = Models.Grid.MarkerFocusTransition;

// ─────────────────────────────────────────────────────────────────────────────
// Demo catalogue — matches the "Grid template demo" album (11 images).
// https://dash.micr.io/micrio-shared/2026-grids/grid-template-demo
// Order is the album's (name-sorted) order and drives the demo layouts.
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG: { id: string; title: string }[] = [
	{ id: 'sBuyejY',  title: 'Ancient Ruins, Messina' },
	{ id: 'DPxSjQn',  title: 'Birds' },
	{ id: 'CpxjLFr',  title: 'Boston Harbor' },
	{ id: 'ZjzuXPn',  title: 'Lion Defending Its Prey' },
	{ id: 'JfujXSL',  title: 'Sisters' },
	{ id: 'ajMFvkb',  title: 'The Dogana, Venice' },
	{ id: 'BEjwEGa',  title: 'The Evening of the Deluge' },
	{ id: 'ojhxdmF',  title: 'Voyage of Life: Manhood' },
	{ id: 'JkvjmWK',  title: 'Voyage of Life: Youth' },
	{ id: 'jZwjFAU',  title: 'View of La Cava' },
	{ id: 'pyjuYXY',  title: 'View of Lake Nemi' },
];

const CATALOG_IDS = CATALOG.map(c => c.id);

const TAGS = ['architecture', 'animals', 'boats', 'figures', 'landscape'] as const;
type Tag = (typeof TAGS)[number];

/** Human labels for the tag buttons. */
const TAG_LABELS: Record<Tag, string> = {
	architecture: 'Architecture',
	animals: 'Animals',
	boats: 'Boats',
	figures: 'Figures',
	landscape: 'Landscape',
};

// ─────────────────────────────────────────────────────────────────────────────
// Demo markers — shared tag names across paintings.
// ─────────────────────────────────────────────────────────────────────────────

type MarkerSeed = {
	x: number;
	y: number;
	view: View;
	tags: Tag[];
	title: string;
	body?: string;
};

function makeMarkers(image: string, seeds: MarkerSeed[]): Marker[] {
	return seeds.map((s, i) => ({
		id: `demo-${image}-${i}`,
		x: s.x,
		y: s.y,
		view: s.view,
		tags: [...s.tags],
		i18n: { en: { title: s.title, ...(s.body ? { body: s.body } : {}) } },
	}));
}

const MARKERS: Record<string, Marker[]> = {
	sBuyejY: makeMarkers('sBuyejY', [
		{ x: 0.52, y: 0.42, view: [0.28, 0.18, 0.44, 0.5], tags: ['architecture'], title: 'Classical ruins' },
		{ x: 0.15, y: 0.72, view: [0.02, 0.48, 0.36, 0.46], tags: ['landscape'], title: 'Wild vegetation' },
	]),
	DPxSjQn: makeMarkers('DPxSjQn', [
		{ x: 0.5, y: 0.4, view: [0.28, 0.18, 0.44, 0.5], tags: ['animals'], title: 'Flock of birds' },
	]),
	CpxjLFr: makeMarkers('CpxjLFr', [
		{ x: 0.55, y: 0.55, view: [0.35, 0.34, 0.4, 0.42], tags: ['boats'], title: 'Ships in the harbor' },
		{ x: 0.5, y: 0.86, view: [0.2, 0.66, 0.6, 0.3], tags: ['landscape'], title: 'Harbor water' },
	]),
	ZjzuXPn: makeMarkers('ZjzuXPn', [
		{ x: 0.42, y: 0.52, view: [0.22, 0.28, 0.5, 0.5], tags: ['animals'], title: 'The lion' },
	]),
	JfujXSL: makeMarkers('JfujXSL', [
		{ x: 0.5, y: 0.55, view: [0.3, 0.3, 0.4, 0.52], tags: ['figures'], title: 'The sisters' },
	]),
	ajMFvkb: makeMarkers('ajMFvkb', [
		{ x: 0.72, y: 0.34, view: [0.56, 0.14, 0.36, 0.46], tags: ['architecture'], title: 'Santa Maria della Salute' },
		{ x: 0.26, y: 0.74, view: [0.08, 0.56, 0.4, 0.4], tags: ['boats'], title: 'Gondolas on the canal' },
	]),
	BEjwEGa: makeMarkers('BEjwEGa', [
		{ x: 0.42, y: 0.46, view: [0.28, 0.26, 0.4, 0.5], tags: ['figures'], title: 'Struggling figures' },
		{ x: 0.56, y: 0.62, view: [0.42, 0.46, 0.36, 0.36], tags: ['boats'], title: 'The ark' },
		{ x: 0.5, y: 0.8, view: [0.2, 0.6, 0.6, 0.35], tags: ['landscape'], title: 'Rising waters' },
	]),
	ojhxdmF: makeMarkers('ojhxdmF', [
		{ x: 0.45, y: 0.5, view: [0.3, 0.3, 0.35, 0.5], tags: ['figures'], title: 'The traveler' },
		{ x: 0.45, y: 0.55, view: [0.3, 0.36, 0.35, 0.4], tags: ['boats'], title: 'His vessel' },
	]),
	JkvjmWK: makeMarkers('JkvjmWK', [
		{ x: 0.5, y: 0.55, view: [0.35, 0.34, 0.35, 0.52], tags: ['figures'], title: 'The youth' },
		{ x: 0.5, y: 0.6, view: [0.35, 0.4, 0.35, 0.4], tags: ['boats'], title: 'The boat' },
		{ x: 0.14, y: 0.28, view: [0.02, 0.08, 0.3, 0.42], tags: ['landscape'], title: 'Distant hills' },
	]),
	jZwjFAU: makeMarkers('jZwjFAU', [
		{ x: 0.5, y: 0.62, view: [0.3, 0.42, 0.4, 0.45], tags: ['architecture'], title: 'The town' },
		{ x: 0.5, y: 0.24, view: [0.3, 0.04, 0.4, 0.4], tags: ['landscape'], title: 'The valley' },
	]),
	pyjuYXY: makeMarkers('pyjuYXY', [
		{ x: 0.34, y: 0.4, view: [0.14, 0.2, 0.45, 0.45], tags: ['landscape'], title: 'Lake Nemi' },
	]),
};

// ─────────────────────────────────────────────────────────────────────────────
// Focus transitions available for `grid.gridFocus()`.
// ─────────────────────────────────────────────────────────────────────────────

const FOCUS_TRANSITIONS: FocusTransition[] = [
	'crossfade',
	'slide', 'slide-horiz', 'slide-vert', 'slide-up', 'slide-down', 'slide-left', 'slide-right',
	'swipe', 'swipe-horiz', 'swipe-vert', 'swipe-up', 'swipe-down', 'swipe-right', 'swipe-left',
	'behind', 'behind-left', 'behind-right',
];

// ─────────────────────────────────────────────────────────────────────────────
// Small DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (className) e.className = className;
	if (text !== undefined) e.textContent = text;
	return e;
}

/** Build a whole-image thumbnail URL from the image's (corner-tile) `thumbSrc`. */
function thumbOf(img: MicrioImage, level = 8): string {
	const src = img.thumbSrc;
	if (!src) return '';
	return src.replace(/(\/\d+\/0_0)(\.\w+)$/, `/${level}/0_0$2`);
}

function titleOf(id: string): string {
	return CATALOG.find(c => c.id === id)?.title ?? id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

function boot(micrio: HTMLMicrioElement): void {
	(window as unknown as { micrio: HTMLMicrioElement }).micrio = micrio;
	micrio.defaultSettings = {
		// Keep the demo canvas clean — our panel replaces the default UI.
		noControls: true,
		noLogo: true,
		noToolbar: true,
		// Enable the grid's built-in click + keyboard navigation.
		hookKeys: true,
		grid: {
			clickable: 'focus',
			panZoom: 'grid',
			transitionDuration: 1,
			transitionDurationOut: 0.6,
		},
	};

	injectStyles();
	const root = buildShell();
	document.body.appendChild(root);

	// Resolve the Grid controller. This is deliberately order-independent:
	// depending on whether Micrio is loaded as an ES module (dev) or as a
	// classic `<script defer>`/CDN bundle (compiled / production), `grid-init`
	// may fire before *or* after this module runs. We listen for the event,
	// check whether the controller already exists, and poll as a safety net.
	resolveGrid(micrio, grid => {
		(window as unknown as { grid: Grid }).grid = grid;
		void init(root, micrio, grid);
	});
}

// Resolve the `<micr-io>` element. When this file is bundled as a classic
// script for a static release, it may execute in `<head>` before the element
// in `<body>` has been parsed — in that case wait for the document to finish.
const micrioEl = document.querySelector('micr-io') as HTMLMicrioElement | null;
if (micrioEl) {
	boot(micrioEl);
} else if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		const el = document.querySelector('micr-io') as HTMLMicrioElement | null;
		if (el) boot(el);
		else console.error('[grid demo] No <micr-io> element found.');
	});
} else {
	console.error('[grid demo] No <micr-io> element found.');
}

/**
 * Wait for the grid controller to become available, then call `onGrid` exactly
 * once. Handles every ordering of `grid-init` relative to this module:
 *
 *  1. listens for the `grid-init` event (normal case),
 *  2. checks whether the grid already initialized before we ran,
 *  3. polls for a short while as a fallback.
 */
function resolveGrid(micrio: HTMLMicrioElement, onGrid: (grid: Grid) => void): void {
	let done = false;
	let timer: number | undefined;

	const finish = (grid?: Grid) => {
		if (done || !grid) return;
		done = true;
		if (timer !== undefined) clearInterval(timer);
		onGrid(grid);
	};

	// The controller is attached to the main (viewport) image, which is
	// `micrio.$current` while the grid overview is showing.
	const find = (): Grid | undefined => micrio.$current?.grid;

	micrio.addEventListener('grid-init', e => finish((e as CustomEvent).detail as Grid));

	// Already initialized?
	finish(find());

	// Safety net for any ordering/event edge case.
	timer = window.setInterval(() => finish(find()), 150);
	window.setTimeout(() => {
		if (done) return;
		if (timer !== undefined) clearInterval(timer);
		console.warn('[grid demo] Timed out waiting for the grid controller.');
	}, 15000);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

function injectStyles(): void {
	const css = `
.gd, .gd * { box-sizing: border-box; }
.gd {
	position: fixed; inset: 0; z-index: 2000; pointer-events: none;
	font-family: 'Poppins', sans-serif; color: #e8e8e8; font-size: 13px;
	-webkit-font-smoothing: antialiased;
}
/* Only the control panel is interactive by default; the top bar and bottom
   strip are click-through so they don't cover Micrio's own close/zoom buttons. */
.gd aside { pointer-events: auto; }
.gd header, .gd footer { pointer-events: none; }
.gd-h {
	position: absolute; top: 0; left: 0; right: 0; padding: 14px 18px;
	background: linear-gradient(180deg, rgba(0,0,0,.55), transparent);
}
.gd-h .gd-t { font-size: 16px; font-weight: 600; letter-spacing: .3px; }
.gd-h .gd-t b { color: #00d4ee; }
.gd-h .gd-sub { font-size: 12px; color: #a7b3bd; margin-top: 2px; max-width: 60ch; }
.gd-panel {
	position: absolute; top: 76px; right: 14px; width: 308px;
	max-height: calc(100% - 200px); overflow: auto; padding: 14px;
	background: rgba(20,22,26,.84); border: 1px solid rgba(255,255,255,.08);
	border-radius: 12px; backdrop-filter: blur(8px);
	scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent;
}
.gd-panel h3 {
	margin: 16px 0 8px; font-size: 11px; text-transform: uppercase;
	letter-spacing: 1.2px; color: #8fa0ab; font-weight: 600;
}
.gd-panel h3:first-child { margin-top: 0; }
.gd-row { display: flex; flex-wrap: wrap; gap: 6px; }
.gd button, .gd select {
	appearance: none; border: 1px solid rgba(255,255,255,.14);
	background: rgba(255,255,255,.06); color: #e8e8e8;
	padding: 7px 10px; border-radius: 8px; cursor: pointer;
	font: inherit; font-size: 12px; transition: background .15s, border-color .15s;
}
.gd button:hover { background: rgba(255,255,255,.15); }
.gd button:active { transform: translateY(1px); }
.gd select { flex: 1; min-width: 0; }
.gd select option { color: #111; }
.gd-tags { display: flex; flex-direction: column; gap: 6px; }
.gd-tag { display: flex; align-items: center; gap: 8px; }
.gd-tag .nm { flex: 1; font-size: 12px; }
.gd-tag .cnt { color: #8fa0ab; font-size: 11px; min-width: 14px; text-align: right; }
.gd-tag .cnt b { color: #00d4ee; }
.gd-tag button { padding: 5px 8px; font-size: 11px; }
.gd-strip {
	position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 10px;
	padding: 12px 14px; overflow-x: auto;
	background: linear-gradient(0deg, rgba(0,0,0,.62), transparent);
	scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent;
}
.gd .gd-cell {
	flex: 0 0 auto; width: 66px; text-align: center; cursor: pointer;
	background: none; border: 0; padding: 0; color: inherit; box-sizing: border-box;
	pointer-events: auto;
}
.gd .gd-cell:hover { background: none; }
.gd .gd-cell .ph {
	display: block; width: 100%; height: 50px; box-sizing: border-box;
	border-radius: 8px; overflow: hidden;
	border: 2px solid transparent; background: #2a2f36 center/cover no-repeat;
	transition: border-color .15s, transform .15s;
}
.gd .gd-cell:hover .ph { transform: translateY(-2px); }
.gd .gd-cell.on .ph { border-color: #00d4ee; }
.gd .gd-cell .lb {
	display: block; margin-top: 4px; font-size: 10px; color: #c6d0d6;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.gd-note { margin-top: 12px; font-size: 11px; color: #77848d; line-height: 1.5; }
`;
	const style = h('style');
	style.textContent = css;
	document.head.appendChild(style);
}

function buildShell(): HTMLElement {
	const root = h('div', 'gd');
	root.innerHTML = `
		<header class="gd-h">
			<div class="gd-t">Micrio <b>Grid</b> — API demo</div>
			<div class="gd-sub" data-role="sub">loading…</div>
		</header>

		<aside class="gd-panel">
			<section>
				<h3>Layout</h3>
				<div class="gd-row">
					<button data-act="reset">Reset</button>
					<button data-act="row">Row</button>
					<button data-act="col">Column</button>
					<button data-act="mosaic">Hero mosaic</button>
					<button data-act="pairs">2×2</button>
					<button data-act="enlarge">Enlarge cell #0</button>
				</div>
			</section>

			<section>
				<h3>Focus a single image</h3>
				<div class="gd-row">
					<select data-role="focus-trans"></select>
					<button data-act="back">Back</button>
					<button data-act="blur">Unfocus</button>
				</div>
			</section>

			<section>
				<h3>Tag stories (shared markers)</h3>
				<div class="gd-tags" data-role="tags"></div>
			</section>

			<section>
				<h3>Actions</h3>
				<div class="gd-row">
					<button data-act="flyto" title="Reset, then fly the viewport to the two boat paintings">Fly to boats</button>
					<button data-act="switch" title="Focus an image first, then drop it back into the grid">switchToGrid</button>
					<button data-act="slowfocus" title="Focus the first image with a slow transition">Slow focus</button>
				</div>
			</section>

			<div class="gd-note">Click a cell to focus it · <b>Esc</b> goes back · arrow keys navigate. Open the console and play with <code>window.grid</code>.</div>
		</aside>

		<footer class="gd-strip" data-role="strip"></footer>
	`;
	return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────────

async function init(root: HTMLElement, micrio: HTMLMicrioElement, grid: Grid): Promise<void> {
	await injectMarkers(micrio);

	const sub = root.querySelector<HTMLElement>('[data-role="sub"]')!;
	const strip = root.querySelector<HTMLElement>('[data-role="strip"]')!;
	const tagsBox = root.querySelector<HTMLElement>('[data-role="tags"]')!;
	const focusTrans = root.querySelector<HTMLSelectElement>('[data-role="focus-trans"]')!;

	for (const t of FOCUS_TRANSITIONS) {
		const opt = h('option');
		opt.value = t;
		opt.textContent = t;
		focusTrans.appendChild(opt);
	}
	focusTrans.value = 'slide-up';

	const getTransition = () => focusTrans.value as FocusTransition;

	buildStrip(strip, micrio, grid, getTransition);
	buildTags(tagsBox, grid);
	wireButtons(root, micrio, grid, getTransition);

	const setSub = (s: string) => (sub.textContent = s);
	setSub(`${CATALOG.length} images · ${Object.keys(MARKERS).length} with demo markers · click a cell to focus`);

	// Keep the status line + strip highlight in sync with the controller.
	grid.micrio.addEventListener('grid-layout-set', () => {
		setSub('Layout updated');
		refreshStrip(strip, grid);
	});
	grid.micrio.addEventListener('grid-focus', (e) => {
		const img = (e as CustomEvent).detail as MicrioImage;
		setSub(`Focused: ${titleOf(img.id)} — Esc or “Back” to return`);
		refreshStrip(strip, grid);
	});
	grid.micrio.addEventListener('grid-blur', () => {
		setSub('Overview');
		refreshStrip(strip, grid);
	});

	refreshStrip(strip, grid);
}

// ── markers ──────────────────────────────────────────────────────────────────

async function injectMarkers(micrio: HTMLMicrioElement): Promise<void> {
	const gallery = micrio.gallery;
	if (!gallery) return;

	for (const { id } of CATALOG) {
		const markers = MARKERS[id];
		if (!markers?.length) continue;

		const img = await gallery.gotoId(id);
		if (!img) continue;

		const ensure = () => {
			const existing = img.$data?.markers ?? [];
			const have = new Set(existing.map(m => m.id));
			const add = markers.filter(m => !have.has(m.id));
			if (!add.length) return;
			img.data.update(d => {
				const base: Models.ImageData.ImageData = d ?? {};
				return { ...base, markers: [...(base.markers ?? []), ...add] };
			});
		};

		ensure();
		img.data.subscribe(() => ensure());
	}
}

// ── thumbnail strip ──────────────────────────────────────────────────────────

function buildStrip(strip: HTMLElement, micrio: HTMLMicrioElement, grid: Grid, getTransition: () => FocusTransition): void {
	for (const { id, title } of CATALOG) {
		const cell = h('button', 'gd-cell');
		cell.dataset.id = id;

		const ph = h('div', 'ph');
		const lb = h('span', 'lb', title);
		cell.append(ph, lb);
		cell.addEventListener('click', () => void focusById(micrio, grid, id, getTransition()));
		strip.appendChild(cell);

		// Load the whole-image thumbnail asynchronously.
		void micrio.gallery?.gotoId(id).then(img => {
			if (!img) return;
			const url = thumbOf(img);
			if (url) ph.style.backgroundImage = `url('${url}')`;
		});
	}
}

async function focusById(micrio: HTMLMicrioElement, grid: Grid, id: string, transition: FocusTransition, duration = 1): Promise<void> {
	const img = await micrio.gallery?.gotoId(id);
	if (img) await grid.gridFocus(img, { transition, duration });
}

function refreshStrip(strip: HTMLElement, grid: Grid): void {
	const focused = grid.$focussed?.id;
	strip.querySelectorAll<HTMLElement>('.gd-cell').forEach(c => {
		c.classList.toggle('on', c.dataset.id === focused);
	});
}

// ── tag stories ──────────────────────────────────────────────────────────────

function buildTags(box: HTMLElement, grid: Grid): void {
	for (const tag of TAGS) {
		const images = CATALOG.filter(c => MARKERS[c.id]?.some(m => m.tags?.includes(tag)));
		if (!images.length) continue;

		const row = h('div', 'gd-tag');
		const nm = h('span', 'nm', TAG_LABELS[tag]);
		const cnt = h('span', 'cnt');
		cnt.innerHTML = `<b>${images.length}</b>`;
		row.append(nm, cnt);

		const zoom = h('button', undefined, 'Zoom to motif');
		zoom.title = 'Show every painting with this tag, zoomed to its marker';
		zoom.addEventListener('click', () => grid.action('focusTagged', tag));

		const show = h('button', undefined, 'Show all');
		show.title = 'Show every painting with this tag at full view';
		show.addEventListener('click', () => grid.action('focusWithTagged', tag));

		row.append(zoom, show);
		box.appendChild(row);
	}
}

// ── buttons ──────────────────────────────────────────────────────────────────

function allCells(): GridImage[] {
	return CATALOG_IDS.map(id => ({ id, size: [1] as [number, number?] }));
}

function wireButtons(root: HTMLElement, micrio: HTMLMicrioElement, grid: Grid, getTransition: () => FocusTransition): void {
	const on = (act: string, fn: () => void) => {
		root.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)?.addEventListener('click', fn);
	};

	// Layout
	on('reset', () => void grid.reset(1));
	on('row', () => void grid.set(allCells(), { horizontal: true, duration: 1 }));
	on('col', () => void grid.set(allCells(), { columns: 1, duration: 1 }));
	on('pairs', () => {
		const first = CATALOG_IDS.slice(0, 4).map(id => ({ id, size: [1] as [number, number?] }));
		void grid.set(first, { columns: 2, duration: 1 });
	});
	on('mosaic', () => {
		const layout: GridImage[] = [
			{ id: CATALOG_IDS[0], size: [2, 2] },
			{ id: CATALOG_IDS[1], size: [1] },
			{ id: CATALOG_IDS[2], size: [1] },
			{ id: CATALOG_IDS[3], size: [1] },
			{ id: CATALOG_IDS[4], size: [2] },
			{ id: CATALOG_IDS[5], size: [1] },
			{ id: CATALOG_IDS[6], size: [1] },
			{ id: CATALOG_IDS[7], size: [1, 2] },
			{ id: CATALOG_IDS[8], size: [1] },
			{ id: CATALOG_IDS[9], size: [1] },
			{ id: CATALOG_IDS[10], size: [1] },
		];
		void grid.set(layout, { duration: 1, transition: 'behind' });
	});
	on('enlarge', () => void grid.enlarge(0, 2, 2));

	// Focus
	on('back', () => void grid.back(0.8));
	on('blur', () => grid.blur());

	// Actions
	on('flyto', () => {
		void grid.reset(0.4).then(() => grid.action('flyTo', 'CpxjLFr,ajMFvkb', 1));
	});
	on('switch', () => grid.action('switchToGrid'));
	on('slowfocus', () => {
		void focusById(micrio, grid, CATALOG_IDS[0], getTransition(), 2.5);
	});
}
