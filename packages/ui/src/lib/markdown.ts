/**
 * Just enough Markdown for the changelog in About › What's new and the pages of the Documentation: headings,
 * paragraphs, lists (with wrapped and nested lines), tables, fenced code, and inline code, bold, italics and links. Parsed
 * into data, so it renders without HTML strings; lines of only HTML (the pictures GitHub shows) are left out.
 */

export type Inline = { kind: 'text' | 'code' | 'bold' | 'italic'; text: string } | { kind: 'link'; text: string; href: string };

export type Block =
	| { kind: 'heading'; level: number; text: Inline[]; plain: string; id: string }
	| { kind: 'paragraph'; text: Inline[] }
	| { kind: 'list'; items: Inline[][] }
	| { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
	| { kind: 'code'; text: string };

/** A heading's anchor, as GitHub makes them: `## Effects on an entity` is `#effects-on-an-entity` */
export const slug = (heading: string) =>
	heading
		.toLowerCase()
		.replace(/[`*]/g, '')
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.trim()
		.replace(/\s/g, '-');

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
	let at = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
		if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
		else if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2] });
		else if (m[3] !== undefined) out.push({ kind: 'italic', text: m[3] });
		else out.push({ kind: 'link', text: m[4], href: m[5] });
		at = m.index + m[0].length;
	}
	if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
	return out;
}

export function parseMarkdown(source: string): Block[] {
	const blocks: Block[] = [];
	let para: string[] = [];
	let list: string[] | null = null;
	let table: string[][] | null = null;
	const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
	const flush = () => {
		if (para.length) blocks.push({ kind: 'paragraph', text: parseInline(para.join(' ')) });
		para = [];
		if (list) blocks.push({ kind: 'list', items: list.map(parseInline) });
		list = null;
		if (table) blocks.push({ kind: 'table', head: table[0].map(parseInline), rows: table.slice(1).map((r) => r.map(parseInline)) });
		table = null;
	};
	/** the lines of a fenced block being read, kept as written */
	let fence: string[] | null = null;
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (/^\s*```/.test(line)) {
			if (fence) blocks.push({ kind: 'code', text: fence.join('\n') });
			else flush();
			fence = fence ? null : [];
			continue;
		}
		if (fence) {
			fence.push(line);
			continue;
		}
		// a line of nothing but HTML (the changelog's pictures, for GitHub) stays out: the app shows the text
		if (/^\s*(<[^>]+>\s*)+$/.test(line)) continue;
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		const item = /^\s*[-*]\s+(.*)$/.exec(line);
		if (!line.trim()) {
			// a blank line ends a paragraph or a table; a list carries on over it when the next line is another item
			if (para.length || table) flush();
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(line)) {
			if (!table) flush();
			// the row of dashes under the head only says where the head ends
			if (!/^[\s|:-]+$/.test(line)) (table ??= []).push(cells(line));
			continue;
		}
		if (table) flush();
		if (heading) {
			flush();
			blocks.push({ kind: 'heading', level: heading[1].length, text: parseInline(heading[2]), plain: heading[2], id: slug(heading[2]) });
		} else if (item) {
			if (para.length) flush();
			(list ??= []).push(item[1]);
		} else if (list && /^\s+/.test(raw)) list[list.length - 1] += ` ${line.trim()}`;
		else {
			if (list) flush();
			para.push(line.trim());
		}
	}
	flush();
	return blocks;
}

/** The changelog cut into releases: each heading of level 2 starts one */
export function releases(source: string): { title: string; blocks: Block[] }[] {
	const out: { title: string; blocks: Block[] }[] = [];
	for (const b of parseMarkdown(source)) {
		if (b.kind === 'heading' && b.level === 2) out.push({ title: b.plain, blocks: [] });
		else if (out.length && !(b.kind === 'heading' && b.level === 1)) out[out.length - 1].blocks.push(b);
	}
	return out;
}
