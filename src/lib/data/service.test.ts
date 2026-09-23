import { describe, expect, it } from 'vitest';
import catalog from '../../../static/benchmark-catalog.json';
import rows from '../../../static/leaderboard.json';
import {
	loadBenchmarkMenu,
	loadBenchmarks,
	loadFeaturedBenchmarks,
	loadSummary,
	loadTasks
} from './service';

const fetchSnapshot: typeof globalThis.fetch = async (input) => {
	const url = String(input);
	if (url.endsWith('/leaderboard.json')) return Response.json(rows);
	if (url.endsWith('/benchmark-catalog.json')) return Response.json(catalog);
	return new Response(null, { status: 404, statusText: 'Not Found' });
};

describe('data-driven benchmark catalog', () => {
	it('groups the English suite, every exported domain, and reasoning into Home sections', async () => {
		const benchmarks = await loadBenchmarks(fetchSnapshot);
		expect(benchmarks).toHaveLength(30);
		expect(benchmarks.at(0)?.name).toBe('DecisionBench(eng, v1)');
		expect(benchmarks.at(-1)?.name).toBe('DecisionBench(Reasoning, eng, v1)');
		expect(benchmarks.filter((benchmark) => benchmark.domains.length === 1)).toHaveLength(28);
		expect(benchmarks.some((benchmark) => benchmark.name.includes(' / '))).toBe(false);
		expect((await loadBenchmarkMenu(fetchSnapshot)).map((section) => section.name)).toEqual([
			'General Purpose',
			'Domain-Specific',
			'Reasoning'
		]);
		expect((await loadFeaturedBenchmarks(fetchSnapshot)).map((item) => item.preferred)).toEqual([
			'DecisionBench(eng, v1)',
			'DecisionBench(Reasoning, eng, v1)'
		]);
	});

	it('keeps general and reasoning scores separate and counts missing rows as misses', async () => {
		const general = await loadSummary('DecisionBench(eng, v1)', undefined, fetchSnapshot);
		const reasoning = await loadSummary(
			'DecisionBench(Reasoning, eng, v1)',
			undefined,
			fetchSnapshot
		);
		const nanoGeneral = general.rows.find((row) => row.model.name === 'C-Tianyu/NanoJev');
		const nanoReasoning = reasoning.rows.find((row) => row.model.name === 'C-Tianyu/NanoJev');

		expect(nanoGeneral?.meanTask).toBeCloseTo(8276 / 22700, 12);
		expect(nanoReasoning?.meanTask).toBeCloseTo(274 / 1200, 12);
		expect(general.tasks).not.toContain('Family: Reasoning');
		expect(reasoning.tasks).toEqual(['Family: Reasoning']);
	});

	it('carries calibration through suites without folding it into accuracy', async () => {
		const general = await loadSummary('DecisionBench(eng, v1)', undefined, fetchSnapshot);
		const legal = await loadSummary('DecisionBench(Legal, eng, v1)', undefined, fetchSnapshot);
		const generalRow = general.rows.find((row) => row.model.name === 'C-Tianyu/NanoJev');
		const legalRow = legal.rows.find((row) => row.model.name === 'C-Tianyu/NanoJev');

		// The general suite subtracts the reasoning view, so NLL can be
		// row-weighted but ECE cannot be reconstructed from aggregate bins.
		expect(generalRow?.meanNegativeLogLikelihood).toBeTypeOf('number');
		expect(generalRow?.expectedCalibrationError).toBeNull();
		// A direct domain suite uses one intact view and can expose both.
		expect(legalRow?.meanNegativeLogLikelihood).toBeTypeOf('number');
		expect(legalRow?.expectedCalibrationError).toBeTypeOf('number');
		expect(legalRow?.meanTask).toBe(legalRow?.scoresByTaskType.Decision);
	});

	it('publishes every exported domain as both a task view and a domain suite card', async () => {
		const tasks = await loadTasks({}, fetchSnapshot);
		const exportedDomains = [
			...new Set(
				rows
					.filter((row) => row.view_kind === 'domain')
					.map(
						(row) =>
							`Domain: ${row.view_name
								.split('_')
								.map((part: string) => part[0].toUpperCase() + part.slice(1))
								.join(' ')}`
					)
			)
		].sort();
		const publishedDomains = tasks
			.filter((task) => task.type === 'Domain')
			.map((task) => task.name)
			.sort();

		expect(exportedDomains).toHaveLength(28);
		expect(publishedDomains).toEqual(exportedDomains);
		expect(tasks).toHaveLength(52);
		expect(tasks.some((task) => task.name.startsWith('Primitive:'))).toBe(false);
		expect(tasks.some((task) => task.name.startsWith('Candidate Count:'))).toBe(false);
		expect(tasks.map((task) => task.name)).toContain('Domain: Legal');
		const domainBenchmarks = (await loadBenchmarks(fetchSnapshot)).filter(
			(benchmark) => benchmark.domains.length === 1
		);
		expect(domainBenchmarks).toHaveLength(28);
		expect(domainBenchmarks.map((benchmark) => benchmark.name)).toContain(
			'DecisionBench(Legal, eng, v1)'
		);
	});

	it('shows specific descriptions for every task tooltip and task detail page', async () => {
		const tasks = await loadTasks({}, fetchSnapshot);
		const general = await loadSummary('DecisionBench(eng, v1)', undefined, fetchSnapshot);
		const legal = catalog.benchmarks.find((benchmark) => benchmark.score.view === 'domain:legal');

		expect(tasks).toHaveLength(52);
		expect(tasks.every((task) => task.description.length > 40)).toBe(true);
		expect(tasks.some((task) => task.description.includes('DecisionBench domain slice'))).toBe(
			false
		);
		expect(tasks.find((task) => task.name === 'Domain: Legal')?.description).toBe(
			legal?.description
		);
		expect(general.tasksMeta.find((task) => task.name === 'Family: Routing')?.description).toBe(
			catalog.viewDescriptions['family:routing']
		);
	});
});
