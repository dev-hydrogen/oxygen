import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_PROMPT, MCP_ZIP } from '../src/lib/about';

describe('the MCP setup prompt', () => {
	it('is the same in the app and in docs/agents.md', () => {
		const doc = readFileSync(new URL('../../../docs/agents.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
		const block = /```text\n([\s\S]*?)\n```/.exec(doc)?.[1];
		expect(block).toBe(MCP_PROMPT);
	});

	it('downloads the zip the release workflow attaches, from the latest release', () => {
		expect(MCP_ZIP).toBe('https://github.com/dev-hydrogen/oxygen/releases/latest/download/oxygen-mcp.zip');
		const workflow = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');
		expect(workflow).toContain('apps/mcp/release/oxygen-mcp.zip');
	});
});
