// Single source of truth for how each policy kind is labelled, coloured,
// and explained in the UI. Imported by PolicyEditorForm, PolicyList,
// the /coach demo cards, and the simulated chat preview, so a tweak
// here flows everywhere.

import type { PolicyKind } from './types';

export interface KindMeta {
	kind: PolicyKind;
	label: string; // Title-cased label
	verb: string; // Imperative verb form, used in "this policy will ___"
	icon: string; // Emoji glyph — terse, distinct, theme-agnostic
	tagline: string; // One-liner shown next to the kind selector
	when: string; // "Use when …" guidance, longer form
	chipBg: string; // Tailwind classes for the small chip (PolicyList)
	chipFg: string;
	cardBg: string; // Tailwind classes for the demo card
	cardBorder: string;
	cardAccent: string; // Headline / button accent
	chatBubble: string; // Demo-chat coach bubble background classes
}

export const KIND_META: Record<PolicyKind, KindMeta> = {
	block: {
		kind: 'block',
		label: 'Block',
		verb: 'block the message',
		icon: '⛔',
		tagline: 'Refuse before the LLM sees it',
		when:
			"Use when the user shouldn't be asking this — hiring decisions, " +
			'medical advice, anything that needs a human reviewer.',
		chipBg: 'bg-red-100 dark:bg-red-900/30',
		chipFg: 'text-red-700 dark:text-red-300',
		cardBg: 'bg-red-50 dark:bg-red-950/40',
		cardBorder: 'border-red-200 dark:border-red-900',
		cardAccent: 'text-red-700 dark:text-red-300',
		chatBubble: 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800'
	},
	flag: {
		kind: 'flag',
		label: 'Flag',
		verb: "warn on the assistant's reply",
		icon: '🚩',
		tagline: 'Annotate the reply with a warning',
		when:
			"Use when the LLM's reply is concerning but a re-prompt won't " +
			'help — already-leaked info, missing external context, style.',
		chipBg: 'bg-amber-100 dark:bg-amber-900/30',
		chipFg: 'text-amber-700 dark:text-amber-300',
		cardBg: 'bg-amber-50 dark:bg-amber-950/40',
		cardBorder: 'border-amber-200 dark:border-amber-900',
		cardAccent: 'text-amber-700 dark:text-amber-300',
		chatBubble:
			'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
	},
	intervene: {
		kind: 'intervene',
		label: 'Intervene',
		verb: 'ask the LLM to self-correct',
		icon: '↩️',
		tagline: 'Auto-send a corrective follow-up',
		when:
			'Use when the LLM drifts in a way it can fix itself — missing ' +
			'examples, weak structure, forgotten constraints.',
		chipBg: 'bg-sky-100 dark:bg-sky-900/30',
		chipFg: 'text-sky-700 dark:text-sky-300',
		cardBg: 'bg-sky-50 dark:bg-sky-950/40',
		cardBorder: 'border-sky-200 dark:border-sky-900',
		cardAccent: 'text-sky-700 dark:text-sky-300',
		chatBubble: 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800'
	}
};
