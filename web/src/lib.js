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
export async function sendMail(env, { to, subject, text, html: htmlBody, kind, entry_id = null, logTo = null }) {
  const from = env.MAIL_FROM || 'Every Dog Deserves a Dedication <hello@dedication.jetsonsjourney.com>';
  let status = 'dev', provider_id = null, detail = null;
  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text, html: htmlBody, reply_to: env.CONTACT_EMAIL }),
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

export async function screen(env, { dog_name, line, cardBytes }) {
  if (!env.ANTHROPIC_API_KEY) return { verdict: 'review', reasons: ['no screening key; awaiting admin'] };
  if (!cardBytes || !cardBytes.byteLength) return { verdict: 'review', reasons: ['card image missing'] };
  let b64;
  try { b64 = base64(cardBytes); }
  catch (e) { return { verdict: 'review', reasons: [`encode error: ${String(e).slice(0, 120)}`] }; }
  const system = [
    'You screen posts for a public, family-friendly wall of dog dedications.',
    'Answer with JSON only: {"ok": true|false, "dog": true|false, "person_face": true|false, "reasons": ["..."]}.',
    'ok is false for nudity, violence, hate, harassment, threats, spam, links, advertising, or text that is not a dedication to a dog.',
    'person_face is true if a human face is clearly visible. Judge content only; never try to identify anyone.',
  ].join(' ');
  const body = {
    model: env.SCREEN_MODEL || 'claude-haiku-5-5',
    max_tokens: 200,
    system,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: `Dog name: ${dog_name}\nDedication line: ${line}` },
    ] }],
  };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { verdict: 'review', reasons: [`screening api ${r.status}: ${String(data?.error?.message || '').slice(0, 120)}`] };
    const text = data?.content?.[0]?.text || '';
    const m = /\{[\s\S]*\}/.exec(text);
    let v = null;
    try { v = m ? JSON.parse(m[0]) : null; } catch { v = null; }
    if (!v) return { verdict: 'review', reasons: ['unparseable verdict'] };
    if (!v.ok) return { verdict: 'rejected', reasons: v.reasons || ['content'] };
    if (v.person_face) return { verdict: 'review', reasons: ['a person’s face is visible; permission check'] };
    return { verdict: 'live', reasons: v.reasons || [] };
  } catch (e) {
    return { verdict: 'review', reasons: [`screening error: ${String(e).slice(0, 120)}`] };
  }
}
