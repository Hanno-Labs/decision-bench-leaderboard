# DecisionBench Leaderboard

The public leaderboard and result explorer for [DecisionBench](https://github.com/Hanno-Labs/decision-bench), the benchmark suite for general-purpose decision models.

This project is a maintained fork of the Apache-2.0 licensed [MTEB leaderboard frontend](https://github.com/embeddings-benchmark/leaderboard-frontend). It preserves MTEB's benchmark, task, model, comparison, filtering, charting, accessibility, and deep-linking facilities while adapting the data contract and terminology to typed decision models.

## Development

```bash
npm ci
npm run dev
```

The reviewed result matrix is loaded from [`static/leaderboard.json`](static/leaderboard.json). It is generated from [Hanno-Labs/decision-bench-results](https://github.com/Hanno-Labs/decision-bench-results), not edited by hand.

The results repository supplies each reviewed `model_type` and, for identifiable serving recipes,
the underlying `base_model`. The UI keeps the recipe's credited name while showing the base
checkpoint separately. Older data snapshots without these fields use the legacy type heuristic.

## Verification

```bash
npm run check
npm run lint && npm run test:unit && npm run build
```

## Deployment

The included Dockerfile builds a static SvelteKit application and serves it on port `7860`, suitable for Hugging Face Spaces. GitHub Actions also verifies the application and publishes the container image.

## Upstream and license

DecisionBench Leaderboard tracks [`embeddings-benchmark/leaderboard-frontend`](https://github.com/embeddings-benchmark/leaderboard-frontend) as its upstream. The original Apache-2.0 license is preserved in [LICENSE](LICENSE).
