import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: [
			'vendor/molangjs/test/**/*.test.ts',
			'vendor/wintersky/test/**/*.test.ts',
			'packages/*/test/**/*.test.ts',
			'apps/mcp/test/**/*.test.ts',
		],
		environment: 'node',
	},
});
