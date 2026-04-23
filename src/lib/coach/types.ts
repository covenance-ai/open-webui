// TS shapes mirroring backend Pydantic schemas (backend/open_webui/coach/schemas.py).
// Keep in sync with backend when adding fields.

export interface CoachConfig {
	user_id: string;
	enabled: boolean;
	demo_mode: boolean;
	coach_model_id: string | null;
	active_policy_ids: string[];
	created_at: number;
	updated_at: number;
}

export interface CoachConfigForm {
	enabled?: boolean;
	demo_mode?: boolean;
	coach_model_id?: string | null;
	active_policy_ids?: string[];
}

export interface CoachPolicy {
	id: string;
	user_id: string | null;
	is_shared: boolean;
	title: string;
	body: string;
	// Optional hyperlink shown in the block banner — "read full
	// explanation" link. Wikipedia / regulation / internal wiki / etc.
	explanation_url?: string | null;
	created_at: number;
	updated_at: number;
}

export interface CoachPolicyCreateForm {
	title: string;
	body: string;
	explanation_url?: string | null;
}

export interface CoachPolicyUpdateForm {
	title?: string;
	body?: string;
	explanation_url?: string | null;
}

// ── Activity log ────────────────────────────────────────────────────
// One row per evaluate() call. In-memory on the backend — resets on
// container restart — so treat as short-term diagnostics.

export type CoachEventStatus = 'ok' | 'error' | 'skipped' | 'demo';

export interface CoachEvent {
	id: string;
	user_id: string;
	ts_ms: number;
	status: CoachEventStatus;
	action: string | null;
	reason: string | null;
	model_id: string | null;
	policy_count: number;
	duration_ms: number;
	tokens_in: number | null;
	tokens_out: number | null;
	error: string | null;
	chat_id: string | null;
	message_id: string | null;
	phase: 'pre' | 'post';
}

export interface CoachPolicySnapshot {
	id: string;
	title: string;
	body: string;
	is_shared: boolean;
}

export interface CoachRenderedMessage {
	role: string;
	content: string;
}

export interface CoachConversationTurn {
	role: string;
	content: string;
	coach_authored: boolean;
}

export interface CoachEventDetail {
	id: string;
	user_id: string | null;
	ts_ms: number;
	status: CoachEventStatus;
	action: string | null;
	reason: string | null;
	model_id: string | null;
	duration_ms: number;
	tokens_in: number | null;
	tokens_out: number | null;
	error: string | null;
	demo: boolean;
	rendered_prompt: CoachRenderedMessage[];
	raw_reply: string | null;
	verdict: Record<string, unknown>;
	active_policies: CoachPolicySnapshot[];
	conversation: CoachConversationTurn[];
}

export interface DryRunRequest {
	conversation: CoachConversationTurn[];
	policy_ids?: string[] | null;
	coach_model_id?: string | null;
	demo_mode?: boolean | null;
	enabled?: boolean | null;
}
