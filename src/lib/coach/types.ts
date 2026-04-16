// TS shapes mirroring backend Pydantic schemas (backend/open_webui/coach/schemas.py).
// Keep in sync with backend when adding fields.

export interface CoachConfig {
	user_id: string;
	enabled: boolean;
	coach_model_id: string | null;
	active_policy_ids: string[];
	created_at: number;
	updated_at: number;
}

export interface CoachConfigForm {
	enabled?: boolean;
	coach_model_id?: string | null;
	active_policy_ids?: string[];
}

export interface CoachPolicy {
	id: string;
	user_id: string | null;
	is_shared: boolean;
	title: string;
	body: string;
	created_at: number;
	updated_at: number;
}

export interface CoachPolicyCreateForm {
	title: string;
	body: string;
}

export interface CoachPolicyUpdateForm {
	title?: string;
	body?: string;
}
