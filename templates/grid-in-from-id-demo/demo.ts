import type { HTMLMicrioElement } from '$core/element';
import type { Grid } from '$grid/grid';
import type { Models } from '$types/models';

const LAYOUT_PHASES: Models.Grid.GridImage[] = [
  {
    id: 'WyQdjyZ',
    size: [1]
  },
  {
    id: 'tbGDJFj',
    size: [1]
  },
  {
    id: 'MRFRBVj',
    size: [1]
  },
  {
    id: 'WrxcjGR',
    size: [1]
  }
];

const PHASE_2: Models.Grid.GridImage[] = [
    {
        "id": "tbGDJFj",
        "size": [1]
    },
    {
        "id": "rDQHjWG",
        "size": [1]
    },
    {
        "id": "vEjoNLg",
        "size": [1]
    },
    {
        "id": "mNTtxjB",
        "size": [1]
    },
    {
        "id": "OSjoyXL",
        "size": [1]
    }
];

function sleep(ms: number): Promise<void> {
	return new Promise(ok => setTimeout(ok, ms));
}

async function runDemo(grid: Grid): Promise<void> {

  await sleep(3000);

	await grid.set(LAYOUT_PHASES, { duration: 1, cover: true, columns: 4, keepGrid: true});

  await sleep(1000);

  await grid.set(PHASE_2.map(entry=>({...entry, empty: entry.id !== 'tbGDJFj'})), {
		columns: 4,
		duration: 1,
    cover: true,
	});

	await sleep(300);

	await grid.set(
		PHASE_2.map((entry) => ({ ...entry, from: 'tbGDJFj'})),
		{
			columns: 4,
			duration: 1.2,
			transition: 'in-from-id',
			cover: true,
		}
  );
}

const micrio = document.querySelector('micr-io') as HTMLMicrioElement | null;
if (!micrio) throw new Error('No <micr-io> element found');
console.log("DEMO TIME", micrio)

micrio.defaultSettings = {
	noControls: true,
	noToolbar: true,
	grid: {
		panZoom: 'grid',
		transitionDuration: 1,
    transitionDurationOut: 0.6,
		clickable: 'zoom',
	},
};

micrio.addEventListener('grid-init', (e: Event) => runDemo((e as CustomEvent<Grid>).detail), { once: true });
