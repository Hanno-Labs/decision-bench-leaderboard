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

interface ScoreExclusion {
	view: string;
	expectedRows: number;
}

interface SuiteScoreDefinition {
	view: string;
	expectedRows?: number;
	exclude?: ScoreExclusion[];
}

interface FeaturedDefinition {
	key: string;
	label: string;
	order: number;
}

interface CatalogBenchmark {
	name: string;
	displayName: string;
	description: string;
	icon?: string;
	languages: string[];
	domains: string[];
	modalities: string[];
	score: SuiteScoreDefinition;
	taskViews: string[];
	featured?: FeaturedDefinition;
}

interface CatalogSection {
	name: string;
	open?: boolean;
	benchmarks: string[];
}

interface BenchmarkCatalog {
	sections: CatalogSection[];
	benchmarks: CatalogBenchmark[];
}

export interface FeaturedBenchmark {
	key: string;
	label: string;
	preferred: string;
}

type FetchFn = typeof globalThis.fetch;

const DATA_URL = `${base}/leaderboard.json`;
const CATALOG_URL = `${base}/benchmark-catalog.json`;
const RESULTS_REPOSITORY = 'https://github.com/Hanno-Labs/decision-bench-results';
const BENCHMARK_REPOSITORY = 'https://github.com/Hanno-Labs/decision-bench';

let rowsPromise: Promise<LeaderboardRow[]> | null = null;
let catalogPromise: Promise<BenchmarkCatalog> | null = null;

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

async function loadCatalog(fetchFn: FetchFn = globalThis.fetch): Promise<BenchmarkCatalog> {
	if (!catalogPromise) {
		catalogPromise = fetchFn(CATALOG_URL).then(async (response) => {
			if (!response.ok) throw new HttpError(response.status, response.statusText, CATALOG_URL);
			const value = (await response.json()) as Partial<BenchmarkCatalog>;
			if (!Array.isArray(value.sections) || !Array.isArray(value.benchmarks)) {
				throw new Error('benchmark-catalog.json must contain sections and benchmarks arrays');
			}
			return value as BenchmarkCatalog;
		});
	}
	return catalogPromise;
}

function unique<T>(values: Iterable<T>): T[] {
	return [...new Set(values)];
}

function viewScoreOf(row: LeaderboardRow | undefined): number | null {
	if (!row) return null;
	return row.view === 'overall' ? row.primary_accuracy : row.supported_accuracy;
}

function correctRows(row: LeaderboardRow): number | null {
	if (row.primary_accuracy != null && row.requested_rows != null) {
		return row.primary_accuracy * row.requested_rows;
	}
	if (row.supported_accuracy != null) return row.supported_accuracy * row.successful_rows;
	return null;
}

function weightedMetric(
	base: LeaderboardRow,
	exclusions: readonly LeaderboardRow[],
	metric: 'mean_negative_log_likelihood' | 'mean_latency_seconds',
	successfulRows: number
): number | null {
	const baseValue = base[metric];
	if (baseValue == null || successfulRows <= 0) return null;
	let total = baseValue * base.successful_rows;
	for (const row of exclusions) {
		const value = row[metric];
		if (value == null) return null;
		total -= value * row.successful_rows;
	}
	return total / successfulRows;
}

function suiteRow(
	definition: CatalogBenchmark,
	modelRows: readonly LeaderboardRow[]
): LeaderboardRow | undefined {
	const baseRow = modelRows.find((row) => row.view === definition.score.view);
	if (!baseRow) return undefined;
	const baseCorrect = correctRows(baseRow);
	if (baseCorrect == null) return undefined;

	const exclusionRows = (definition.score.exclude ?? [])
		.map((exclusion) => modelRows.find((row) => row.view === exclusion.view))
		.filter((row): row is LeaderboardRow => row !== undefined);
	if (exclusionRows.length !== (definition.score.exclude?.length ?? 0)) return undefined;

	const baseRequested =
		definition.score.expectedRows ?? baseRow.requested_rows ?? baseRow.successful_rows;
	const excludedRequested = (definition.score.exclude ?? []).reduce(
		(total, exclusion) => total + exclusion.expectedRows,
		0
	);
	const requestedRows = baseRequested - excludedRequested;
	const successfulRows =
		baseRow.successful_rows - exclusionRows.reduce((total, row) => total + row.successful_rows, 0);
	const correct =
		baseCorrect - exclusionRows.reduce((total, row) => total + (correctRows(row) ?? 0), 0);
	if (requestedRows <= 0 || successfulRows < 0 || correct < 0) return undefined;

	const errorRows = baseRow.error_rows ?? 0;
	const unsupportedRows = Math.max(0, requestedRows - successfulRows - errorRows);
	return {
		...baseRow,
		view: `suite:${definition.name}`,
		view_kind: 'suite',
		view_name: definition.name,
		requested_rows: requestedRows,
		successful_rows: successfulRows,
		unsupported_rows: unsupportedRows,
		error_rows: errorRows,
		coverage: successfulRows / requestedRows,
		primary_accuracy: correct / requestedRows,
		supported_accuracy: successfulRows > 0 ? correct / successfulRows : null,
		mean_negative_log_likelihood: weightedMetric(
			baseRow,
			exclusionRows,
			'mean_negative_log_likelihood',
			successfulRows
		),
		expected_calibration_error:
			exclusionRows.length === 0 ? baseRow.expected_calibration_error : null,
		mean_latency_seconds: weightedMetric(
			baseRow,
			exclusionRows,
			'mean_latency_seconds',
			successfulRows
		)
	};
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

function catalogTaskViews(catalog: BenchmarkCatalog): string[] {
	return unique(catalog.benchmarks.flatMap((benchmark) => benchmark.taskViews));
}

function allTaskMeta(rows: readonly LeaderboardRow[], catalog: BenchmarkCatalog): TaskMeta[] {
	return catalogTaskViews(catalog)
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

function benchmarkFor(definition: CatalogBenchmark, rows: readonly LeaderboardRow[]): Benchmark {
	const modelCount = [...rowsByModel(rows).values()].filter(
		(modelRows) => suiteRow(definition, modelRows)?.primary_accuracy != null
	).length;
	return {
		name: definition.name,
		displayName: definition.displayName,
		icon: definition.icon,
		description: definition.description,
		reference: RESULTS_REPOSITORY,
		citation: undefined,
		languages: definition.languages,
		taskTypes: ['Decision'],
		simplifiedTaskTypes: ['decision'],
		tasks: definition.taskViews
			.map((view) => {
				const [kind, ...name] = view.split(':');
				return taskName(kind, name.join(':'));
			})
			.sort(),
		domains: definition.domains,
		modalities: definition.modalities,
		displayOnLeaderboard: true,
		newVersion: null,
		aggregations: ['mean_task'],
		showZeroShot: false,
		numModels: modelCount,
		languageView: null
	};
}

function definitionForBenchmark(name: string, catalog: BenchmarkCatalog): CatalogBenchmark {
	const definition = catalog.benchmarks.find((item) => item.name === name);
	if (!definition) throw new HttpError(404, 'Not Found', name);
	return definition;
}

function summaryFor(
	definition: CatalogBenchmark,
	rows: readonly LeaderboardRow[]
): BenchmarkSummary {
	const grouped = rowsByModel(rows);
	const taskNames = definition.taskViews
		.map((view) => {
			const [kind, ...name] = view.split(':');
			return taskName(kind, name.join(':'));
		})
		.sort();
	const taskTypes = ['Decision'];
	const summaryRows: SummaryRow[] = [];
	for (const modelRows of grouped.values()) {
		const current = suiteRow(definition, modelRows);
		const score = current?.primary_accuracy ?? null;
		if (!current || score == null) continue;
		const scoresByTask: Record<string, number> = {};
		for (const view of definition.taskViews) {
			const row = modelRows.find((candidate) => candidate.view === view);
			const value = viewScoreOf(row);
			if (value == null) continue;
			const [kind, ...name] = view.split(':');
			scoresByTask[taskName(kind, name.join(':'))] = value;
		}
		const scoresByTaskType = { Decision: score };
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
			expectedCalibrationError: current.expected_calibration_error,
			meanNegativeLogLikelihood: current.mean_negative_log_likelihood,
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
		benchmarkName: definition.name,
		taskTypes,
		tasks: taskNames,
		tasksMeta,
		rows: summaryRows,
		aggregations: ['mean_task'],
		showZeroShot: false
	};
}

export async function loadBenchmarkMenu(fetchFn?: FetchFn): Promise<MenuEntry[]> {
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	const byName = new Map(catalog.benchmarks.map((definition) => [definition.name, definition]));
	return catalog.sections.map((section) => ({
		name: section.name,
		open: section.open,
		children: section.benchmarks.map((name) => {
			const definition = byName.get(name);
			if (!definition) throw new Error(`Unknown benchmark in catalog section: ${name}`);
			return benchmarkFor(definition, rows);
		})
	}));
}

export async function loadBenchmarks(fetchFn?: FetchFn): Promise<Benchmark[]> {
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	return catalog.benchmarks.map((definition) => benchmarkFor(definition, rows));
}

export async function loadBenchmark(name: string, fetchFn?: FetchFn): Promise<Benchmark> {
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	return benchmarkFor(definitionForBenchmark(name, catalog), rows);
}

export async function loadFeaturedBenchmarks(fetchFn?: FetchFn): Promise<FeaturedBenchmark[]> {
	const catalog = await loadCatalog(fetchFn);
	return catalog.benchmarks
		.filter(
			(definition): definition is CatalogBenchmark & { featured: FeaturedDefinition } =>
				definition.featured !== undefined
		)
		.sort((a, b) => a.featured.order - b.featured.order)
		.map((definition) => ({
			key: definition.featured.key,
			label: definition.featured.label,
			preferred: definition.name
		}));
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
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	return summaryFor(definitionForBenchmark(benchmarkName, catalog), rows);
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
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	const summary = summaryFor(definitionForBenchmark(benchmarkName, catalog), rows);
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
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	let tasks = allTaskMeta(rows, catalog);
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
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	const task = await loadTask(name, fetchFn);
	const [kindLabel, ...displayParts] = name.split(': ');
	const kind = kindLabel.toLowerCase();
	const display = displayParts.join(': ');
	const rawName =
		rows.find((row) => row.view_kind === kind && displayViewName(kind, row.view_name) === display)
			?.view_name ?? display.toLowerCase().replaceAll(' ', '_');
	const view = `${kind}:${rawName}`;
	const matching = rows
		.filter((row) => row.view === view && viewScoreOf(row) != null)
		.sort((a, b) => (viewScoreOf(b) ?? -1) - (viewScoreOf(a) ?? -1));
	const benchmarkNames = catalog.benchmarks
		.filter((definition) => definition.taskViews.includes(view))
		.map((definition) => definition.name);
	return {
		task,
		benchmarks: benchmarkNames,
		subsets: ['default'],
		splits: ['test'],
		rows: matching.map((row, index) => ({
			rank: index + 1,
			model: toModelMeta(row),
			score: viewScoreOf(row),
			expectedCalibrationError: row.expected_calibration_error,
			meanNegativeLogLikelihood: row.mean_negative_log_likelihood,
			subsetScores: { default: { test: viewScoreOf(row) ?? 0 } },
			benchmarks: benchmarkNames,
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
	const [rows, catalog] = await Promise.all([loadRows(fetchFn), loadCatalog(fetchFn)]);
	const model = await loadModel(name, fetchFn);
	const resultRows = [];
	for (const definition of catalog.benchmarks) {
		const summary = summaryFor(definition, rows);
		const row = summary.rows.find((item) => item.model.name === name);
		if (!row) continue;
		resultRows.push({
			benchmarkName: definition.name,
			benchmarkDisplayName: definition.displayName,
			rank: row.rank,
			totalModels: summary.rows.length,
			meanTask: row.meanTask,
			meanTaskType: row.meanTaskType,
			expectedCalibrationError: row.expectedCalibrationError,
			meanNegativeLogLikelihood: row.meanNegativeLogLikelihood,
			zeroShotPct: 100,
			taskTypes: summary.taskTypes,
			scoresByTaskType: row.scoresByTaskType
		});
	}
	return { model, rows: resultRows };
}
