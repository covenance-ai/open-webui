<script lang="ts">
	// Persistent banner pinned at the top-center of the conversation when
	// coach blocked the user's latest pre-flight message. Stays until the
	// user dismisses it or switches chats (per-chat state). The store is
	// populated from init.ts's onPreflightBlock handler.
	//
	// "Read full explanation →" hyperlinks out to whatever URL the policy
	// carries (Wikipedia, regulation page, internal wiki, ...). If the
	// policy has no URL, the link is hidden.

	import { chatId } from '$lib/stores';
	import { blockBannerByChat, clearBlockBanner } from '../stores/blockBanner';

	$: info = ($chatId && $blockBannerByChat[$chatId]) || null;

	function dismiss() {
		if ($chatId) clearBlockBanner($chatId);
	}
</script>

{#if info}
	<aside class="coach-block-banner" role="alert" aria-live="polite">
		<span class="icon" aria-hidden="true">⛔</span>
		<div class="content">
			<div class="title">
				Coach blocked this message
				{#if info.policyTitle}
					<span class="policy">· {info.policyTitle}</span>
				{/if}
			</div>
			<p class="rationale">{info.rationale}</p>
			{#if info.explanationUrl}
				<a
					class="link"
					href={info.explanationUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					Read full explanation →
				</a>
			{/if}
		</div>
		<button
			type="button"
			class="dismiss"
			on:click={dismiss}
			aria-label="Dismiss coach block banner"
			title="Dismiss"
		>
			✕
		</button>
	</aside>
{/if}

<style>
	.coach-block-banner {
		position: fixed;
		top: 56px; /* under upstream's header bar */
		left: 50%;
		transform: translateX(-50%);
		z-index: 45;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		max-width: min(720px, calc(100% - 24px));
		padding: 0.875rem 1rem;
		border-radius: 10px;
		background: rgba(254, 242, 242, 0.98);
		color: rgb(153, 27, 27);
		border: 1px solid rgba(153, 27, 27, 0.22);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.06),
			0 12px 32px rgba(0, 0, 0, 0.1);
		backdrop-filter: blur(6px);
		font-family: ui-sans-serif, system-ui, sans-serif;
		font-size: 13px;
	}
	:global(.dark) .coach-block-banner {
		background: rgba(69, 10, 10, 0.92);
		color: rgb(252, 165, 165);
		border-color: rgba(248, 113, 113, 0.28);
	}
	.icon {
		font-size: 18px;
		line-height: 1.3;
		flex: none;
	}
	.content {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: 600;
		margin-bottom: 2px;
	}
	.policy {
		font-weight: 400;
		opacity: 0.85;
	}
	.rationale {
		margin: 0 0 0.375rem;
		line-height: 1.45;
	}
	.link {
		font-size: 12.5px;
		text-decoration: underline;
		color: inherit;
		opacity: 0.9;
	}
	.link:hover {
		opacity: 1;
	}
	.dismiss {
		flex: none;
		background: transparent;
		border: none;
		color: inherit;
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		opacity: 0.7;
	}
	.dismiss:hover {
		opacity: 1;
		background: rgba(0, 0, 0, 0.05);
	}
	:global(.dark) .dismiss:hover {
		background: rgba(255, 255, 255, 0.08);
	}
</style>
