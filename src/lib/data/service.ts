import { base } from '$app/paths';
import type {
	Benchmark,
	BenchmarkLeaders,
	BenchmarkPerLanguage,
	BenchmarkSummary,
	BucketLeader,
	MenuEntry,
	ModelFilters,
	ModelMeta,
	ModelScores,
	SummaryRow,
	TaskDescriptiveStats,
	TaskFilters,
	TaskMeta,
	TaskScores
} from '$lib/types';

interface LeaderboardRow {
	model: string;
	revision: string;
	model_url: string | null;
	adapter: string;
	probability_source: string;
	open_weights: boolean | null;
	parameter_count: number | null;
	benchmark: string;
	benchmark_version: string;
	dataset_revision: string;
	view: string;
	view_kind: string;
	view_name: string;
	requested_rows: number | null;
	successful_rows: number;
	unsupported_rows: number | null;
	error_rows: number | null;
	coverage: number | null;
	primary_accuracy: number | null;
	supported_accuracy: number | null;
	mean_negative_log_likelihood: number | null;
	expected_calibration_error: number | null;
	mean_latency_seconds: number | null;
	artifact_uri: string;
	artifact_manifest_sha256: string;
	result_path: string;
}

interface ViewDefinition {
	key: string;
	kind: 'benchmark' | 'primitive' | 'family' | 'domain' | 'candidate_count';
	name: string;
	benchmarkName: string;
	displayName: string;
}

type FetchFn = typeof globalThis.fetch;

const DATA_URL = `${base}/leaderboard.json`;
const RESULTS_REPOSITORY = 'https://github.com/Hanno-Labs/decision-bench-results';
const BENCHMARK_REPOSITORY = 'https://github.com/Hanno-Labs/decision-bench';

let rowsPromise: Promise<LeaderboardRow[]> | null = null;

export class HttpError extends Error {
	constructor(
		public status: number,
		public statusText: string,
		public path: string
	) {
		super(`${status} ${statusText} — ${path}`);
		this.name = 'HttpError';
	}
}

function titleCase(value: string): string {
	return value
		.split('_')
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join(' ');
}

function displayViewName(kind: string, name: string): string {
	if (kind === 'primitive') {
		if (name === 'binary_classification') return 'Boolean / Noul';
		if (name === 'candidate_selection') return 'Choice';
		if (name === 'ordinal_scoring') return 'Ordered Score';
	}
	if (kind === 'candidate_count') return `${name} candidates`;
	return titleCase(name);
}

async function loadRows(fetchFn: FetchFn = globalThis.fetch): Promise<LeaderboardRow[]> {
	if (!rowsPromise) {
		rowsPromise = fetchFn(DATA_URL).then(async (response) => {
			if (!response.ok) throw new HttpError(response.status, response.statusText, DATA_URL);
			const value = (await response.json()) as unknown;
			if (!Array.isArray(value)) throw new Error('leaderboard.json must contain an array');
			return value as LeaderboardRow[];
		});
	}
	return rowsPromise;
}

function unique<T>(values: Iterable<T>): T[] {
	return [...new Set(values)];
}

function scoreOf(row: LeaderboardRow | undefined): number | null {
	if (!row) return null;
	return row.view === 'overall' ? row.primary_accuracy : row.supported_accuracy;
}

function viewDefinitions(rows: readonly LeaderboardRow[]): ViewDefinition[] {
	const definitions: ViewDefinition[] = [
		{
			key: 'overall',
			kind: 'benchmark',
			name: 'overall',
			benchmarkName: 'DecisionBench',
			displayName: 'DecisionBench'
		}
	];
	for (const kind of ['primitive', 'family', 'domain', 'candidate_count'] as const) {
		const names = unique(
			rows.filter((row) => row.view_kind === kind).map((row) => row.view_name)
		).sort();
		for (const name of names) {
			const displayName = displayViewName(kind, name);
			definitions.push({
				key: `${kind}:${name}`,
				kind,
				name,
				benchmarkName: `DecisionBench / ${titleCase(kind)} / ${displayName}`,
				displayName
			});
		}
	}
	return definitions;
}

function taskName(kind: string, name: string): string {
	return `${titleCase(kind)}: ${displayViewName(kind, name)}`;
}

function taskMeta(kind: string, name: string, rows: readonly LeaderboardRow[]): TaskMeta {
	const key = `${kind}:${name}`;
	const rowCount = rows.find((row) => row.view === key)?.successful_rows ?? 0;
	const modelCount = new Set(rows.filter((row) => row.view === key).map((row) => row.model)).size;
	return {
		name: taskName(kind, name),
		type: titleCase(kind),
		simplifiedType: kind,
		languages: ['English'],
		domains: kind === 'domain' ? [displayViewName(kind, name)] : [],
		modalities: ['text'],
		description:
			kind === 'candidate_count'
				? `Decision quality on rows with exactly ${name} candidates.`
				: `DecisionBench ${kind} slice for ${displayViewName(kind, name)}.`,
		reference: BENCHMARK_REPOSITORY,
		citation: null,
		isPublic: false,
		sourceDataset: 'Hanno-Labs/decision-bench',
		license: null,
		dateFrom: null,
		dateTo: null,
		annotationsCreators: 'derived',
		dialect: null,
		sampleCreation: `${rowCount.toLocaleString()} successfully scored rows in the reviewed result record.`,
		mainScore: 'accuracy',
		numModels: modelCount
	};
}

function allTaskMeta(rows: readonly LeaderboardRow[]): TaskMeta[] {
	const pairs = unique(rows.filter((row) => row.view !== 'overall').map((row) => row.view));
	return pairs
		.map((key) => {
			const [kind, ...rest] = key.split(':');
			return taskMeta(kind, rest.join(':'), rows);
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

function modelType(row: LeaderboardRow): ModelMeta['modelType'] {
	if (row.open_weights === false) return 'api';
	if (/deberta/i.test(row.model) || /deberta/i.test(row.adapter)) return 'classifier';
	if (/qwen|bosun|jev|nimble|scorer/i.test(`${row.model} ${row.adapter}`)) return 'language-model';
	return 'decision-model';
}

function toModelMeta(row: LeaderboardRow): ModelMeta {
	const separator = row.model.indexOf('/');
	const org = separator >= 0 ? row.model.slice(0, separator) : '';
	const displayName = separator >= 0 ? row.model.slice(separator + 1) : row.model;
	const paramsB = row.parameter_count == null ? null : row.parameter_count / 1_000_000_000;
	const openWeights = row.open_weights === true;
	return {
		name: row.model,
		displayName,
		org,
		url: row.model_url ?? undefined,
		zeroShotPct: 100,
		activeParamsB: paramsB,
		totalParamsB: paramsB,
		embeddingDim: null,
		maxTokens: null,
		modelType: modelType(row),
		instructionTuned: /qwen|bosun|jev|nimble|gpt|luna/i.test(`${row.model} ${row.adapter}`),
		openWeights,
		openness: {
			'open weights': openWeights,
			'open license': openWeights,
			'open training code': false,
			'open training data': false,
			paper: false,
			'model card': Boolean(row.model_url)
		},
		opennessScore: openWeights ? 3 : 1,
		sentenceTransformersCompatible: false,
		modalities: ['text'],
		languages: ['English'],
		citation: null,
		memoryUsageMb: null,
		license: null,
		publicTrainingCode: null,
		publicTrainingData: null,
		adaptedFrom: null,
		supersededBy: null,
		extraRequirementsGroups: null,
		trainingDatasets: []
	};
}

function rowsByModel(rows: readonly LeaderboardRow[]): Map<string, LeaderboardRow[]> {
	const grouped = new Map<string, LeaderboardRow[]>();
	for (const row of rows) {
		const list = grouped.get(row.model) ?? [];
		list.push(row);
		grouped.set(row.model, list);
	}
	return grouped;
}

function benchmarkFor(definition: ViewDefinition, rows: readonly LeaderboardRow[]): Benchmark {
	const allFamilies = unique(
		rows.filter((row) => row.view_kind === 'family').map((row) => row.view_name)
	);
	const allDomains = unique(
		rows.filter((row) => row.view_kind === 'domain').map((row) => row.view_name)
	);
	const allPrimitives = unique(
		rows.filter((row) => row.view_kind === 'primitive').map((row) => row.view_name)
	);
	const tasks =
		definition.kind === 'benchmark'
			? allFamilies.map((name) => taskName('family', name)).sort()
			: [taskName(definition.kind, definition.name)];
	const taskTypes =
		definition.kind === 'benchmark'
			? allPrimitives.map((name) => displayViewName('primitive', name)).sort()
			: [titleCase(definition.kind)];
	const modelCount = new Set(
		rows
			.filter((row) => row.view === definition.key && scoreOf(row) != null)
			.map((row) => row.model)
	).size;
	const scope = definition.kind === 'benchmark' ? 'the full benchmark' : definition.displayName;
	return {
		name: definition.benchmarkName,
		displayName: definition.displayName,
		icon:
			definition.kind === 'benchmark'
				? '◈'
				: definition.kind === 'primitive'
					? '◆'
					: definition.kind === 'family'
						? '◇'
						: '○',
		description: `Reviewed DecisionBench results for ${scope}. Unsupported and error rows count as misses in the full-benchmark primary score.`,
		reference: RESULTS_REPOSITORY,
		citation: undefined,
		languages: ['English'],
		taskTypes,
		simplifiedTaskTypes: definition.kind === 'benchmark' ? ['decision'] : [definition.kind],
		tasks,
		domains:
			definition.kind === 'domain'
				? [definition.displayName]
				: definition.kind === 'benchmark'
					? allDomains.map((name) => displayViewName('domain', name)).sort()
					: [],
		modalities: ['text'],
		displayOnLeaderboard: true,
		newVersion: null,
		aggregations: definition.kind === 'benchmark' ? ['mean_task', 'task_types'] : ['mean_task'],
		showZeroShot: false,
		numModels: modelCount,
		languageView: null
	};
}

function definitionForBenchmark(name: string, rows: readonly LeaderboardRow[]): ViewDefinition {
	const definition = viewDefinitions(rows).find((item) => item.benchmarkName === name);
	if (!definition) throw new HttpError(404, 'Not Found', name);
	return definition;
}

function summaryFor(definition: ViewDefinition, rows: readonly LeaderboardRow[]): BenchmarkSummary {
	const grouped = rowsByModel(rows);
	const familyNames = unique(
		rows.filter((row) => row.view_kind === 'family').map((row) => row.view_name)
	);
	const primitiveNames = unique(
		rows.filter((row) => row.view_kind === 'primitive').map((row) => row.view_name)
	);
	const taskNames =
		definition.kind === 'benchmark'
			? familyNames.map((name) => taskName('family', name)).sort()
			: [taskName(definition.kind, definition.name)];
	const taskTypes =
		definition.kind === 'benchmark'
			? primitiveNames.map((name) => displayViewName('primitive', name)).sort()
			: [titleCase(definition.kind)];
	const summaryRows: SummaryRow[] = [];
	for (const modelRows of grouped.values()) {
		const current = modelRows.find((row) => row.view === definition.key);
		const score = scoreOf(current);
		if (!current || score == null) continue;
		const scoresByTask: Record<string, number> = {};
		if (definition.kind === 'benchmark') {
			for (const name of familyNames) {
				const value = scoreOf(modelRows.find((row) => row.view === `family:${name}`));
				if (value != null) scoresByTask[taskName('family', name)] = value;
			}
		} else {
			scoresByTask[taskName(definition.kind, definition.name)] = score;
		}
		const scoresByTaskType: Record<string, number> = {};
		if (definition.kind === 'benchmark') {
			for (const name of primitiveNames) {
				const value = scoreOf(modelRows.find((row) => row.view === `primitive:${name}`));
				if (value != null) scoresByTaskType[displayViewName('primitive', name)] = value;
			}
		} else {
			scoresByTaskType[titleCase(definition.kind)] = score;
		}
		const model = toModelMeta(current);
		summaryRows.push({
			rank: 0,
			model,
			zeroShotPct: 100,
			activeParamsB: model.activeParamsB,
			totalParamsB: model.totalParamsB,
			embeddingDim: null,
			maxTokens: null,
			meanTask: score,
			meanTaskType: score,
			scoresByTaskType,
			scoresByTask,
			trainedOnTasks: [],
			experiments: null
		});
	}
	summaryRows.sort((a, b) => (b.meanTask ?? -1) - (a.meanTask ?? -1));
	summaryRows.forEach((row, index) => (row.rank = index + 1));
	const tasksMeta = taskNames.map((name) => {
		const [kindLabel, ...rest] = name.split(': ');
		const kind = kindLabel.toLowerCase();
		const display = rest.join(': ');
		const rawName =
			rows.find((row) => row.view_kind === kind && displayViewName(kind, row.view_name) === display)
				?.view_name ?? display.toLowerCase().replaceAll(' ', '_');
		return taskMeta(kind, rawName, rows);
	});
	return {
		benchmarkName: definition.benchmarkName,
		taskTypes,
		tasks: taskNames,
		tasksMeta,
		rows: summaryRows,
		aggregations: definition.kind === 'benchmark' ? ['mean_task', 'task_types'] : ['mean_task'],
		showZeroShot: false
	};
}

export async function loadBenchmarkMenu(fetchFn?: FetchFn): Promise<MenuEntry[]> {
	const rows = await loadRows(fetchFn);
	const definitions = viewDefinitions(rows);
	const section = (name: string, kind: ViewDefinition['kind']): MenuEntry => ({
		name,
		open: kind === 'benchmark' || kind === 'primitive',
		children: definitions
			.filter((definition) => definition.kind === kind)
			.map((definition) => benchmarkFor(definition, rows))
	});
	return [
		section('Primary benchmark', 'benchmark'),
		section('Decision primitives', 'primitive'),
		section('Application families', 'family'),
		section('Domains', 'domain'),
		section('Candidate counts', 'candidate_count')
	];
}

export async function loadBenchmarks(fetchFn?: FetchFn): Promise<Benchmark[]> {
	const rows = await loadRows(fetchFn);
	return viewDefinitions(rows).map((definition) => benchmarkFor(definition, rows));
}

export async function loadBenchmark(name: string, fetchFn?: FetchFn): Promise<Benchmark> {
	const rows = await loadRows(fetchFn);
	return benchmarkFor(definitionForBenchmark(name, rows), rows);
}

export function primeBenchmarkCache(name: string, value: Benchmark): void {
	// The single immutable JSON snapshot is already request-deduplicated.
	void name;
	void value;
}

export async function loadSummary(
	benchmarkName: string,
	_languages?: ReadonlyArray<string>,
	fetchFn?: FetchFn
): Promise<BenchmarkSummary> {
	const rows = await loadRows(fetchFn);
	return summaryFor(definitionForBenchmark(benchmarkName, rows), rows);
}

export async function loadPerLanguage(
	benchmarkName: string,
	fetchFn?: FetchFn
): Promise<BenchmarkPerLanguage> {
	void fetchFn;
	return { benchmarkName, rows: [] };
}

export async function loadLeaders(
	benchmarkName: string,
	buckets: ReadonlyArray<readonly [number, number | null]>,
	fetchFn?: FetchFn
): Promise<BenchmarkLeaders> {
	const rows = await loadRows(fetchFn);
	const summary = summaryFor(definitionForBenchmark(benchmarkName, rows), rows);
	const leaders: BucketLeader[] = buckets.map(([min, max], index) => {
		const row = summary.rows[index];
		return {
			min,
			max,
			leader: row
				? {
						rank: row.rank,
						model: { name: row.model.name, modelType: row.model.modelType },
						meanTask: row.meanTask,
						totalParamsB: row.totalParamsB
					}
				: null
		};
	});
	return { benchmarkName, buckets: leaders };
}

export async function loadTasks(filters: TaskFilters = {}, fetchFn?: FetchFn): Promise<TaskMeta[]> {
	const rows = await loadRows(fetchFn);
	let tasks = allTaskMeta(rows);
	if (filters.name) {
		const query = filters.name.toLowerCase();
		tasks = tasks.filter((task) => task.name.toLowerCase().includes(query));
	}
	if (filters.types?.length) tasks = tasks.filter((task) => filters.types!.includes(task.type));
	if (filters.domains?.length)
		tasks = tasks.filter((task) =>
			task.domains.some((domain) => filters.domains!.includes(domain))
		);
	return tasks;
}

export async function loadTask(name: string, fetchFn?: FetchFn): Promise<TaskMeta> {
	const tasks = await loadTasks({}, fetchFn);
	const task = tasks.find((item) => item.name === name);
	if (!task) throw new HttpError(404, 'Not Found', name);
	return task;
}

export async function loadTaskScores(name: string, fetchFn?: FetchFn): Promise<TaskScores> {
	const rows = await loadRows(fetchFn);
	const task = await loadTask(name, fetchFn);
	const [kindLabel, ...displayParts] = name.split(': ');
	const kind = kindLabel.toLowerCase();
	const display = displayParts.join(': ');
	const rawName =
		rows.find((row) => row.view_kind === kind && displayViewName(kind, row.view_name) === display)
			?.view_name ?? display.toLowerCase().replaceAll(' ', '_');
	const view = `${kind}:${rawName}`;
	const matching = rows
		.filter((row) => row.view === view && scoreOf(row) != null)
		.sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1));
	return {
		task,
		benchmarks: [`DecisionBench / ${titleCase(kind)} / ${display}`],
		subsets: ['default'],
		splits: ['test'],
		rows: matching.map((row, index) => ({
			rank: index + 1,
			model: toModelMeta(row),
			score: scoreOf(row),
			subsetScores: { default: { test: scoreOf(row) ?? 0 } },
			benchmarks: [`DecisionBench / ${titleCase(kind)} / ${display}`],
			trainedOn: null
		}))
	};
}

export async function loadTaskDescriptiveStats(
	name: string,
	fetchFn?: FetchFn
): Promise<TaskDescriptiveStats> {
	void name;
	void fetchFn;
	return {};
}

export async function loadModels(
	filters: ModelFilters = {},
	fetchFn?: FetchFn
): Promise<ModelMeta[]> {
	const rows = await loadRows(fetchFn);
	const firstByModel = new Map<string, LeaderboardRow>();
	for (const row of rows) if (!firstByModel.has(row.model)) firstByModel.set(row.model, row);
	let models = [...firstByModel.values()].map(toModelMeta);
	if (filters.name) {
		const query = filters.name.toLowerCase();
		models = models.filter((model) => model.name.toLowerCase().includes(query));
	}
	if (filters.openWeights != null)
		models = models.filter((model) => model.openWeights === filters.openWeights);
	if (filters.modelTypes?.length)
		models = models.filter((model) => filters.modelTypes!.includes(model.modelType));
	return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadModel(name: string, fetchFn?: FetchFn): Promise<ModelMeta> {
	const models = await loadModels({}, fetchFn);
	const model = models.find((item) => item.name === name);
	if (!model) throw new HttpError(404, 'Not Found', name);
	return model;
}

export async function loadModelScores(name: string, fetchFn?: FetchFn): Promise<ModelScores> {
	const rows = await loadRows(fetchFn);
	const model = await loadModel(name, fetchFn);
	const resultRows = [];
	for (const definition of viewDefinitions(rows)) {
		const summary = summaryFor(definition, rows);
		const row = summary.rows.find((item) => item.model.name === name);
		if (!row) continue;
		resultRows.push({
			benchmarkName: definition.benchmarkName,
			benchmarkDisplayName: definition.displayName,
			rank: row.rank,
			totalModels: summary.rows.length,
			meanTask: row.meanTask,
			meanTaskType: row.meanTaskType,
			zeroShotPct: 100,
			taskTypes: summary.taskTypes,
			scoresByTaskType: row.scoresByTaskType
		});
	}
	return { model, rows: resultRows };
}
