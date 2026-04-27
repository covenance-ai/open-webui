// Fetch wrappers for /api/v1/coach/* endpoints.
// Kept thin: every method mirrors a single backend route.

import { WEBUI_API_BASE_URL } from '$lib/constants';
import type {
	CoachAdminUserAccessRow,
	CoachConfig,
	CoachConfigForm,
	CoachEvent,
	CoachEventDetail,
	CoachPolicy,
	CoachPolicyCreateForm,
	CoachPolicyUpdateForm,
	DryRunRequest
} from './types';

const BASE = `${WEBUI_API_BASE_URL}/coach`;

function authHeaders(token: string): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`
	};
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) {
		let detail: unknown;
		try {
			detail = await res.json();
		} catch {
			detail = await res.text();
		}
		throw new Error(`Coach API ${res.status}: ${JSON.stringify(detail)}`);
	}
	return res.json();
}

// Config
export const getCoachConfig = (token: string) =>
	fetchJson<CoachConfig>(`${BASE}/config`, { method: 'GET', headers: authHeaders(token) });

export const saveCoachConfig = (token: string, form: CoachConfigForm) =>
	fetchJson<CoachConfig>(`${BASE}/config`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(form)
	});

// Policies
export const listCoachPolicies = (token: string) =>
	fetchJson<CoachPolicy[]>(`${BASE}/policies`, { method: 'GET', headers: authHeaders(token) });

export const createCoachPolicy = (token: string, form: CoachPolicyCreateForm) =>
	fetchJson<CoachPolicy>(`${BASE}/policies`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(form)
	});

export const updateCoachPolicy = (token: string, id: string, form: CoachPolicyUpdateForm) =>
	fetchJson<CoachPolicy>(`${BASE}/policies/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: authHeaders(token),
		body: JSON.stringify(form)
	});

export const deleteCoachPolicy = (token: string, id: string) =>
	fetchJson<{ deleted: boolean }>(`${BASE}/policies/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: authHeaders(token)
	});

export const shareCoachPolicy = (token: string, id: string) =>
	fetchJson<CoachPolicy>(`${BASE}/policies/${encodeURIComponent(id)}/share`, {
		method: 'POST',
		headers: authHeaders(token)
	});

export const unshareCoachPolicy = (token: string, id: string) =>
	fetchJson<CoachPolicy>(`${BASE}/policies/${encodeURIComponent(id)}/unshare`, {
		method: 'POST',
		headers: authHeaders(token)
	});

// Events (in-memory activity log)
export const listCoachEvents = (token: string, limit = 50) =>
	fetchJson<CoachEvent[]>(`${BASE}/events?limit=${limit}`, {
		method: 'GET',
		headers: authHeaders(token)
	});

export const clearCoachEvents = (token: string) =>
	fetchJson<{ cleared: number }>(`${BASE}/events`, {
		method: 'DELETE',
		headers: authHeaders(token)
	});

export const getCoachEventDetail = (token: string, eventId: string) =>
	fetchJson<CoachEventDetail>(`${BASE}/events/${encodeURIComponent(eventId)}`, {
		method: 'GET',
		headers: authHeaders(token)
	});

export const dryRunCoach = (token: string, body: DryRunRequest) =>
	fetchJson<CoachEventDetail>(`${BASE}/dry-run`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});

// Admin: per-user access control. Backend rejects with 403 unless the
// caller has role=admin, so these are safe to call from the user-side
// CoachPanel guarded only by the UI's `isAdmin` check.
export const adminListCoachUserAccess = (token: string) =>
	fetchJson<CoachAdminUserAccessRow[]>(`${BASE}/admin/users`, {
		method: 'GET',
		headers: authHeaders(token)
	});

export const adminSetCoachUserAccess = (
	token: string,
	userId: string,
	accessEnabled: boolean
) =>
	fetchJson<CoachAdminUserAccessRow>(
		`${BASE}/admin/users/${encodeURIComponent(userId)}`,
		{
			method: 'PATCH',
			headers: authHeaders(token),
			body: JSON.stringify({ access_enabled: accessEnabled })
		}
	);
