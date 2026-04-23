// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	// Vite define() constants — exposed as globals at build time.
	// Upstream ones (APP_VERSION / APP_BUILD_HASH) are read from
	// process.env.npm_package_version; COACH_VERSION is ours, bumped
	// by .git/hooks/pre-commit on every commit to main.
	const APP_VERSION: string;
	const APP_BUILD_HASH: string;
	const COACH_VERSION: string;
}

export {};
