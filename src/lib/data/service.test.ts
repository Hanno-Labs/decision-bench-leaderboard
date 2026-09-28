import { describe, expect, it, vi } from 'vitest';
import catalog from '../../../static/benchmark-catalog.json';
import rows from '../../../static/leaderboard.json';
import {
	loadBenchmarkMenu,
	loadBenchmarks,
	loadFeaturedBenchmarks,
	loadSummary,
	loadTasks,
	toModelMeta
} from './service';

const fetchSnapshot: typeof globalThis.fetch = async (input) => {
	const url = String(input);
	if (url.endsWith('/leaderboard.json')) return Response.json(rows);
	if (url.endsWith('/benchmark-catalog.json')) return Response.json(catalog);
	return new Response(null, { status: 404, statusText: 'Not Found' });
};

describe('data-driven benchmark catalog', () => {
	it('uses reviewed model type and base model for wrapped language models', () => {
		const wrapper = toModelMeta({
			...rows[0],
			model: 'ekzhang/openjev-sglang',
			model_type: 'language-model',
			model_url: 'https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4',
			open_weights: true
		});
		const native = toModelMeta({
			...rows[0],
			model: 'Hanno-Labs/bosun-v3.1-0.6b',
			model_type: 'decision-model',
			model_url: 'https://huggingface.co/Hanno-Labs/bosun-v3.1-0.6b',
			open_weights: true
		});
		expect(wrapper.modelType).toBe('language-model');
		expect(wrapper.baseModel).toBe('nvidia/Qwen3.6-35B-A3B-NVFP4');
		expect(native.modelType).toBe('decision-model');
		expect(native.baseModel).toBeUndefined();
	});
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

	it('uses the full domain row count when the catalog count is stale', async () => {
		const coding = await loadSummary(
			'DecisionBench(Coding Agents, eng, v1)',
			undefined,
			fetchSnapshot
		);
		const multiHop = await loadSummary(
			'DecisionBench(Multi Hop Search, eng, v1)',
			undefined,
			fetchSnapshot
		);
		const codingScore = coding.rows.find((row) => row.model.name === 'typesafe/jev-1.13');
		const multiHopScore = multiHop.rows.find((row) => row.model.name === 'typesafe/jev-1.13');

		expect(codingScore?.meanTask).toBeCloseTo(196 / 300, 12);
		expect(multiHopScore?.meanTask).toBeCloseTo(395 / 600, 12);
		expect(codingScore?.meanTask).toBeLessThanOrEqual(1);
		expect(multiHopScore?.meanTask).toBeLessThanOrEqual(1);
	});

	it('keeps every domain score within the accuracy range', async () => {
		for (const benchmark of catalog.benchmarks.filter((item) =>
			item.score.view.startsWith('domain:')
		)) {
			const summary = await loadSummary(benchmark.name, undefined, fetchSnapshot);
			for (const row of summary.rows) {
				expect(row.meanTask, `${benchmark.name}: ${row.model.name}`).toBeGreaterThanOrEqual(0);
				expect(row.meanTask, `${benchmark.name}: ${row.model.name}`).toBeLessThanOrEqual(1);
			}
		}
	});

	it('keeps compact and untagged results for one model as separate leaderboard rows', async () => {
		const modelName = 'C-Tianyu/NanoJev';
		const compactRows = rows
			.filter((row) => row.model === modelName)
			.map((row) => ({ ...row, tags: 'compact' }));
		const fetchWithCompact: typeof globalThis.fetch = async (input) => {
			const url = String(input);
			if (url.endsWith('/leaderboard.json')) return Response.json([...rows, ...compactRows]);
			if (url.endsWith('/benchmark-catalog.json')) return Response.json(catalog);
			return new Response(null, { status: 404, statusText: 'Not Found' });
		};
		const baseline = await loadSummary('DecisionBench(eng, v1)', undefined, fetchSnapshot);
		vi.resetModules();
		const { loadSummary: loadFreshSummary, loadBenchmarks: loadFreshBenchmarks } =
			await import('./service');
		const tagged = await loadFreshSummary('DecisionBench(eng, v1)', undefined, fetchWithCompact);
		const baselineCount = (await loadBenchmarks(fetchSnapshot)).find(
			(benchmark) => benchmark.name === 'DecisionBench(eng, v1)'
		)?.numModels;
		const taggedCount = (await loadFreshBenchmarks(fetchWithCompact)).find(
			(benchmark) => benchmark.name === 'DecisionBench(eng, v1)'
		)?.numModels;
		const matches = tagged.rows.filter((row) => row.model.name === modelName);
		expect(matches).toHaveLength(2);
		expect(matches.map((row) => row.tags).sort()).toEqual(['', 'compact']);
		expect(new Set(matches.map((row) => row.resultKey)).size).toBe(2);
		const task = await (
			await import('./service')
		).loadTaskScores('Family: Routing', fetchWithCompact);
		const taskMatches = task.rows.filter((row) => row.model.name === modelName);
		expect(taskMatches).toHaveLength(2);
		expect(new Set(taskMatches.map((row) => row.resultKey)).size).toBe(2);
		expect(matches[0].meanTask).toBe(matches[1].meanTask);
		expect(tagged.rows).toHaveLength(baseline.rows.length + 1);
		expect(taggedCount).toBe(baselineCount);
	});

	it('shows only the latest revision of a model in benchmark and task rankings', async () => {
		const modelName = 'C-Tianyu/NanoJev';
		const originalRows = rows.filter((row) => row.model === modelName);
		const earlierRows = originalRows.map((row) => ({
			...row,
			submitted_at: '2026-09-26T14:03:12Z'
		}));
		const laterRows = originalRows.map((row) => ({
			...row,
			revision: 'later-revision',
			submitted_at: '2026-09-26T14:05:41Z',
			...(row.view === 'family:routing' ? { supported_accuracy: 0.9 } : {})
		}));
		const fetchWithRevisions: typeof globalThis.fetch = async (input) => {
			const url = String(input);
			if (url.endsWith('/leaderboard.json'))
				return Response.json([
					...rows.filter((row) => row.model !== modelName),
					...earlierRows,
					...laterRows
				]);
			if (url.endsWith('/benchmark-catalog.json')) return Response.json(catalog);
			return new Response(null, { status: 404, statusText: 'Not Found' });
		};

		vi.resetModules();
		const { loadSummary: loadFreshSummary, loadTaskScores: loadFreshTaskScores } =
			await import('./service');
		const summary = await loadFreshSummary('DecisionBench(eng, v1)', undefined, fetchWithRevisions);
		const summaryRows = summary.rows.filter((row) => row.model.name === modelName);
		expect(summaryRows).toHaveLength(1);
		expect(summaryRows[0].resultKey).toContain('later-revision');

		const task = await loadFreshTaskScores('Family: Routing', fetchWithRevisions);
		const taskRows = task.rows.filter((row) => row.model.name === modelName);
		expect(taskRows).toHaveLength(1);
		expect(taskRows[0].score).toBe(0.9);
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
