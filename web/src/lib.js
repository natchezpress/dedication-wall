// Shared helpers for the Worker: time, ids, crypto, JSON, mail, screening.

const enc = new TextEncoder();

export const now = () => Math.floor(Date.now() / 1000);

// Calendar day in America/Chicago, YYYY-MM-DD (hearts: one per visitor per entry per Central day).
export function centralDay(ts = Date.now()) {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Hour of the day in America/Chicago, 0–23 (heart emails go out in the evening, Central).
export function centralHour(ts = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts)));
}

export function centralDateTime(ts) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ts * 1000));
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i
export function shortId(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function tokenHex(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(secret, payload) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Session cookie: "<email>|<expires>|<hmac>". No passwords anywhere.
export async function makeSession(secret, email, days = 30) {
  const exp = now() + days * 86400;
  const body = `${email}|${exp}`;
  return `${body}|${await sign(secret, body)}`;
}

export async function readSession(secret, cookieHeader) {
  const m = /(?:^|;\s*)dw_session=([^;]+)/.exec(cookieHeader || '');
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  const i = raw.lastIndexOf('|');
  if (i < 0) return null;
  const body = raw.slice(0, i), sig = raw.slice(i + 1);
  if ((await sign(secret, body)) !== sig) return null;
  const [email, exp] = body.split('|');
  if (!email || Number(exp) < now()) return null;
  return { email };
}

export function sessionCookie(value, secure = true) {
  return `dw_session=${encodeURIComponent(value)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

export const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// A visitor hash for hearts: IP + UA + a daily salt, never stored raw.
export async function visitorHash(request, secret) {
  const ip = request.headers.get('cf-connecting-ip') || '0';
  const ua = request.headers.get('user-agent') || '';
  return (await sha256(`${secret}|${ip}|${ua}|${centralDay()}`)).slice(0, 32);
}

// ---------- mail (Resend) ----------
// With no RESEND_API_KEY the message is logged as 'dev' and, in DEV_MODE, returned to the caller.
// logTo: what the notices log records as the recipient (invites log a hash, never the address).
// ---------- failure sensors ----------
// Every outside dependency records a row when it fails; the page reports its own errors too. When a
// kind keeps failing (ALERT_AT in an hour) Brock gets one email, then nothing more about that kind for
// ALERT_REST. Mail failures are recorded but never emailed about, for the obvious reason.
export const FAILURE_LABEL = {
  cutout: 'the cutout', words: 'word help', screen: 'the screener', mail: 'email (Resend)', newsletter: 'the newsletter (MailerLite)',
  post: 'posting', server: 'the server', cap: 'a daily cap', page: 'the page in a browser', canary: 'the nightly check',
};
const ALERT_AT = { post: 1, canary: 1, page: 5 };
const ALERT_WINDOW = 3600, ALERT_REST = 6 * 3600;
export function uaFamily(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'other';
  const br = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : 'other';
  return `${br}/${os}`;
}
export async function failure(env, kind, detail, { visitor = null, ua = null } = {}) {
  try {
    await env.DB.prepare('INSERT INTO failures (at, kind, detail, visitor, ua) VALUES (?,?,?,?,?)')
      .bind(now(), kind, String(detail || '').slice(0, 300), visitor, ua ? uaFamily(ua) : null).run();
  } catch (e) { console.error('failure row', kind, String(e).slice(0, 120)); }
}
export async function alertIfNeeded(env, kind, { force = false } = {}) {
  if (kind === 'mail' || !env.CONTACT_EMAIL) return false;
  const t = now();
  try {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM failures WHERE kind = ? AND at > ?').bind(kind, t - ALERT_WINDOW).first())?.n || 0;
    if (!force && n < (ALERT_AT[kind] || 3)) return false;
    const mark = await env.DB.prepare('SELECT last_at FROM alert_marks WHERE kind = ?').bind(kind).first();
    if (!force && mark && t - mark.last_at < ALERT_REST) return false;
    await env.DB.prepare('INSERT INTO alert_marks (kind, last_at) VALUES (?,?) ON CONFLICT(kind) DO UPDATE SET last_at = excluded.last_at').bind(kind, t).run();
    const last = await env.DB.prepare('SELECT at, detail, ua FROM failures WHERE kind = ? ORDER BY at DESC LIMIT 3').bind(kind).all();
    const lines = (last.results || []).map((r) => `${centralDateTime(r.at)} · ${r.detail || ''}${r.ua ? ` · ${r.ua}` : ''}`);
    const label = FAILURE_LABEL[kind] || kind;
    const site = env.SITE_URL || 'https://dedication.jetsonsjourney.com';
    await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'alert',
      subject: `Dedication Wall: ${label} is failing (${n} in the last hour)`,
      text: `${label} failed ${n} time${n === 1 ? '' : 's'} in the last hour.\n\nLatest:\n${lines.join('\n')}\n\nAdmin: ${site}/admin\n\nNo more emails about this for six hours unless it is fixed and fails again.`,
      html: `<p><strong>${escapeHtml(label)}</strong> failed ${n} time${n === 1 ? '' : 's'} in the last hour.</p><p>Latest:<br>${lines.map(escapeHtml).join('<br>')}</p><p><a href="${site}/admin">Admin</a></p><p>No more emails about this for six hours unless it is fixed and fails again.</p>` });
    return true;
  } catch (e) { console.error('alert', kind, String(e).slice(0, 120)); return false; }
}
// Record and, if it is time, email: one call for the handlers.
export async function sense(env, kind, detail, meta) {
  await failure(env, kind, detail, meta);
  await alertIfNeeded(env, kind);
}

// headers: extra mail headers (heart emails carry List-Unsubscribe so a mail app can offer its own off switch).
export async function sendMail(env, { to, subject, text, html: htmlBody, kind, entry_id = null, logTo = null, headers = null }) {
  const from = env.MAIL_FROM || 'Every Dog Deserves a Dedication <hello@dedication.jetsonsjourney.com>';
  let status = 'dev', provider_id = null, detail = null;
  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text, html: htmlBody, reply_to: env.CONTACT_EMAIL, ...(headers ? { headers } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      status = r.ok ? 'sent' : 'failed';
      provider_id = body.id || null;
      detail = r.ok ? null : JSON.stringify(body).slice(0, 500);
    } catch (e) {
      status = 'failed'; detail = String(e).slice(0, 500);
    }
  }
  await env.DB.prepare('INSERT INTO notices (kind, to_email, entry_id, provider_id, status, sent_at, detail) VALUES (?,?,?,?,?,?,?)')
    .bind(kind, logTo || to, entry_id, provider_id, status, now(), detail).run();
  if (status === 'failed') await failure(env, 'mail', `${kind}: ${detail || 'unknown'}`);
  return { status, provider_id };
}

// ---------- screening (Anthropic) ----------
// Returns { verdict: 'live' | 'rejected' | 'review', reasons: [...] }.
// With no ANTHROPIC_API_KEY the entry waits for Brock in the admin queue ('review').
// Base64 in chunks: spreading a whole card (500 KB+) into String.fromCharCode overflows the call stack.
export function base64(bytes) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// One call to the Messages API. Haiku 5.5 thinks by default and the thinking counts against max_tokens,
// so a small budget came back as stop_reason "max_tokens" with no text at all (11/3). Thinking is turned
// off for these short, structured jobs; if a model rejects that parameter, the call is retried without it.
export async function anthropic(env, body) {
  const send = (b) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(b),
  });
  let r = await send({ ...body, thinking: { type: 'disabled' } });
  let data = await r.json().catch(() => ({}));
  if (r.status === 400 && /thinking/i.test(String(data?.error?.message || ''))) {
    r = await send(body);
    data = await r.json().catch(() => ({}));
  }
  return { r, data };
}

export async function screen(env, { dog_name, line, cardBytes }) {
  if (!env.ANTHROPIC_API_KEY) return { verdict: 'review', reasons: ['no screening key; awaiting admin'] };
  if (!cardBytes || !cardBytes.byteLength) return { verdict: 'review', reasons: ['card image missing'] };
  let b64;
  try { b64 = base64(cardBytes); }
  catch (e) { return { verdict: 'review', reasons: [`encode error: ${String(e).slice(0, 120)}`] }; }
  const system = [
    'You screen posts for a public, family-friendly wall of dog dedications.',
    'The image is a finished card made by our own maker. Every card carries our template: the label "To" or "In memory of", the dog’s name,',
    'the dedication line, the footer "Every dog deserves a dedication" and our own address "dedication.jetsonsjourney.com", on one of our backgrounds.',
    'Those template parts are ours and are never a reason to refuse. Judge only the reader’s photo and the reader’s words (the dog’s name and the line).',
    'Answer with JSON only: {"ok": true|false, "dog": true|false, "person_face": true|false, "reasons": ["..."]}.',
    'ok is false for nudity, sexual content, violence, gore, hate, harassment, threats, spam, a reader’s own link or advertising, or words that are not a dedication to a dog.',
    'A photo without a dog (a toy, a drawing, a different animal) is still ok if the words are a dedication; set dog to false.',
    'person_face is true if a human face is clearly visible. Judge content only; never try to identify anyone.',
  ].join(' ');
  const body = {
    model: env.SCREEN_MODEL || 'claude-haiku-5-5',
    max_tokens: 300,
    system,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: `Dog name: ${dog_name}\nDedication line: ${line}` },
    ] }],
  };
  try {
    const { r, data } = await anthropic(env, body);
    if (!r.ok) return { verdict: 'review', reasons: [`screening api ${r.status}: ${String(data?.error?.message || '').slice(0, 120)}`] };
    // Every text block, joined: a response may lead with a non-text block.
    const text = (Array.isArray(data?.content) ? data.content : []).filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n');
    const m = /\{[\s\S]*?\}/.exec(text);
    let v = null;
    try { v = m ? JSON.parse(m[0]) : null; } catch { v = null; }
    if (!v) { console.error('screen raw', data?.stop_reason, JSON.stringify((data?.content || []).map((c) => c?.type)), JSON.stringify(text).slice(0, 300)); return { verdict: 'review', reasons: ['unparseable verdict'] }; }
    // A refusal with a severe reason is rejected outright (photo deleted, owner told). Anything milder waits
    // for Brock in the queue, so a wrong call never deletes a reader's photo.
    if (!v.ok) {
      const reasons = Array.isArray(v.reasons) && v.reasons.length ? v.reasons.map(String) : ['content'];
      const severe = /nudit|sexual|porn|violen|gore|blood|hate|slur|harass|threat/i.test(reasons.join(' '));
      console.error('screen refused', severe ? 'rejected' : 'review', JSON.stringify(reasons).slice(0, 300));
      return { verdict: severe ? 'rejected' : 'review', reasons: [`model: ${reasons.join('; ')}`.slice(0, 300)] };
    }
    if (v.person_face) return { verdict: 'review', reasons: ['a person’s face is visible; permission check'] };
    return { verdict: 'live', reasons: v.reasons || [] };
  } catch (e) {
    return { verdict: 'review', reasons: [`screening error: ${String(e).slice(0, 120)}`] };
  }
}

// ---------- word help (Anthropic) ----------
// Five dedication lines from a few words about the dog. Returns { ok, lines } or { ok: false, error }.
// Nothing the visitor typed is stored; the caller counts uses for the rate limit.
const WORD_SYSTEM = [
  'You write one-line dedications to a dog for a public wall, in the voice of a plainspoken novelist who loved his dog.',
  'Each line completes the phrase "To {name}," or "In memory of {name}," and starts with "who" (or "whose").',
  'Living dog: present tense. In memory: past tense, tender, not maudlin.',
  'Use the specific details given; invent nothing about the dog. Never include a person’s name.',
  'Plain words. Warm, exact, a little funny where the details allow. No clichés ("rainbow bridge", "furry friend", "fur baby"), no emojis, no hashtags, no exclamation marks, no quotation marks.',
  'Each line 40 to 75 characters, never more than 80, ending with a period: one thought, said once. Five lines, each different in angle; at least two under 55 characters.',
  'Answer with JSON only: {"lines": ["who ...", "who ...", "who ...", "who ...", "who ..."]}.',
].join(' ');

export async function suggestLines(env, { mode, name, about }) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: 'no key' };
  const memory = mode === 'in_memory' || mode === 'inMemory';
  const body = {
    model: env.WORDS_MODEL || env.SCREEN_MODEL || 'claude-haiku-5-5',
    max_tokens: 600,
    system: WORD_SYSTEM,
    messages: [{ role: 'user', content: `Kind: ${memory ? 'In memory of' : 'To'} (${memory ? 'the dog has died' : 'the dog is living'})\nDog’s name: ${name || 'my dog'}\nAbout the dog: ${about}` }],
  };
  try {
    const { r, data } = await anthropic(env, body);
    if (!r.ok) { console.error('suggest api', r.status, String(data?.error?.message || '').slice(0, 200)); return { ok: false, error: `api ${r.status}` }; }
    // All text blocks, joined; then JSON if it parses, else any quoted strings, else "who …" lines.
    const text = (Array.isArray(data?.content) ? data.content : []).filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n');
    let lines = [];
    const m = /\{[\s\S]*?\}/.exec(text);
    if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v?.lines)) lines = v.lines; } catch { /* fall through */ } }
    if (!lines.length) lines = [...text.matchAll(/"([^"\n]{8,140})"/g)].map((x) => x[1]);
    if (!lines.length) lines = text.split(/\n+/).map((s) => s.replace(/^[\s\-*\d.)]+/, '').trim()).filter((s) => /^(who|whose)\b/i.test(s));
    const clean = [...new Set(lines
      .filter((s) => typeof s === 'string')
      .map((s) => s.replace(/[“”"]/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 8 && s.length <= 120))].slice(0, 5);
    if (!clean.length) { console.error('suggest raw', data?.stop_reason, JSON.stringify(text).slice(0, 400)); return { ok: false, error: 'no lines' }; }
    return { ok: true, lines: clean };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}
