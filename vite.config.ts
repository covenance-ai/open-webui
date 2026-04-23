import { readFileSync } from 'node:fs';

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { viteStaticCopy } from 'vite-plugin-static-copy';

function readCoachVersion(): string {
	try {
		return readFileSync(new URL('./.coach-version', import.meta.url), 'utf8').trim();
	} catch {
		return 'dev';
	}
}

export default defineConfig({
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',

					dest: 'wasm'
				}
			]
		})
	],
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build'),
		// Our coach version (independent of upstream's package.json version
		// to avoid rebase conflicts). Auto-bumped by the pre-commit hook on
		// every commit to main; rendered in the rail footer so you can
		// glance at the page and know which version is running.
		COACH_VERSION: JSON.stringify(readCoachVersion())
	},
	build: {
		sourcemap: true
	},
	worker: {
		format: 'es'
	},
	esbuild: {
		pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
	}
});
