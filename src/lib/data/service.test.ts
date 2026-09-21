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
	it('exposes only explicit suites and never promotes analysis slices to benchmark cards', async () => {
		const benchmarks = await loadBenchmarks(fetchSnapshot);
		expect(benchmarks.map((benchmark) => benchmark.name)).toEqual([
			'DecisionBench(eng, v1)',
			'DecisionBench(Legal, eng, v1)',
			'DecisionBench(Reasoning, eng, v1)'
		]);
		expect(benchmarks.some((benchmark) => benchmark.name.includes(' / '))).toBe(false);
		expect((await loadBenchmarkMenu(fetchSnapshot)).map((section) => section.name)).toEqual([
			'General Purpose',
			'Domain-Specific',
			'Reasoning'
		]);
		expect((await loadFeaturedBenchmarks(fetchSnapshot)).map((item) => item.preferred)).toEqual(
			benchmarks.map((benchmark) => benchmark.name)
		);
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

	it('publishes only suite members as tasks', async () => {
		const tasks = await loadTasks({}, fetchSnapshot);
		expect(tasks).toHaveLength(25);
		expect(tasks.some((task) => task.name.startsWith('Primitive:'))).toBe(false);
		expect(tasks.some((task) => task.name.startsWith('Candidate Count:'))).toBe(false);
		expect(tasks.map((task) => task.name)).toContain('Domain: Legal');
	});
});
