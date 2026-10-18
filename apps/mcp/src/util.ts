import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Run a tool body, turning a thrown error into a tool error the agent can read */
export async function tool(work: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
	try {
		return await work();
	} catch (e) {
		return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
	}
}

export const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });

/** A headline, then the data as compact JSON (long answers stay readable and cheap) */
export const data = (headline: string, value: unknown): CallToolResult => text(`${headline}\n${JSON.stringify(value)}`);

export function existing(path: string): string {
	const p = resolve(path);
	if (!existsSync(p)) throw new Error(`No file at ${p}`);
	return p;
}
