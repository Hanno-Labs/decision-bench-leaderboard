<script lang="ts">
	import {
		Binary,
		Bot,
		BrainCircuit,
		Building,
		ChartCandlestick,
		CodeXml,
		Cog,
		Cpu,
		Database,
		FileSearch,
		Gamepad2,
		Globe,
		HousePlug,
		Landmark,
		LockKeyhole,
		MessageCircleQuestion,
		MessageSquare,
		MousePointerClick,
		Network,
		ReceiptText,
		Scale,
		Search,
		SearchCode,
		ShieldCheck,
		ShoppingCart,
		SlidersHorizontal,
		Waypoints,
		Workflow
	} from '@lucide/svelte';
	import { apiUrl, isIconUrl } from '$lib/format';

	const ICONS = {
		'agent-control': SlidersHorizontal,
		'browser-automation': MousePointerClick,
		'code-search': SearchCode,
		'coding-agents': Bot,
		databases: Database,
		ecommerce: ShoppingCart,
		'evidence-reasoning': FileSearch,
		finance: ChartCandlestick,
		financial: Landmark,
		games: Gamepad2,
		'general-assistant': MessageCircleQuestion,
		'home-automation': HousePlug,
		'knowledge-graphs': Network,
		legal: Scale,
		logic: Binary,
		'multi-hop-search': Waypoints,
		'online-safety': ShieldCheck,
		privacy: LockKeyhole,
		'public-sector': Building,
		reasoning: BrainCircuit,
		robotics: Cog,
		search: Search,
		'social-media': MessageSquare,
		'software-agents': Workflow,
		'software-engineering': CodeXml,
		'tax-documents': ReceiptText,
		technical: Cpu,
		web: Globe,
		world: Globe
	} as const;

	type IconName = keyof typeof ICONS;

	interface Props {
		icon?: string | null;
		label?: string;
		size?: number;
		class?: string;
	}

	let { icon, label = '', size = 24, class: className = '' }: Props = $props();
	let iconName = $derived(icon?.startsWith('lucide:') ? icon.slice('lucide:'.length) : null);
	let Pictogram = $derived(iconName ? (ICONS[iconName as IconName] ?? Globe) : undefined);
</script>

{#if icon}
	{#if Pictogram}
		<span
			class={`benchmark-icon icon-tile ${className}`}
			style={`--icon-size: ${size}px`}
			aria-hidden="true"
		>
			<Pictogram size={Math.round(size * 0.64)} strokeWidth={1.9} />
		</span>
	{:else if isIconUrl(icon)}
		<img
			class={`icon-tile ${className}`}
			src={apiUrl(icon)}
			alt={label ? `${label} icon` : ''}
			width={size}
			height={size}
			loading="lazy"
			decoding="async"
			crossorigin="anonymous"
		/>
	{:else}
		<span
			class={`icon-tile icon-tile-text ${className}`}
			style={`--icon-size: ${size}px`}
			aria-hidden="true">{icon}</span
		>
	{/if}
{/if}

<style>
	.benchmark-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--card-accent, var(--text-subtle));
	}
	.benchmark-icon :global(svg) {
		display: block;
	}
</style>
