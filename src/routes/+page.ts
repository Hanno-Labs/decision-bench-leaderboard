// Returns `menu` and `primaries` as unresolved promises so client-side nav
// renders the skeleton immediately; prerender awaits both before emitting HTML.
import type { PageLoad } from './$types';
import { flattenMenu, type Benchmark, type BenchmarkLeaders } from '$lib/types';
import {
	loadBenchmark,
	loadBenchmarkMenu,
	loadFeaturedBenchmarks,
	loadLeaders
} from '$lib/data/service';

export interface Primary {
	key: string;
	label: string;
	preferred: string;
}

// The MTEB tile contract accepts four buckets. DecisionBench uses those
// positions for the top four reviewed models and renders their scores.
const SIZE_BUCKETS: ReadonlyArray<readonly [number, number | null]> = [
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4]
];

export type LeadersResult = BenchmarkLeaders | { error: string };

export interface ResolvedPrimary extends Primary {
	b: Benchmark;
	leaders: LeadersResult;
}

export const load: PageLoad = ({ fetch }) => {
	const menuPromise = loadBenchmarkMenu(fetch);
	// Featured suites and menu placement are both owned by the catalog.
	const primariesPromise = Promise.all([menuPromise, loadFeaturedBenchmarks(fetch)]).then(
		async ([menu, primaries]) => {
			const byName = new Map(flattenMenu(menu).map((b) => [b.name, b]));
			const resolved = await Promise.all(
				primaries.map(async (p): Promise<(Primary & { b: Benchmark }) | null> => {
					const fromMenu = byName.get(p.preferred);
					if (fromMenu) return { ...p, b: fromMenu };
					try {
						return { ...p, b: await loadBenchmark(p.preferred, fetch) };
					} catch {
						return null;
					}
				})
			);
			const found = resolved.filter((p): p is Primary & { b: Benchmark } => p !== null);
			return Promise.all(
				found.map(
					async (p): Promise<ResolvedPrimary> => ({
						...p,
						leaders: await loadLeaders(p.b.name, SIZE_BUCKETS, fetch).catch(
							(e): LeadersResult => ({ error: e instanceof Error ? e.message : String(e) })
						)
					})
				)
			);
		}
	);

	return { menu: menuPromise, primaries: primariesPromise };
};
