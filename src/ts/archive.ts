import type { TextureBitmap } from './textures';
import { idIsV5 } from './utils';

// Subset of PosixHeader
type MDPHeader = {
	name: string; // 20
	size: number; // 12
}

/** @internal */
class Archive {
	private data:Map<string, ArrayBuffer> = new Map;
	db:Map<string, [string, number, number]> = new Map;

	private images:HTMLImageElement[] = [];

	async load(path:string, id: string, p?:(n:number)=>void) : Promise<void> {
		if(this.data.has(id)) return;

		const baseId = id.replace(/^.*\//,'').split('.')[0];
		const isOmni = /\/base$/.test(id);
		const isBin = isOmni || idIsV5(baseId)

		const xhr = new XMLHttpRequest();
		const data = await new Promise((ok, err) => {
			let size:number = 0;
			xhr.responseType = 'arraybuffer';
			xhr.onprogress = e => {
				if(!size) size = Number(xhr.getResponseHeader('Content-Length'));
				p?.(Math.min(1, e.loaded / size));
			};
			xhr.onload = () => {
				if(xhr.readyState === 4 && xhr.status === 200) { p?.(1); ok(xhr.response); }
				else err();
			};
			xhr.open('GET', path+id+(isBin ? '.bin' : '.mdp'));
			xhr.send();
		}) as Uint8Array|undefined;

		if(!data) return;

		this.data.set(id, data);

		// For omni objects
		const imgPath = isOmni ? id.split('/')[0]+'/' : '';

		const hSize = 32;

		let i = 0;
		while(i<data.byteLength) {
			const h = this.parseHeader(new Uint8Array(data, i, hSize));
			if(h.name && h.size > 0) this.db.set(path+imgPath+h.name.replace('./',''), [id, i+hSize, h.size]);
			i+=hSize + h.size;
		}
	}

	private parseHeader(d: Uint8Array) : MDPHeader {
		const s = new TextDecoder().decode(d),
			g = (l:number) => s.slice(i, i+=l).replace(/\x00/g,'').trim();
		let i = 0;
		return { name: g(20), size: parseInt(g(12), 8) }
	}

	get = <T>(u: string) : Promise<T> => new Promise(ok => {
		const i = this.db.get(u);
		if(!i || !this.data.has(i[0])) throw new Error('Could no get blob: '+u);
		const fr = new FileReader();
		fr.onload = () => ok(JSON.parse(fr.result as string) as T);
		/** @ts-ignore */
		fr.readAsText(new Blob([new Uint8Array(this.data.get(i[0]), i[1], i[2])]));
	})

	getImage = async (u: string) : Promise<TextureBitmap> => new Promise(ok => {
		const i = this.db.get(u);
		if(!i || !this.data.has(i[0])) throw new Error('Could no get blob');
		/** @ts-ignore */
		const blob = new Blob([new Uint8Array(this.data.get(i[0]), i[1], i[2])]);
		// Safari
		if(!window.createImageBitmap) {
			let img = this.images.find(i => !i.src);
			if(!img) this.images.push(img = new Image);
			img.onload = () => { if(!img) return;
				ok(img);
				requestAnimationFrame(() => {
					if(!img) return;
					URL.revokeObjectURL(img.src);
					/** @ts-ignore */
					img.src = null;
				});
			}
			img.src = URL.createObjectURL(blob);
		}
		else ok(self.createImageBitmap(blob));
	})
}

/** @internal */
export const archive = new Archive();
