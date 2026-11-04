// Dedication Maker and Wall · the Worker.
// Static files (the maker) come from the ASSETS binding; everything under /api, /d, /wall, /memory, /i, /p,
// /privacy, /terms and /admin is answered here.
import {
  now, centralDay, centralDateTime, shortId, tokenHex, sha256, makeSession, readSession, sessionCookie,
  json, html, bad, escapeHtml as h, validEmail, visitorHash, sendMail, screen, suggestLines,
} from './lib.js';
import { wallPage, dogPage, simplePage, notFoundPage } from './pages.js';

const TERMS_VERSION_FALLBACK = 'terms-of-use-2026-05-16';
const MAX_PHOTO = 12 * 1024 * 1024;   // original
const MAX_CUT = 3 * 1024 * 1024;      // each JPEG cut

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      // ----- public pages -----
      if (p === '/wall' && request.method === 'GET') return wall(env, request, false);
      if (p === '/memory' && request.method === 'GET') return wall(env, request, true);
      if (p.startsWith('/d/') && request.method === 'GET') return dog(env, request, p.slice(3));
      if (p.startsWith('/p/') && request.method === 'GET') return photo(env, request, p.slice(3));
      if (p.startsWith('/i/') && request.method === 'GET') return invite(env, request, p.slice(3));
      if (p.startsWith('/u/') && request.method === 'GET') return unsubscribe(env, request, p.slice(3), url);
      if (p === '/privacy') return Response.redirect('https://brockalston.com/privacy-policy', 302);
      if (p === '/terms') return Response.redirect('https://brockalston.com/terms-of-use', 302);

      // ----- api -----
      if (p === '/api/health') return health(env);
      if (p === '/api/config') return config(env, request);
      if (p === '/api/request' && request.method === 'POST') return requestBackground(env, request);
      if (p === '/api/heart' && request.method === 'POST') return heart(env, request);
      if (p === '/api/suggest' && request.method === 'POST') return suggest(env, request);
      if (p === '/api/cutout' && request.method === 'POST') return cutout(env, request, ctx);
      if (p === '/api/auth/link' && request.method === 'POST') return authLink(env, request, url);
      if (p === '/api/auth/verify' && request.method === 'GET') return authVerify(env, request, url);
      if (p === '/api/auth/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': 'dw_session=; Path=/; Max-Age=0' } });
      if (p === '/api/post' && request.method === 'POST') return post(env, request, ctx);
      if (p === '/api/mine' && request.method === 'GET') return mine(env, request);
      if (p === '/api/remove' && request.method === 'GET') return removeConfirm(env, request);
      if (p === '/api/remove' && request.method === 'POST') return remove(env, request);
      if (p === '/api/invite' && request.method === 'POST') return sendInvites(env, request);
      if (p.startsWith('/api/admin')) return admin(env, request, url);
      if (p.startsWith('/api/')) return bad('no such route', 404);

      // ----- admin page -----
      if (p === '/admin' || p.startsWith('/admin/')) return adminPage(env, request, url);

      // ----- everything else is the maker -----
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error('worker error', p, e);
      return p.startsWith('/api/') ? bad('server error', 500) : html(notFoundPage(), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env));
  },
};

// ---------------------------------------------------------------- settings
async function settings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    termsVersion: s.terms_version || TERMS_VERSION_FALLBACK,
    dogOfTheDay: s.dog_of_the_day || '',
  };
}

const postingOn = (env) => String(env.POSTING_ENABLED) === 'true';
const devMode = (env) => String(env.DEV_MODE) === 'true';
const site = (env) => env.SITE_URL || 'https://dedication.jetsonsjourney.com';
const secret = (env) => env.SESSION_SECRET || 'dev';
// Production never runs on the 'dev' fallback: without SESSION_SECRET, sign-in, posting and invites refuse.
const ready = (env) => devMode(env) || !!env.SESSION_SECRET;
const NOT_READY = () => bad('the wall is not configured yet', 503);
const MAX_INVITES = 5;                 // per dedication, for its lifetime
const inviteKey = (env, id) => sha256(`${secret(env)}|invite|${id}`);
const inviteeHash = (env, email) => sha256(`${secret(env)}|invitee|${email}`);
const unsubSig = async (env, hash) => (await sha256(`${secret(env)}|unsub|${hash}`)).slice(0, 24);

async function health(env) {
  const t = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first();
  return json({ ok: true, posting: postingOn(env), entries: t.n, time: now() });
}

async function config(env, request) {
  const s = await settings(env);
  const sess = await readSession(secret(env), request.headers.get('cookie'));
  return json({ posting: postingOn(env), terms_version: s.termsVersion, signed_in: sess ? sess.email : null });
}

// ---------------------------------------------------------------- sign-in by magic link
async function authLink(env, request, url) {
  if (!postingOn(env) && !devMode(env)) return bad('posting is not open yet', 403);
  if (!ready(env)) return NOT_READY();
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return bad('a valid email is needed');
  const token = tokenHex(24);
  const exp = now() + 15 * 60;
  await env.DB.prepare(`INSERT INTO owners (email, magic_token, token_expires, created_at, last_seen_at) VALUES (?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET magic_token = excluded.magic_token, token_expires = excluded.token_expires`)
    .bind(email, await sha256(token), exp, now(), now()).run();
  const next = typeof body.next === 'string' && body.next.startsWith('/') ? body.next : '/';
  const link = `${site(env)}/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`;
  const r = await sendMail(env, {
    to: email, kind: 'signin',
    subject: 'Your sign-in link for the Dedication Wall',
    text: `Tap to sign in (good for 15 minutes):\n${link}\n\nIf you didn’t ask for this, ignore it.`,
    html: `<p>Tap to sign in (good for 15 minutes):</p><p><a href="${link}">${link}</a></p><p>If you didn’t ask for this, ignore it.</p>`,
  });
  return json({ ok: true, sent: r.status === 'sent', ...(devMode(env) && r.status !== 'sent' ? { dev_link: link } : {}) });
}

async function authVerify(env, request, url) {
  const token = url.searchParams.get('token') || '';
  const email = (url.searchParams.get('email') || '').toLowerCase();
  const next = url.searchParams.get('next') || '/';
  const row = await env.DB.prepare('SELECT magic_token, token_expires FROM owners WHERE email = ?').bind(email).first();
  if (!row || !row.magic_token || row.token_expires < now() || row.magic_token !== (await sha256(token))) {
    return html(simplePage({ title: 'That link has expired', bodyHtml: '<p>Sign-in links last 15 minutes. <a href="/">Go back and ask for a new one.</a></p>', noindex: true }), 400);
  }
  await env.DB.prepare('UPDATE owners SET magic_token = NULL, token_expires = NULL, last_seen_at = ? WHERE email = ?').bind(now(), email).run();
  const cookie = sessionCookie(await makeSession(secret(env), email), url.protocol === 'https:');
  return new Response(null, { status: 302, headers: { location: next.startsWith('/') ? next : '/', 'set-cookie': cookie } });
}

async function requireSession(env, request) {
  return readSession(secret(env), request.headers.get('cookie'));
}

// ---------------------------------------------------------------- posting
// multipart/form-data: original, story, feed, card (JPEG), dog_name, line, mode, background_id,
// attest (on), newsletter (on|off), test (on|off, DEV only).
async function post(env, request, ctx) {
  if (!postingOn(env) && !devMode(env)) return bad('posting is not open yet', 403);
  if (!ready(env)) return NOT_READY();
  const sess = await requireSession(env, request);
  if (!sess) return bad('sign in first', 401);
  const form = await request.formData().catch(() => null);
  if (!form) return bad('expected multipart form data');

  const dog_name = String(form.get('dog_name') || '').trim().slice(0, 40);
  const line = String(form.get('line') || '').trim().slice(0, 120);
  const mode = form.get('mode') === 'in_memory' ? 'in_memory' : 'for';
  const background_id = String(form.get('background_id') || '').trim().slice(0, 64);
  const attest = form.get('attest') === 'on';
  const newsletter = form.get('newsletter') === 'on';
  const is_test = devMode(env) && form.get('test') === 'on' ? 1 : 0;
  if (!dog_name || !line || !background_id) return bad('dog name, line and background are needed');
  if (!attest) return bad('the age and ownership box must be ticked');

  const files = {};
  for (const k of ['original', 'story', 'feed', 'card']) {
    const f = form.get(k);
    if (!(f instanceof File)) return bad(`missing file: ${k}`);
    if (f.size > (k === 'original' ? MAX_PHOTO : MAX_CUT)) return bad(`${k} is too large`);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && k === 'original') return bad('original must be an image');
    if (k !== 'original' && f.type !== 'image/jpeg') return bad(`${k} must be a JPEG`);
    files[k] = f;
  }

  const s = await settings(env);
  const id = shortId(8);
  const code = shortId(10);
  const keys = { original: `entries/${id}/original.jpg`, story: `entries/${id}/story.jpg`, feed: `entries/${id}/feed.jpg`, card: `entries/${id}/card.jpg` };
  await Promise.all(Object.entries(keys).map(([k, key]) => env.PHOTOS.put(key, files[k].stream(), { httpMetadata: { contentType: files[k].type || 'image/jpeg' } })));

  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO entries (id, dog_name, line, mode, background_id, photo_key, story_key, feed_key, card_key, owner_email, status, attested_at, terms_version, invite_code, created_at, is_test)
      VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)`)
      .bind(id, dog_name, line, mode, background_id, keys.original, keys.story, keys.feed, keys.card, sess.email, t, s.termsVersion, code, t, is_test),
    env.DB.prepare('INSERT INTO invites (code, entry_id) VALUES (?,?)').bind(code, id),
    ...(newsletter ? [env.DB.prepare('UPDATE owners SET newsletter_opt_in = 1, newsletter_at = ? WHERE email = ?').bind(t, sess.email)] : []),
  ]);

  // Screen now; publish or queue. The owner hears by email either way.
  ctx.waitUntil(screenAndPublish(env, id));
  if (newsletter) ctx.waitUntil(subscribeNewsletter(env, sess.email));
  return json({ ok: true, id, url: `${site(env)}/d/${id}`, invite: `${site(env)}/i/${code}`, status: 'pending' });
}

async function screenAndPublish(env, id) {
  const e = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
  if (!e) return;
  const obj = await env.PHOTOS.get(e.card_key);
  const cardBytes = obj ? await obj.arrayBuffer() : new ArrayBuffer(0);
  const v = await screen(env, { dog_name: e.dog_name, line: e.line, cardBytes });
  const t = now();
  if (v.verdict === 'live') {
    await env.DB.prepare('UPDATE entries SET status = \'live\', screen_result = ?, screened_at = ?, live_at = ? WHERE id = ?').bind(JSON.stringify(v), t, t, id).run();
    await notifyLive(env, { ...e, live_at: t });
  } else if (v.verdict === 'rejected') {
    await env.DB.prepare('UPDATE entries SET screen_result = ?, screened_at = ? WHERE id = ?').bind(JSON.stringify(v), t, id).run();
    await rejectEntry(env, e);
  } else {
    await env.DB.prepare('UPDATE entries SET screen_result = ?, screened_at = ? WHERE id = ?').bind(JSON.stringify(v), t, id).run();
    // stays pending for the admin queue
  }
}

// Declined: the status changes, the photos are deleted at once, the owner hears why in general terms.
async function rejectEntry(env, e) {
  await env.DB.prepare('UPDATE entries SET status = \'rejected\' WHERE id = ?').bind(e.id).run();
  await deletePhotos(env, e);
  await sendMail(env, { to: e.owner_email, kind: 'rejected', entry_id: e.id, subject: 'About your dedication',
    text: `Thanks for making a dedication for ${e.dog_name}. I couldn’t post it to the wall as submitted, and its photo has been deleted. If you think that’s a mistake, reply to this email and I will take a look.`,
    html: `<p>Thanks for making a dedication for ${h(e.dog_name)}. I couldn’t post it to the wall as submitted, and its photo has been deleted. If you think that’s a mistake, reply to this email and I will take a look.</p>` });
}

async function deletePhotos(env, e) {
  try { await env.PHOTOS.delete([e.photo_key, e.story_key, e.feed_key, e.card_key].filter(Boolean)); }
  catch (err) { console.error('photo delete', e.id, err); }
}

async function notifyLive(env, e) {
  const page = `${site(env)}/d/${e.id}`;
  const inviteUrl = `${site(env)}/i/${e.invite_code}`;
  const inviteForm = `${page}?k=${await inviteKey(env, e.id)}`;
  const removeUrl = `${site(env)}/api/remove?id=${e.id}&key=${await sha256(`${secret(env)}|remove|${e.id}`)}`;
  await sendMail(env, { to: e.owner_email, kind: 'live', entry_id: e.id,
    subject: `${e.dog_name} is on the wall`,
    text: `${e.dog_name}’s dedication is live:\n${page}\n\nShare this link so friends can see it and leave a heart:\n${inviteUrl}\n\nInvite up to five friends by email (we send one short note and keep no addresses):\n${inviteForm}\n\nTo take it down at any time:\n${removeUrl}`,
    html: `<p><strong>${h(e.dog_name)}</strong>’s dedication is live: <a href="${page}">${page}</a></p><p>Share this link so friends can see it and leave a heart:<br><a href="${inviteUrl}">${inviteUrl}</a></p><p>Invite up to five friends by email (we send one short note and keep no addresses):<br><a href="${inviteForm}">${inviteForm}</a></p><p style="color:#6f665d;font-size:13px">To take it down at any time: <a href="${removeUrl}">remove this dedication</a>.</p>` });
}

// ---------------------------------------------------------------- email invites
// Up to five addresses per dedication, from the owner (session or the signed link in the "live" email),
// live entries only. Nothing about the invitee is stored: a salted hash in invite_sends and, if they ask,
// in suppressed. The copy is fixed; the owner cannot add a message.
async function sendInvites(env, request) {
  if (!ready(env)) return NOT_READY();
  const form = await request.formData().catch(() => null);
  if (!form) return bad('expected form data');
  const id = String(form.get('id') || '').replace(/[^a-z0-9]/g, '');
  const k = String(form.get('k') || '');
  const e = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
  if (!e) return bad('not found', 404);
  let allowed = k && k === (await inviteKey(env, id));
  if (!allowed) {
    const sess = await requireSession(env, request);
    allowed = !!(sess && sess.email === e.owner_email);
  }
  if (!allowed) return bad('not allowed', 403);
  const back = `${site(env)}/d/${id}${k ? `?k=${k}` : ''}`;
  if (e.status !== 'live') return Response.redirect(`${back}${k ? '&' : '?'}msg=notlive`, 303);

  const raw = String(form.get('emails') || '');
  const wanted = [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(validEmail))].slice(0, MAX_INVITES);
  const sentBefore = (await env.DB.prepare('SELECT COUNT(*) AS n FROM invite_sends WHERE entry_id = ?').bind(id).first()).n;
  let left = Math.max(0, MAX_INVITES - sentBefore);
  let sent = 0, skipped = 0;
  for (const email of wanted) {
    if (left <= 0) { skipped++; continue; }
    if (email === e.owner_email) { skipped++; continue; }
    const hash = await inviteeHash(env, email);
    const dup = await env.DB.prepare('SELECT 1 FROM invite_sends WHERE entry_id = ? AND to_hash = ?').bind(id, hash).first();
    const sup = await env.DB.prepare('SELECT 1 FROM suppressed WHERE to_hash = ?').bind(hash).first();
    if (dup || sup) { skipped++; continue; }
    const unsub = `${site(env)}/u/${hash}?s=${await unsubSig(env, hash)}`;
    const r = await sendMail(env, { ...inviteMail(env, e, unsub), to: email, kind: 'invite', entry_id: id, logTo: `invitee:${hash.slice(0, 16)}` });
    if (r.status === 'failed') { skipped++; continue; }
    await env.DB.prepare('INSERT OR IGNORE INTO invite_sends (entry_id, to_hash, sent_at) VALUES (?,?,?)').bind(id, hash, now()).run();
    sent++; left--;
  }
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  if (wantsJson) return json({ ok: true, sent, skipped, left });
  return Response.redirect(`${back}${k ? '&' : '?'}sent=${sent}&skipped=${skipped}`, 303);
}

function inviteMail(env, e, unsub) {
  const dog = e.dog_name;
  const page = `${site(env)}/i/${e.invite_code}`;
  const magnet = env.MAGNET_URL || 'https://www.brockalston.com';
  const addr = env.POSTAL_ADDRESS || 'Natchez Press LLC, Franklin, Tennessee';
  const text = `Someone you know made a dedication for their dog, ${dog}, on the Dedication Wall: the kind a novelist writes to the dog who got them through.

See ${dog}’s page and leave a heart:
${page}

Make one for your own dog. Free, a minute, on your phone:
${site(env)}/

Dog people who read: get Riverspook, a free novella from the world of Jetson’s Journey, when you join Brock Alston’s letters:
${magnet}

This one-time note was sent at the request of ${dog}’s person. We did not keep your address; we remember only not to write again if you ask:
${unsub}

${addr}`;
  const html = `<div style="font-family:Georgia,serif;font-size:17px;line-height:1.5;color:#2b2622">
<p>Someone you know made a dedication for their dog, <strong>${h(dog)}</strong>, on the Dedication Wall: the kind a novelist writes to the dog who got them through.</p>
<p><a href="${page}" style="display:inline-block;background:#1f2a44;color:#fff;text-decoration:none;padding:11px 18px;border-radius:999px">See ${h(dog)}’s page and leave a heart</a></p>
<p>Make one for your own dog. Free, a minute, on your phone: <a href="${site(env)}/">${h(site(env).replace(/^https?:\/\//, ''))}</a></p>
<p>Dog people who read: get <em>Riverspook</em>, a free novella from the world of <em>Jetson’s Journey</em>, when you join Brock Alston’s letters: <a href="${magnet}">${h(magnet)}</a></p>
<p style="color:#6f665d;font-size:13px">This one-time note was sent at the request of ${h(dog)}’s person. We did not keep your address; we remember only not to write again if you ask: <a href="${unsub}">don’t email me again</a>.<br>${h(addr)}</p>
</div>`;
  return { subject: `A dedication for ${dog}`, text, html };
}

async function unsubscribe(env, request, hash, url) {
  hash = hash.replace(/[^a-f0-9]/g, '');
  const s = url.searchParams.get('s') || '';
  if (!hash || s !== (await unsubSig(env, hash))) return html(notFoundPage(), 404);
  await env.DB.prepare('INSERT OR IGNORE INTO suppressed (to_hash, added_at) VALUES (?,?)').bind(hash, now()).run();
  return html(simplePage({ title: 'Done', bodyHtml: '<p>You won’t get another email from the Dedication Wall. We never had your address on file; now we also remember not to send.</p>', noindex: true }));
}

async function subscribeNewsletter(env, email) {
  if (!env.MAILERLITE_API_KEY || !env.MAILERLITE_GROUP_ID) return;
  try {
    await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.MAILERLITE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, groups: [env.MAILERLITE_GROUP_ID] }),
    });
  } catch (e) { console.error('mailerlite', e); }
}

async function mine(env, request) {
  const sess = await requireSession(env, request);
  if (!sess) return bad('sign in first', 401);
  const { results } = await env.DB.prepare('SELECT id, dog_name, line, mode, status, hearts, invite_code, created_at, live_at FROM entries WHERE owner_email = ? AND status != \'removed\' ORDER BY created_at DESC').bind(sess.email).all();
  return json({ ok: true, email: sess.email, entries: results });
}

// Owner removal: the signed link from the "live" email (GET) or a signed-in POST.
// The "take it down" link in the owner's email is a GET: it shows a confirmation with one button, and the
// button posts. Mail scanners and link previews follow GETs, so a GET must never remove anything by itself.
async function removeConfirm(env, request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').replace(/[^a-z0-9]/g, '');
  const key = url.searchParams.get('key') || '';
  if (!id || !key || key !== (await sha256(`${secret(env)}|remove|${id}`))) return html(notFoundPage(), 404);
  const e = await env.DB.prepare('SELECT dog_name, status FROM entries WHERE id = ?').bind(id).first();
  if (!e) return html(notFoundPage(), 404);
  if (e.status === 'removed') return html(simplePage({ title: 'Already down', bodyHtml: '<p>This dedication is already off the wall, and its photos are deleted. <a href="/">Make another any time.</a></p>', noindex: true }));
  const action = `/api/remove?id=${id}&key=${encodeURIComponent(key)}`;
  return html(simplePage({ title: `Take ${h(e.dog_name)}’s dedication down?`, bodyHtml: `<p>This removes ${h(e.dog_name)}’s page from the wall and deletes its photos right away. It can’t be undone, but you can always make a new one.</p><form method="post" action="${action}"><button type="submit" class="btn">Take it down</button></form><p><a href="/d/${id}">Keep it; go back to the page.</a></p>`, noindex: true }));
}

async function remove(env, request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || (await request.formData().catch(() => null))?.get('id');
  if (!id) return bad('id needed');
  const key = url.searchParams.get('key');
  let allowed = false;
  if (key && key === (await sha256(`${secret(env)}|remove|${id}`))) allowed = true;
  if (!allowed) {
    const sess = await requireSession(env, request);
    const e = await env.DB.prepare('SELECT owner_email FROM entries WHERE id = ?').bind(id).first();
    allowed = !!(sess && e && e.owner_email === sess.email);
  }
  if (!allowed) return bad('not allowed', 403);
  const e = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
  if (e && e.status !== 'removed') {
    await env.DB.prepare('UPDATE entries SET status = \'removed\', removed_at = ? WHERE id = ?').bind(now(), id).run();
    await deletePhotos(env, e);
  }
  return html(simplePage({ title: 'Removed', bodyHtml: '<p>The dedication is off the wall, and its photos are deleted. <a href="/">Make another any time.</a></p>', noindex: true }));
}

// ---------------------------------------------------------------- the wall
async function wall(env, request, memory) {
  const s = await settings(env);
  const mode = memory ? 'in_memory' : 'for';
  const { results } = await env.DB.prepare('SELECT id, dog_name, line, hearts FROM entries WHERE status = \'live\' AND mode = ? AND is_test = 0 ORDER BY live_at DESC LIMIT 200').bind(mode).all();
  let dotd = null;
  if (!memory) {
    dotd = s.dogOfTheDay ? await env.DB.prepare('SELECT id, dog_name, line FROM entries WHERE id = ? AND status = \'live\'').bind(s.dogOfTheDay).first() : null;
    if (!dotd && results.length) {
      // deterministic daily pick: the day's hash picks a live entry
      const idx = parseInt((await sha256(centralDay())).slice(0, 8), 16) % results.length;
      dotd = results[idx];
    }
  }
  return html(wallPage({ entries: results, dotd, memory, site: site(env) }), 200, { 'cache-control': 'public, max-age=60' });
}

async function dog(env, request, id) {
  id = id.replace(/[^a-z0-9]/g, '');
  const url = new URL(request.url);
  const e = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
  if (!e) return html(notFoundPage(), 404);
  // The owner may see a pending page (to check it); everyone else only a live one.
  const k = url.searchParams.get('k') || '';
  let owner = k && k === (await inviteKey(env, id));
  if (!owner) { const sess = await requireSession(env, request); owner = !!(sess && sess.email === e.owner_email); }
  if (e.status !== 'live' && !(owner && e.status === 'pending')) return html(notFoundPage(), 404);
  const vh = await visitorHash(request, secret(env));
  const hearted = !!(await env.DB.prepare('SELECT 1 FROM hearts WHERE entry_id = ? AND visitor_hash = ? AND day = ?').bind(id, vh, centralDay()).first());
  let invite = null;
  if (owner) {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM invite_sends WHERE entry_id = ?').bind(id).first()).n;
    invite = { key: k || (await inviteKey(env, id)), left: Math.max(0, MAX_INVITES - n), max: MAX_INVITES,
      sent: url.searchParams.get('sent'), skipped: url.searchParams.get('skipped'), msg: url.searchParams.get('msg'), pending: e.status === 'pending' };
  }
  const headers = owner ? { 'cache-control': 'no-store' } : { 'cache-control': 'public, max-age=60' };
  return html(dogPage({ e, site: site(env), hearted, owner: invite }), 200, headers);
}

async function photo(env, request, rest) {
  // A photo parked for the cutout: served once to Cloudflare's image pipeline, never cached.
  const tmp = /^tmp\/([a-f0-9]{32})\.jpg$/.exec(rest);
  if (tmp) {
    const obj = await env.PHOTOS.get(`tmp/cut/${tmp[1]}.jpg`);
    if (!obj) return new Response('not found', { status: 404 });
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  }
  const m = /^([a-z0-9]+)\/(story|feed|card)\.jpg$/.exec(rest);
  if (!m) return new Response('not found', { status: 404 });
  const e = await env.DB.prepare('SELECT status, owner_email, story_key, feed_key, card_key FROM entries WHERE id = ?').bind(m[1]).first();
  if (!e) return new Response('not found', { status: 404 });
  if (e.status !== 'live') {
    // the owner may preview a pending entry's images (signed key or session); nobody else
    const k = new URL(request.url).searchParams.get('k') || '';
    let owner = e.status === 'pending' && k && k === (await inviteKey(env, m[1]));
    if (!owner && e.status === 'pending') { const sess = await requireSession(env, request); owner = !!(sess && sess.email === e.owner_email); }
    if (!owner) return new Response('not found', { status: 404 });
  }
  const key = { story: e.story_key, feed: e.feed_key, card: e.card_key }[m[2]];
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
}

async function heart(env, request) {
  const form = await request.formData().catch(() => null);
  const id = String(form?.get('entry_id') || '').replace(/[^a-z0-9]/g, '');
  if (!id) return bad('entry_id needed');
  const e = await env.DB.prepare('SELECT status FROM entries WHERE id = ?').bind(id).first();
  if (!e || e.status !== 'live') return bad('not found', 404);
  const vh = await visitorHash(request, secret(env));
  const r = await env.DB.prepare('INSERT OR IGNORE INTO hearts (entry_id, visitor_hash, day) VALUES (?,?,?)').bind(id, vh, centralDay()).run();
  if (r.meta.changes) await env.DB.prepare('UPDATE entries SET hearts = hearts + 1 WHERE id = ?').bind(id).run();
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  if (wantsJson) {
    const n = (await env.DB.prepare('SELECT hearts FROM entries WHERE id = ?').bind(id).first()).hearts;
    return json({ ok: true, hearts: n, counted: !!r.meta.changes });
  }
  return Response.redirect(`${site(env)}/d/${id}`, 303);
}

// ---------------------------------------------------------------- word help
// JSON { mode, name, about } → { ok, lines: [...] }. Nothing typed is stored. Two caps keep the bill
// bounded: per visitor per Central day, and for everyone per day.
const SUGGEST_PER_VISITOR = 12;
const SUGGEST_PER_DAY = 600;
async function suggest(env, request) {
  if (!env.ANTHROPIC_API_KEY) return bad('word help is not on', 503);
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'inMemory' || body.mode === 'in_memory' ? 'in_memory' : 'for';
  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const about = String(body.about || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (about.length < 3) return bad('say a little about your dog');
  const vh = await visitorHash(request, secret(env));
  const day = centralDay();
  const mine = await env.DB.prepare('SELECT n FROM suggest_uses WHERE visitor = ? AND day = ?').bind(vh, day).first();
  if ((mine?.n || 0) >= SUGGEST_PER_VISITOR) return bad('that’s plenty for today; try a line of your own', 429);
  const all = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM suggest_uses WHERE day = ?').bind(day).first();
  if ((all?.n || 0) >= SUGGEST_PER_DAY) return bad('word help is resting for today', 429);
  await env.DB.prepare('INSERT INTO suggest_uses (visitor, day, n) VALUES (?,?,1) ON CONFLICT(visitor, day) DO UPDATE SET n = n + 1').bind(vh, day).run();
  const r = await suggestLines(env, { mode, name, about });
  if (!r.ok) { console.error('suggest', r.error); return bad('no lines just now', 503); }
  return json({ ok: true, lines: r.lines });
}

// ---------------------------------------------------------------- photo cutout
// multipart { photo } (JPEG/PNG, ≤ 6 MB; the maker downsizes first) → PNG with a transparent background.
// The photo is parked in R2 for the seconds Cloudflare Images needs to fetch it, then deleted. Nothing is
// kept; the table only counts uses. Needs Image Transformations enabled on the zone.
const CUTOUT_PER_VISITOR = 8;
const CUTOUT_PER_DAY = 300;
const MAX_CUTOUT_IN = 6 * 1024 * 1024;
async function cutout(env, request, ctx) {
  const form = await request.formData().catch(() => null);
  const f = form && form.get('photo');
  if (!(f instanceof File)) return bad('expected a photo');
  if (f.size > MAX_CUTOUT_IN) return bad('photo is too large', 413);
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return bad('photo must be a JPEG, PNG or WebP');
  const vh = await visitorHash(request, secret(env));
  const day = centralDay();
  const mine = await env.DB.prepare('SELECT n FROM cutout_uses WHERE visitor = ? AND day = ?').bind(vh, day).first();
  if ((mine?.n || 0) >= CUTOUT_PER_VISITOR) return bad('that’s plenty of cutouts for today', 429);
  const all = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM cutout_uses WHERE day = ?').bind(day).first();
  if ((all?.n || 0) >= CUTOUT_PER_DAY) return bad('the cutout is resting for today', 429);
  await env.DB.prepare('INSERT INTO cutout_uses (visitor, day, n) VALUES (?,?,1) ON CONFLICT(visitor, day) DO UPDATE SET n = n + 1').bind(vh, day).run();

  const id = tokenHex(16);
  const key = `tmp/cut/${id}.jpg`;
  await env.PHOTOS.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
  const cleanup = () => env.PHOTOS.delete(key).catch(() => {});
  try {
    const r = await fetch(`${site(env)}/p/tmp/${id}.jpg`, {
      cf: { image: { segment: 'foreground', format: 'png', width: 1600, height: 1600, fit: 'scale-down', metadata: 'none' } },
    });
    const ct = r.headers.get('content-type') || '';
    const resized = r.headers.get('cf-resized') || '';
    if (!r.ok || !ct.startsWith('image/png')) {
      console.error('cutout', r.status, ct, resized);
      ctx.waitUntil(cleanup());
      return bad('cutout is not available right now', 503);
    }
    const png = await r.arrayBuffer();
    ctx.waitUntil(cleanup());
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('cutout', String(e).slice(0, 200));
    ctx.waitUntil(cleanup());
    return bad('cutout is not available right now', 503);
  }
}

async function invite(env, request, code) {
  code = code.replace(/[^a-z0-9]/g, '');
  const inv = await env.DB.prepare('SELECT entry_id FROM invites WHERE code = ?').bind(code).first();
  if (!inv) return html(notFoundPage(), 404);
  await env.DB.prepare('UPDATE invites SET visits = visits + 1 WHERE code = ?').bind(code).run();
  return Response.redirect(`${site(env)}/d/${inv.entry_id}?via=invite`, 302);
}

async function requestBackground(env, request) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, 500);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  if (!text) return bad('say what you’d like');
  await env.DB.prepare('INSERT INTO requests (text, email, created_at) VALUES (?,?,?)').bind(text, validEmail(email) ? email : null, now()).run();
  if (env.CONTACT_EMAIL) {
    await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'alert', subject: 'Background request', text: `${text}\n\nfrom: ${email || '(no email)'}`, html: `<p>${h(text)}</p><p>from: ${h(email || '(no email)')}</p>` });
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------- admin (token in header or ?token=, then cookie)
// With no ADMIN_TOKEN set, a DEV_MODE deployment (local, branch previews) accepts "dev"; production never does.
const adminToken = (env) => env.ADMIN_TOKEN || (devMode(env) ? 'dev' : null);
async function adminAuth(env, request, url) {
  const tok = adminToken(env);
  if (!tok) return false;
  const t = request.headers.get('x-admin-token') || url.searchParams.get('token');
  if (t && t === tok) return true;
  const m = /(?:^|;\s*)dw_admin=([^;]+)/.exec(request.headers.get('cookie') || '');
  return !!(m && m[1] === (await sha256(`${tok}|admin`)));
}

async function admin(env, request, url) {
  if (!(await adminAuth(env, request, url))) return bad('admin token needed', 401);
  const p = url.pathname.replace(/^\/api\/admin\/?/, '');
  if (p === 'queue' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, dog_name, line, mode, owner_email, status, screen_result, created_at, is_test FROM entries WHERE status = \'pending\' ORDER BY created_at ASC LIMIT 100').all();
    return json({ ok: true, entries: results });
  }
  if (p === 'entries' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, dog_name, line, mode, owner_email, status, hearts, created_at, live_at, is_test FROM entries ORDER BY created_at DESC LIMIT 200').all();
    return json({ ok: true, entries: results });
  }
  if (p === 'decide' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || ''), to = String(b.status || '');
    if (!['live', 'rejected', 'hidden'].includes(to)) return bad('status must be live, rejected or hidden');
    const e = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
    if (!e) return bad('not found', 404);
    const t = now();
    if (to === 'live') {
      await env.DB.prepare('UPDATE entries SET status = \'live\', live_at = COALESCE(live_at, ?) WHERE id = ?').bind(t, id).run();
      if (!e.live_at) await notifyLive(env, { ...e, live_at: t });
    } else if (to === 'rejected') {
      await rejectEntry(env, e);
    } else {
      await env.DB.prepare('UPDATE entries SET status = ? WHERE id = ?').bind(to, id).run();
    }
    return json({ ok: true, id, status: to });
  }
  if (p === 'settings' && request.method === 'GET') return json({ ok: true, settings: await settings(env) });
  if (p === 'settings' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const allowed = ['terms_version', 'dog_of_the_day'];
    const stmts = [];
    for (const [k, v] of Object.entries(b)) {
      if (!allowed.includes(k)) continue;
      stmts.push(env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(k, String(v), now()));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, settings: await settings(env) });
  }
  if (p === 'requests' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 200').all();
    return json({ ok: true, requests: results });
  }
  if (p === 'notices' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM notices ORDER BY sent_at DESC LIMIT 100').all();
    return json({ ok: true, notices: results });
  }
  if (p === 'stats' && request.method === 'GET') {
    const q = async (sql) => (await env.DB.prepare(sql).first());
    return json({ ok: true,
      entries: await q('SELECT status, COUNT(*) AS n FROM entries GROUP BY status'),
      live: (await q('SELECT COUNT(*) AS n FROM entries WHERE status = \'live\' AND is_test = 0')).n,
      hearts: (await q('SELECT COALESCE(SUM(hearts),0) AS n FROM entries')).n,
      owners: (await q('SELECT COUNT(*) AS n FROM owners')).n,
      invites: (await q('SELECT COALESCE(SUM(visits),0) AS n FROM invites')).n,
      requests: (await q('SELECT COUNT(*) AS n FROM requests WHERE status = \'new\'')).n,
    });
  }
  return bad('no such admin route', 404);
}

async function adminPage(env, request, url) {
  if (!(await adminAuth(env, request, url))) {
    return html(simplePage({ title: 'Admin', bodyHtml: '<p>Admin token needed. Open this page with <code>?token=…</code> once; a cookie keeps you signed in.</p>', noindex: true }), 401);
  }
  const headers = {};
  if (url.searchParams.get('token')) headers['set-cookie'] = `dw_admin=${await sha256(`${adminToken(env)}|admin`)}; Path=/; Max-Age=${90 * 86400}; HttpOnly; SameSite=Lax; Secure`;
  const s = await settings(env);
  const { results: queue } = await env.DB.prepare('SELECT id, dog_name, line, mode, owner_email, screen_result, created_at, is_test FROM entries WHERE status = \'pending\' ORDER BY created_at ASC LIMIT 50').all();
  const { results: reqs } = await env.DB.prepare('SELECT id, text, email, created_at FROM requests WHERE status = \'new\' ORDER BY created_at DESC LIMIT 50').all();
  const { results: counts } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM entries GROUP BY status').all();
  const body = `
<h2>Queue (${queue.length})</h2>
${queue.length ? queue.map((e) => `<div class="dotd" style="grid-template-columns:120px 1fr"><img src="/p/${h(e.id)}/card.jpg" onerror="this.style.visibility='hidden'" alt="" /><div><strong>${h(e.dog_name)}</strong> · ${e.mode === 'in_memory' ? 'In memory' : 'To'} · ${h(e.owner_email)}${e.is_test ? ' · TEST' : ''}<br><em>${h(e.line)}</em><br><span class="small">${h(e.screen_result || 'not screened yet')}</span><div class="row"><button class="btn" onclick="decide('${h(e.id)}','live')">Publish</button><button class="btn quiet" onclick="decide('${h(e.id)}','rejected')">Reject</button></div></div></div>`).join('') : '<p class="small">Nothing waiting.</p>'}
<h2>Switches</h2>
<form onsubmit="return saveSettings(event)">
<p><label>Dog of the day (entry id, blank = automatic) <input name="dog_of_the_day" value="${h(s.dogOfTheDay)}" size="10"/></label></p>
<p><label>Terms version recorded on new posts <input name="terms_version" value="${h(s.termsVersion)}" size="28"/></label></p>
<p><button class="btn" type="submit">Save</button> <span class="small" id="saved"></span></p>
</form>
<h2>Background requests (${reqs.length} open)</h2>
${reqs.length ? `<ul class="small">${reqs.map((r) => `<li>${h(centralDateTime(r.created_at))} · <em>${h(r.text)}</em>${r.email ? ` · <a href="mailto:${h(r.email)}?subject=Your%20background%20request">${h(r.email)}</a>` : ''}</li>`).join('')}</ul>` : '<p class="small">None open.</p>'}
<p class="small">Entries: ${counts.map((c) => `${h(c.status)} ${c.n}`).join(' · ') || 'none'}. Posting on the live site: <strong>${postingOn(env) ? 'ON' : 'OFF'}</strong> (a deploy variable, not a switch here).</p>
<script>
async function decide(id, status){ const r = await fetch('/api/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,status})}); if((await r.json()).ok) location.reload(); }
async function saveSettings(ev){ ev.preventDefault(); const f=ev.target; const b={}; for(const el of f.elements){ if(!el.name) continue; b[el.name]= el.type==='checkbox'? String(el.checked) : el.value; } const r=await fetch('/api/admin/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}); document.getElementById('saved').textContent=(await r.json()).ok?'Saved.':'Failed.'; return false; }
</script>`;
  return html(simplePage({ title: 'Admin · Dedication Wall', bodyHtml: body, noindex: true }), 200, headers);
}

// ---------------------------------------------------------------- daily cron
async function daily(env) {
  const t = now();
  // Sweep any parked cutout photos a failed request left behind (normally deleted within seconds).
  try {
    const list = await env.PHOTOS.list({ prefix: 'tmp/cut/' });
    const stale = list.objects.filter((o) => (t - Math.floor(new Date(o.uploaded).getTime() / 1000)) > 3600).map((o) => o.key);
    if (stale.length) await env.PHOTOS.delete(stale);
  } catch (err) { console.error('tmp sweep', err); }
  const since = t - 7 * 86400;
  const q = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).first());
  const newLive = (await q('SELECT COUNT(*) AS n FROM entries WHERE status = \'live\' AND is_test = 0 AND live_at > ?', since)).n;
  const pending = (await q('SELECT COUNT(*) AS n FROM entries WHERE status = \'pending\'')).n;
  const hearts = (await q('SELECT COALESCE(SUM(hearts),0) AS n FROM entries WHERE is_test = 0')).n;
  const requests = (await q('SELECT COUNT(*) AS n FROM requests WHERE status = \'new\'')).n;
  const isMonday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date()) === 'Mon';
  if (isMonday && env.CONTACT_EMAIL) {
    await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'digest', subject: 'Dedication Wall, this week',
      text: `New dogs on the wall: ${newLive}\nWaiting in the queue: ${pending}\nHearts so far: ${hearts}\nBackground requests open: ${requests}\n\nAdmin: ${site(env)}/admin`,
      html: `<p>New dogs on the wall: <strong>${newLive}</strong><br>Waiting in the queue: <strong>${pending}</strong><br>Hearts so far: ${hearts}<br>Background requests open: ${requests}</p><p><a href="${site(env)}/admin">Admin</a></p>` });
  }
}
