import { test, expect } from '@playwright/test';

// Benchmark detail page hero + tab switching against the reviewed snapshot.

const BENCH = 'DecisionBench(eng, v1)';
const SLUG = encodeURIComponent(BENCH);
const SLICE = 'DecisionBench(Legal, eng, v1)';
const SLICE_SLUG = encodeURIComponent(SLICE);

test('benchmark detail page loads the hero and the summary tab by default', async ({ page }) => {
	await page.goto(`/benchmark/${SLUG}/`);
	// Hero shows the benchmark name as the page title.
	await expect(page.getByRole('heading', { name: BENCH }).first()).toBeVisible();
	// Summary tab is active by default; SummaryTable has a Model column header.
	await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('table thead').first()).toBeVisible();
});

test('tab switching activates the selected tab and updates the URL', async ({ page }) => {
	await page.goto(`/benchmark/${SLUG}/`);

	const perTask = page.getByRole('tab', { name: 'Performance per task' });
	await perTask.click();
	await expect(perTask).toHaveAttribute('aria-selected', 'true');
	await expect(page).toHaveURL(/[?&]tab=perf_task/);

	// Summary tab is implicit (omitted from URL) — clicking it removes ?tab=.
	await page.getByRole('tab', { name: 'Summary' }).click();
	await expect(page).not.toHaveURL(/[?&]tab=/);
});

test('the URL ?tab= param rehydrates the active tab on load', async ({ page }) => {
	await page.goto(`/benchmark/${SLUG}/?tab=perf_task`);
	await expect(page.getByRole('tab', { name: 'Performance per task' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('domain suite route loads its own reviewed summary', async ({ page }) => {
	await page.goto(`/benchmark/${SLICE_SLUG}/`);

	await expect(page.getByRole('heading', { name: SLICE }).first()).toBeVisible();
	await expect(page.locator('table thead').first()).toBeVisible();
});
