import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const BENCH_SLUG = encodeURIComponent('DecisionBench(eng, v1)');

function rows(page: Page): Locator {
	return page.locator('main table.tbl tbody tr');
}

function header(page: Page, name: RegExp): Locator {
	return page.getByRole('columnheader', { name }).first();
}

function facetCheckbox(page: Page, label: string): Locator {
	return page
		.locator('aside.sidebar label.pill')
		.filter({ has: page.locator(`span:text-is("${label}")`) })
		.locator('input[type=checkbox]');
}

async function gotoModelsTable(page: Page) {
	await page.goto('/models?view=table');
	await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('/models Openness column', () => {
	test('renders reviewed openness metadata for every submitted model', async ({ page }) => {
		await gotoModelsTable(page);
		await expect(header(page, /Openness/)).toBeVisible();
		const rowCount = await rows(page).count();
		expect(rowCount).toBeGreaterThan(0);
		await expect(rows(page).locator('.openness-cell [role="img"]')).toHaveCount(rowCount);
		for (const meter of await rows(page).locator('.openness-cell [role="img"]').all()) {
			await expect(meter).toHaveAttribute('aria-label', /^Openness score: [0-6] of 6 dimensions$/);
		}
	});

	test('sorting by Openness updates URL state without losing rows', async ({ page }) => {
		await gotoModelsTable(page);
		const rowCount = await rows(page).count();
		await page
			.getByRole('button', { name: /^Openness/ })
			.first()
			.click();
		await expect(page).toHaveURL(/[?&]s\.models=openness/);
		await expect(rows(page)).toHaveCount(rowCount);
	});

	test('hovering a cell opens the per-dimension breakdown', async ({ page }) => {
		await gotoModelsTable(page);
		await rows(page).filter({ hasText: 'NanoJev' }).first().locator('.openness-cell').hover();
		const portal = page.locator('.hover-portal');
		await expect(portal).toBeVisible();
		await expect(portal).toContainText('Open weights');
		await expect(portal).toContainText('Model card');
		await expect(portal).toContainText('3/6');
	});
});

test.describe('/models cards view', () => {
	test('each card shows the decision-model metadata contract', async ({ page }) => {
		await page.goto('/models');
		const card = page.locator('a.card').filter({ hasText: 'NanoJev' }).first();
		await expect(card).toBeVisible({ timeout: 15_000 });
		const labels = await card
			.locator('.card-stats dt')
			.evaluateAll((items) => items.map((item) => item.textContent?.trim()));
		expect(labels).toEqual(['Parameters', 'Type', 'Weights', 'Openness']);
		await expect(card.locator('.openness-stat')).toContainText('3/6');
		await expect(card).toContainText('Open weights');
	});
});

test.describe('/models Openness filter', () => {
	test('requirements round-trip and use AND semantics', async ({ page }) => {
		await gotoModelsTable(page);
		const totalRows = await rows(page).count();
		await facetCheckbox(page, 'Open weights').click({ force: true });
		await expect(page).toHaveURL(/[?&]openreq=weights/);
		const openWeightRows = await rows(page).count();
		expect(openWeightRows).toBeGreaterThan(0);
		expect(openWeightRows).toBeLessThan(totalRows);

		const filteredUrl = page.url();
		await page.goto(filteredUrl);
		await expect(facetCheckbox(page, 'Open weights')).toBeChecked();
		await expect(rows(page)).toHaveCount(openWeightRows);

		await facetCheckbox(page, 'Training data').click({ force: true });
		await expect(page).toHaveURL(/[?&]openreq=weights%2Cdata/);
		await expect(rows(page)).toHaveCount(0);
	});
});

test.describe('Openness on the benchmark summary table', () => {
	test('the column renders with per-model meters', async ({ page }) => {
		await page.goto(`/benchmark/${BENCH_SLUG}`);
		await expect(page.locator('.tab-pane.active table tbody tr').first()).toBeVisible({
			timeout: 20_000
		});
		await expect(header(page, /Openness/)).toBeVisible();
		const rowCount = await page.locator('.tab-pane.active table tbody tr').count();
		await expect(page.locator('.tab-pane.active .openness-cell [role="img"]')).toHaveCount(rowCount);
	});
});

test.describe('shared column tooltip copy', () => {
	async function headerTip(page: Page, scope: string, name: RegExp): Promise<string> {
		await page.locator(`${scope} th`).filter({ hasText: name }).first().hover();
		const portal = page.locator('.hover-portal');
		await expect(portal).toBeVisible();
		return (await portal.innerText()).trim();
	}

	test('Parameters and Openness read identically on /models and /benchmark', async ({ page }) => {
		await gotoModelsTable(page);
		const modelsParams = await headerTip(page, 'main table.tbl thead', /Parameters/);
		await page.mouse.move(0, 0);
		const modelsOpenness = await headerTip(page, 'main table.tbl thead', /Openness/);

		await page.goto(`/benchmark/${BENCH_SLUG}`);
		await expect(page.locator('.tab-pane.active table tbody tr').first()).toBeVisible({
			timeout: 20_000
		});
		const benchParams = await headerTip(page, '.tab-pane.active thead', /Parameters/);
		await page.mouse.move(0, 0);
		const benchOpenness = await headerTip(page, '.tab-pane.active thead', /Openness/);

		expect(modelsParams).toBe(benchParams);
		expect(modelsOpenness).toBe(benchOpenness);
		expect(modelsParams).toContain('Total parameter count');
	});
});
