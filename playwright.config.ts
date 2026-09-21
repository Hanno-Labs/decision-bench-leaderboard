import { defineConfig } from '@playwright/test';

export default defineConfig({
	// DecisionBench ships reviewed result rows with the static frontend. Build
	// the same client-side application used by Pages and the container, then
	// exercise it through the custom fallback server.
	webServer: {
		command: 'npm run build && node tests/preview-server.mjs',
		env: { BUILD_NO_PRERENDER: '1' },
		port: 4173,
		reuseExistingServer: true,
		timeout: 180_000
	},
	use: { baseURL: 'http://localhost:4173' },
	testMatch: '**/*.e2e.{ts,js}',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0
});
