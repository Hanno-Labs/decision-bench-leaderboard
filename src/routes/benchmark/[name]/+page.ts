// Prerendered so per-entity `ShareMeta` lands in static HTML for social crawlers.
// Docker builds opt into the SPA fallback while loading the bundled result matrix.
import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageLoad } from './$types';
import { HttpError, loadBenchmark, loadBenchmarks } from '$lib/data/service';
import type { Benchmark } from '$lib/types';

export const prerender = !process.env.BUILD_NO_PRERENDER;

export const entries: EntryGenerator = async () => {
	if (process.env.BUILD_NO_PRERENDER) return [];
	const benches = await loadBenchmarks();
	return benches.map((b) => ({ name: b.name }));
};

// Ships in the route's prerendered .json so hover-preload populates the cache
// before the store's loadBenchmark fires.
export const load: PageLoad = async ({ params, fetch }): Promise<{ benchmark: Benchmark }> => {
	const benchmark = await loadBenchmark(params.name, fetch).catch((e) => {
		if (e instanceof HttpError && e.status === 404) {
			error(404, `Benchmark "${params.name}" not found`);
		}
		throw e;
	});
	return { benchmark };
};
