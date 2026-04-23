#!/usr/bin/env node
// Prime a local Open WebUI instance with enough state to exercise the
// Coach block flow end-to-end — admin user, auth token, coach enabled
// in demo mode, one rich policy in the active set.
//
// Usage:
//   node scripts/coach-seed.mjs [--api=http://localhost:8080] [--email=...] [--password=...]
//
// Output: JSON with { token, user_id, policy_id, api } on stdout (last
// line). Intermediate progress goes to stderr so callers can capture
// just the JSON payload via tail -n1 or by reading the last line.
//
// Idempotent: running twice signs the existing user back in (no clone),
// reuses the same policy title (creates a new one only if missing),
// and updates coach config regardless.

const API = argv('api', process.env.COACH_SEED_API || 'http://localhost:8080');
const EMAIL = argv('email', process.env.COACH_SEED_EMAIL || 'coach-demo@local.dev');
const PASSWORD = argv('password', process.env.COACH_SEED_PASSWORD || 'coach-demo-pw');
const NAME = argv('name', process.env.COACH_SEED_NAME || 'Coach Demo');
const POLICY_TITLE = argv('policy-title', 'no HR use');

function argv(key, def) {
	const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
	return hit ? hit.split('=').slice(1).join('=') : def;
}

function log(...args) {
	console.error('[coach-seed]', ...args);
}

async function req(method, path, { token, body } = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// Non-JSON body — surface it as the error message.
	}
	if (!res.ok) {
		const msg = (json && (json.detail || json.message)) || text || res.statusText;
		const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
		err.status = res.status;
		err.body = json;
		throw err;
	}
	return json;
}

async function signupOrSignin() {
	try {
		const signup = await req('POST', '/api/v1/auths/signup', {
			body: { email: EMAIL, password: PASSWORD, name: NAME }
		});
		log('signed up new user:', EMAIL);
		return signup;
	} catch (err) {
		// 400 on a duplicate email is expected on rerun — fall through to signin.
		// 403 when ENABLE_SIGNUP=false after first admin was created — same.
		if (err.status !== 400 && err.status !== 403) throw err;
		log('signup unavailable, signing in existing user:', EMAIL);
		const signin = await req('POST', '/api/v1/auths/signin', {
			body: { email: EMAIL, password: PASSWORD }
		});
		return signin;
	}
}

async function ensurePolicy(token) {
	const policies = await req('GET', '/api/v1/coach/policies', { token });
	const match = (policies || []).find((p) => p.title === POLICY_TITLE);
	if (match) {
		log('policy exists:', match.id);
		return match;
	}
	const created = await req('POST', '/api/v1/coach/policies', {
		token,
		body: {
			title: POLICY_TITLE,
			body:
				'Do not use this assistant for hiring-related decisions, candidate ranking, ' +
				'CV screening, or any other HR judgment that affects a person’s employment. ' +
				'The EU AI Act classifies these as high-risk use cases (Annex III) and our ' +
				'internal policy forbids delegating them to a general-purpose LLM.',
			explanation_url: 'https://artificialintelligenceact.eu/annex/3/'
		}
	});
	log('created policy:', created.id);
	return created;
}

async function configureCoach(token, policyId) {
	const cfg = await req('POST', '/api/v1/coach/config', {
		token,
		body: {
			enabled: true,
			demo_mode: true,
			// demo_mode short-circuits the LLM, so coach_model_id is optional,
			// but some upstream checks want a truthy string.
			coach_model_id: 'demo-mode',
			active_policy_ids: [policyId]
		}
	});
	log('coach configured: enabled, demo_mode=true, active=[', policyId, ']');
	return cfg;
}

(async () => {
	const session = await signupOrSignin();
	const token = session.token;
	if (!token) throw new Error('signin/signup succeeded but returned no token');

	const policy = await ensurePolicy(token);
	await configureCoach(token, policy.id);

	const out = {
		api: API,
		email: EMAIL,
		token,
		user_id: session.id ?? null,
		policy_id: policy.id
	};
	process.stdout.write(JSON.stringify(out) + '\n');
})().catch((err) => {
	log('ERROR:', err.message);
	if (err.body) log('body:', JSON.stringify(err.body));
	process.exit(1);
});
