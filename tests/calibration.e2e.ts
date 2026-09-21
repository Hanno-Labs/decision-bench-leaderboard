import { expect, test } from '@playwright/test';

test('model detail exposes benchmark-level ECE and NLL', async ({ page }) => {
	await page.goto('/models');
	await page
		.getByRole('link', { name: /NanoJev/ })
		.first()
		.click();

	await expect(page.getByRole('heading', { name: 'Benchmark scores' })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: /ECE/ })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: /NLL/ })).toBeVisible();
	await expect(page.locator('.bench-table tbody tr').first()).toContainText(/(?:\d+\.\d{2}%|—)/);
});

test('task detail exposes view-level ECE and NLL', async ({ page }) => {
	await page.goto(`/tasks/${encodeURIComponent('Domain: Legal')}/`);

	await expect(page.getByRole('heading', { name: 'Model scores' })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: /ECE/ })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: /NLL/ })).toBeVisible();
	await expect(page.locator('.task-table tbody tr').first()).toContainText(/\d+\.\d{2}%/);
});
