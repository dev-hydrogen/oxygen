import { describe, expect, it } from 'vitest';
import { newer, updateNotice } from '../src/update';

describe('a newer release', () => {
	it('compares versions by number, and never counts a pre-release or a tag it can’t read', () => {
		expect(newer('0.10.0', '0.9.2')).toBe(true);
		expect(newer('v0.3.0', '0.2.0')).toBe(true);
		expect(newer('1.0.0', '0.99.99')).toBe(true);
		expect(newer('0.2.0', '0.2.0')).toBe(false);
		expect(newer('0.1.9', '0.2.0')).toBe(false);
		expect(newer('0.3.0-beta.1', '0.2.0')).toBe(false);
		expect(newer('latest', '0.2.0')).toBe(false);
	});

	it('tells the agent where to get it and what to replace', () => {
		const note = updateNotice('0.3.0', '0.2.0', '/home/me/oxygen-mcp');
		expect(note).toContain('0.3.0 is out (this one is 0.2.0)');
		expect(note).toContain('releases/latest/download/oxygen-mcp.zip');
		expect(note).toContain('/home/me/oxygen-mcp');
		expect(note).toContain('npm install --omit=dev');
	});
});
