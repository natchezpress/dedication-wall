// Dedication Maker and Wall · the Worker.
// Static files (the maker) come from the ASSETS binding; everything under /api, /d, /wall, /memory, /i, /p,
// /privacy, /terms and /admin is answered here.
import {
  now, centralDay, centralDateTime, shortId, tokenHex, sha256, makeSession, readSession, sessionCookie,
  json, html, bad, escapeHtml as h, validEmail, visitorHash, sendMail, screen, suggestLines,
  failure, alertIfNeeded, sense, FAILURE_LABEL, anthropic,
} from './lib.js';
import { wallPage, dogPage, simplePage, notFoundPage, picV } from './pages.js';

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
      if (p === '/robots.txt') return robots(env);
      if (p === '/sitemap.xml') return sitemap(env);

      // ----- api -----
      if (p === '/api/health') return health(env);
      if (p === '/api/recent' && request.method === 'GET') return recent(env);
      if (p === '/api/config') return config(env, request);
      if (p === '/api/request' && request.method === 'POST') return requestBackground(env, request);
      if (p === '/api/heart' && request.method === 'POST') return heart(env, request);
      if (p === '/api/suggest' && request.method === 'POST') return suggest(env, request);
      if (p === '/api/cutout' && request.method === 'POST') return cutout(env, request, ctx);
      if (p === '/api/auth/link' && request.method === 'POST') return authLink(env, request, url);
      if (p === '/api/auth/verify' && request.method === 'GET') return authVerify(env, request, url);
      if (p === '/api/auth/code' && request.method === 'POST') return authCode(env, request, url);
      if (p === '/api/auth/logout') {
        const back = url.searchParams.get('next') || '/';
        return new Response(null, { status: 302, headers: { location: /^\/(?!\/)/.test(back) ? back : '/', 'set-cookie': 'dw_session=; Path=/; Max-Age=0' } });
      }
      if (p === '/api/post' && request.method === 'POST') return post(env, request, ctx);
      if (p === '/api/mine' && request.method === 'GET') return mine(env, request);
      if (p === '/api/remove' && request.method === 'GET') return removeConfirm(env, request);
      if (p === '/api/remove' && request.method === 'POST') return remove(env, request);
      if (p === '/api/invite' && request.method === 'POST') return sendInvites(env, request);
      if (p === '/api/log' && request.method === 'POST') return pageError(env, request, ctx);
      if (p.startsWith('/api/admin')) return admin(env, request, url);
      if (p.startsWith('/api/')) return bad('no such route', 404);

      // ----- admin page -----
      if (p === '/admin' || p.startsWith('/admin/')) return adminPage(env, request, url);

      // ----- everything else is the maker -----
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error('worker error', p, e);
      ctx.waitUntil(sense(env, p === '/api/post' ? 'post' : 'server', `${p}: ${String(e).slice(0, 200)}`, { ua: request.headers.get('user-agent') }));
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
    notifyLive: (s.notify_live ?? 'true') !== 'false',
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

// The latest dogs on the wall, for the strip under Jetson's card. Public, cached a minute.
async function recent(env) {
  const { results } = await env.DB.prepare('SELECT id, dog_name, hearts, card_key FROM entries WHERE status = \'live\' AND is_test = 0 ORDER BY live_at DESC LIMIT 6').all();
  return json({ ok: true, entries: results.map(({ card_key, ...e }) => ({ ...e, v: picV(card_key) })) }, 200, { 'cache-control': 'public, max-age=60' });
}

// ---------------------------------------------------------------- search engines
// Before these, both paths fell through to the maker's index.html. The preview (DEV_MODE) is a copy of the
// site with test dogs, so it asks not to be crawled at all. /admin is left crawlable on purpose: it answers
// with a noindex header and tag, which a crawler can only see if it is allowed to fetch the page.
function robots(env) {
  const body = devMode(env)
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nDisallow: /api/\nDisallow: /i/\nDisallow: /u/\n\nSitemap: ${site(env)}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

// The maker, both walls, and every live dog's page (test dogs never). Cached an hour.
async function sitemap(env) {
  const { results } = await env.DB.prepare('SELECT id, mode, live_at FROM entries WHERE status = \'live\' AND is_test = 0 ORDER BY live_at DESC LIMIT 5000').all();
  const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
  const newest = (mode) => results.find((e) => e.mode === mode)?.live_at;
  const url = (loc, ts) => `  <url><loc>${h(loc)}</loc>${ts ? `<lastmod>${day(ts)}</lastmod>` : ''}</url>`;
  const base = site(env);
  const lines = [
    url(`${base}/`),
    url(`${base}/wall`, newest('for')),
    url(`${base}/memory`, newest('in_memory')),
    ...results.map((e) => url(`${base}/d/${e.id}`, e.live_at)),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

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
  // Caps: one link per email per minute, six per email per day, twenty per visitor per day (Resend allows 100/day).
  const t = now();
  const day = centralDay();
  const prior = await env.DB.prepare('SELECT link_sent_at, links_day, links_n FROM owners WHERE email = ?').bind(email).first();
  if (prior?.link_sent_at && t - prior.link_sent_at < 60) return bad('a link went out less than a minute ago; give it a moment', 429);
  const todays = prior?.links_day === day ? (prior.links_n || 0) : 0;
  if (todays >= 6) { await sense(env, 'cap', `sign-in links: six for one address today`); return bad('that’s plenty of links for today; check your email, including Promotions', 429); }
  const vh = await visitorHash(request, secret(env));
  const mine = await env.DB.prepare('SELECT n FROM link_uses WHERE visitor = ? AND day = ?').bind(vh, day).first();
  if ((mine?.n || 0) >= 20) { await sense(env, 'cap', 'sign-in links: twenty from one visitor today', { visitor: vh }); return bad('too many sign-in links from here today', 429); }
  await env.DB.prepare('INSERT INTO link_uses (visitor, day, n) VALUES (?,?,1) ON CONFLICT(visitor, day) DO UPDATE SET n = n + 1').bind(vh, day).run();
  const token = tokenHex(24);
  const code = signinCode();
  const exp = t + 15 * 60;
  await env.DB.prepare(`INSERT INTO owners (email, magic_token, magic_code, code_tries, token_expires, created_at, last_seen_at, link_sent_at, links_day, links_n) VALUES (?,?,?,0,?,?,?,?,?,1)
    ON CONFLICT(email) DO UPDATE SET magic_token = excluded.magic_token, magic_code = excluded.magic_code, code_tries = 0, token_expires = excluded.token_expires,
      link_sent_at = excluded.link_sent_at, links_n = CASE WHEN owners.links_day = excluded.links_day THEN owners.links_n + 1 ELSE 1 END, links_day = excluded.links_day`)
    .bind(email, await sha256(token), await codeHash(env, email, code), exp, t, t, t, day).run();
  const next = typeof body.next === 'string' && body.next.startsWith('/') ? body.next : '/';
  const link = `${site(env)}/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`;
  // The code rides in the subject too, so it shows in the phone's notification without opening the email.
  const r = await sendMail(env, {
    to: email, kind: 'signin',
    subject: `Your sign-in code for the Dedication Wall: ${code} (sign-in link inside)`,
    text: `Your sign-in code (good for 15 minutes):\n${code}\n\nType it on the page where you made your dedication.\n\nOr tap this link on the same phone, in the same browser:\n${link}\n\nIf you didn’t ask for this, ignore it.`,
    html: `<p>Your sign-in code (good for 15 minutes):</p><p style="font-size:28px;letter-spacing:0.18em;font-weight:600;margin:6px 0 10px">${code}</p><p>Type it on the page where you made your dedication.</p><p style="color:#6f665d;font-size:13px">Or tap this link on the same phone, in the same browser: <a href="${link}">sign in</a>.</p><p style="color:#6f665d;font-size:13px">If you didn’t ask for this, ignore it.</p>`,
  });
  return json({ ok: true, sent: r.status === 'sent', ...(devMode(env) && r.status !== 'sent' ? { dev_link: link, dev_code: code } : {}) });
}

// Six digits, every value equally likely (bytes past the last whole million are drawn again).
function signinCode() {
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n < 4294000000) return String(n % 1000000).padStart(6, '0');
  }
}
const codeHash = (env, email, code) => sha256(`${secret(env)}|code|${email}|${code}`);

// The code is the link's twin: same 15 minutes, spent together, five wrong tries and it is gone.
async function authCode(env, request, url) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').replace(/\D/g, '');
  if (!validEmail(email) || code.length !== 6) return bad('type the six digits from the email');
  const row = await env.DB.prepare('SELECT magic_code, code_tries, token_expires FROM owners WHERE email = ?').bind(email).first();
  if (!row || !row.magic_code || !row.token_expires || row.token_expires < now()) return bad('that code has expired; send a new one', 400);
  if ((row.code_tries || 0) >= 5) return bad('too many tries; send a new one', 429);
  if (row.magic_code !== (await codeHash(env, email, code))) {
    await env.DB.prepare('UPDATE owners SET code_tries = code_tries + 1 WHERE email = ?').bind(email).run();
    return bad((row.code_tries || 0) + 1 >= 5 ? 'too many tries; send a new one' : 'that code doesn’t match; check the newest email', 400);
  }
  await env.DB.prepare('UPDATE owners SET magic_token = NULL, magic_code = NULL, code_tries = 0, token_expires = NULL, last_seen_at = ? WHERE email = ?').bind(now(), email).run();
  const cookie = sessionCookie(await makeSession(secret(env), email), url.protocol === 'https:');
  return json({ ok: true, email }, 200, { 'set-cookie': cookie });
}

async function authVerify(env, request, url) {
  const token = url.searchParams.get('token') || '';
  const email = (url.searchParams.get('email') || '').toLowerCase();
  const next = url.searchParams.get('next') || '/';
  const row = await env.DB.prepare('SELECT magic_token, token_expires FROM owners WHERE email = ?').bind(email).first();
  if (!row || !row.magic_token || row.token_expires < now() || row.magic_token !== (await sha256(token))) {
    return html(simplePage({ title: 'That link has expired', bodyHtml: '<p>Sign-in links last 15 minutes. <a href="/#step-post">Go back and ask for a new one.</a> Your dedication is still there.</p>', noindex: true }), 400);
  }
  await env.DB.prepare('UPDATE owners SET magic_token = NULL, magic_code = NULL, code_tries = 0, token_expires = NULL, last_seen_at = ? WHERE email = ?').bind(now(), email).run();
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
  const broken = (v.reasons || []).find((x) => /^(screening api|screening error|unparseable verdict|encode error|card image missing)/.test(String(x)));
  if (broken) await sense(env, 'screen', `${id}: ${broken}`);
  const t = now();
  if (v.verdict === 'live') {
    await env.DB.prepare('UPDATE entries SET status = \'live\', screen_result = ?, screened_at = ?, live_at = ? WHERE id = ?').bind(JSON.stringify(v), t, t, id).run();
    await notifyLive(env, { ...e, live_at: t });
    await notifyAdminLive(env, e);
  } else if (v.verdict === 'rejected') {
    await env.DB.prepare('UPDATE entries SET screen_result = ?, screened_at = ? WHERE id = ?').bind(JSON.stringify(v), t, id).run();
    await rejectEntry(env, e);
  } else {
    await env.DB.prepare('UPDATE entries SET screen_result = ?, screened_at = ? WHERE id = ?').bind(JSON.stringify(v), t, id).run();
    await notifyAdminQueue(env, e, v); // stays pending for the admin queue; Brock hears at once
  }
}

// Two notes to Brock (CONTACT_EMAIL). "Needs your look" always; "New dog on the wall" behind the
// notify_live switch on /admin (default on while the wall is small).
async function notifyAdminQueue(env, e, v) {
  if (!env.CONTACT_EMAIL) return;
  const reasons = Array.isArray(v?.reasons) && v.reasons.length ? v.reasons.join('; ') : 'no reason given';
  const admin = `${site(env)}/admin`;
  await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'alert', entry_id: e.id,
    subject: `Needs your look: ${e.dog_name}`,
    text: `A dedication is waiting in the queue.\n\n${e.mode === 'in_memory' ? 'In memory of' : 'To'} ${e.dog_name}\n${e.line}\nfrom ${e.owner_email}${e.is_test ? ' (test)' : ''}\n\nScreener: ${reasons}\n\nPublish or reject: ${admin}`,
    html: `<p>A dedication is waiting in the queue.</p><p><strong>${e.mode === 'in_memory' ? 'In memory of' : 'To'} ${h(e.dog_name)}</strong><br><em>${h(e.line)}</em><br>from ${h(e.owner_email)}${e.is_test ? ' (test)' : ''}</p><p>Screener: ${h(reasons)}</p><p><a href="${admin}">Publish or reject</a></p>` });
}
async function notifyAdminLive(env, e) {
  if (!env.CONTACT_EMAIL) return;
  const s = await settings(env);
  if (!s.notifyLive) return;
  const page = `${site(env)}/d/${e.id}`;
  await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'alert', entry_id: e.id,
    subject: `New dog on the wall: ${e.dog_name}`,
    text: `${e.mode === 'in_memory' ? 'In memory of' : 'To'} ${e.dog_name}\n${e.line}\nfrom ${e.owner_email}${e.is_test ? ' (test)' : ''}\n\n${page}\n\nTurn these off on /admin (Switches) when the wall is busy.`,
    html: `<p><strong>${e.mode === 'in_memory' ? 'In memory of' : 'To'} ${h(e.dog_name)}</strong><br><em>${h(e.line)}</em><br>from ${h(e.owner_email)}${e.is_test ? ' (test)' : ''}</p><p><a href="${page}">${page}</a></p><p style="color:#6f665d;font-size:13px">Turn these off on /admin (Switches) when the wall is busy.</p>` });
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
  const inviteUrl = `${site(env)}/i/${e.invite_code}?utm_source=share&utm_medium=referral&utm_campaign=ops-57`;
  const inviteForm = `${page}?k=${await inviteKey(env, e.id)}`;
  const removeUrl = `${site(env)}/api/remove?id=${e.id}&key=${await sha256(`${secret(env)}|remove|${e.id}`)}`;
  const homeUrl = `${site(env)}/?utm_source=live-email&utm_medium=email&utm_campaign=ops-57`;
  await sendMail(env, { to: e.owner_email, kind: 'live', entry_id: e.id,
    subject: `${e.dog_name} is on the wall`,
    text: `${e.dog_name}’s dedication is live:\n${page}\n\nShare this link so friends can see it and leave a heart:\n${inviteUrl}\n\nInvite up to five friends by email (we send one short note and keep no addresses):\n${inviteForm}\n\nKeep the wall on your phone. Add it to your home screen so you can easily come back and visit the Dedication Wall, and see who’s new. Open ${site(env)} on your phone, then:\niPhone: tap Share, then Add to Home Screen.\nAndroid: tap ⋮, then Add to Home screen.\n\nTo take it down at any time:\n${removeUrl}`,
    html: `<p><strong>${h(e.dog_name)}</strong>’s dedication is live: <a href="${page}">${page}</a></p><p>Share this link so friends can see it and leave a heart:<br><a href="${inviteUrl}">${inviteUrl}</a></p><p>Invite up to five friends by email (we send one short note and keep no addresses):<br><a href="${inviteForm}">${inviteForm}</a></p><p><strong>Keep the wall on your phone.</strong> Add it to your home screen so you can easily come back and visit the Dedication Wall, and see who’s new. <a href="${homeUrl}">Open the wall on your phone</a>, then:<br><strong>iPhone:</strong> tap Share, then Add to Home Screen.<br><strong>Android:</strong> tap ⋮, then Add to Home screen.</p><p style="color:#6f665d;font-size:13px">To take it down at any time: <a href="${removeUrl}">remove this dedication</a>.</p>` });
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
  const page = `${site(env)}/i/${e.invite_code}?utm_source=invite&utm_medium=email&utm_campaign=ops-57`;
  const maker = `${site(env)}/?utm_source=invite&utm_medium=email&utm_campaign=ops-57`;
  const magnet = env.MAGNET_URL || 'https://www.brockalston.com';
  const addr = env.POSTAL_ADDRESS || 'Natchez Press LLC, Franklin, Tennessee';
  const text = `Someone you know made a dedication for their dog, ${dog}, on the Dedication Wall: the kind that opens a book, written for a dog.

See ${dog}’s page and leave a heart:
${page}

Make one for your own dog. Free, a minute, on your phone:
${maker}

Dog people who read: get Riverspook, a free novella from the world of Jetson’s Journey, when you join Brock Alston’s letters:
${magnet}

This one-time note was sent at the request of ${dog}’s person. We did not keep your address; we remember only not to write again if you ask:
${unsub}

${addr}`;
  const html = `<div style="font-family:Georgia,serif;font-size:17px;line-height:1.5;color:#2b2622">
<p>Someone you know made a dedication for their dog, <strong>${h(dog)}</strong>, on the Dedication Wall: the kind that opens a book, written for a dog.</p>
<p><a href="${page}" style="display:inline-block;background:#1f2a44;color:#fff;text-decoration:none;padding:11px 18px;border-radius:999px">See ${h(dog)}’s page and leave a heart</a></p>
<p>Make one for your own dog. Free, a minute, on your phone: <a href="${maker}">${h(site(env).replace(/^https?:\/\//, ''))}</a></p>
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
    const r = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.MAILERLITE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, groups: [env.MAILERLITE_GROUP_ID] }),
    });
    if (!r.ok) await sense(env, 'newsletter', `mailerlite ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  } catch (e) { console.error('mailerlite', e); await sense(env, 'newsletter', String(e).slice(0, 200)); }
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
  const { results } = await env.DB.prepare('SELECT id, dog_name, line, hearts, card_key FROM entries WHERE status = \'live\' AND mode = ? AND is_test = 0 ORDER BY live_at DESC LIMIT 200').bind(mode).all();
  let dotd = null;
  if (!memory) {
    dotd = s.dogOfTheDay ? await env.DB.prepare('SELECT id, dog_name, line, card_key FROM entries WHERE id = ? AND status = \'live\'').bind(s.dogOfTheDay).first() : null;
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
  if ((mine?.n || 0) >= SUGGEST_PER_VISITOR) { await sense(env, 'cap', 'word help: one visitor at the daily limit', { visitor: vh }); return bad('that’s plenty for today; try a line of your own', 429); }
  const all = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM suggest_uses WHERE day = ?').bind(day).first();
  if ((all?.n || 0) >= SUGGEST_PER_DAY) { await sense(env, 'cap', 'word help: the whole site at the daily limit'); return bad('word help is resting for today', 429); }
  await env.DB.prepare('INSERT INTO suggest_uses (visitor, day, n) VALUES (?,?,1) ON CONFLICT(visitor, day) DO UPDATE SET n = n + 1').bind(vh, day).run();
  const r = await suggestLines(env, { mode, name, about });
  if (!r.ok) { console.error('suggest', r.error); await sense(env, 'words', r.error, { visitor: vh, ua: request.headers.get('user-agent') }); return bad('no lines just now', 503); }
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
  if ((mine?.n || 0) >= CUTOUT_PER_VISITOR) { ctx.waitUntil(sense(env, 'cap', 'cutout: one visitor at the daily limit', { visitor: vh })); return bad('that’s plenty of cutouts for today', 429); }
  const all = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM cutout_uses WHERE day = ?').bind(day).first();
  if ((all?.n || 0) >= CUTOUT_PER_DAY) { ctx.waitUntil(sense(env, 'cap', 'cutout: the whole site at the daily limit')); return bad('the cutout is resting for today', 429); }
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
      ctx.waitUntil(sense(env, 'cutout', `images ${r.status} ${ct} ${resized}`.trim(), { visitor: vh, ua: request.headers.get('user-agent') }));
      return bad('cutout is not available right now', 503);
    }
    const png = await r.arrayBuffer();
    ctx.waitUntil(cleanup());
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('cutout', String(e).slice(0, 200));
    ctx.waitUntil(cleanup());
    ctx.waitUntil(sense(env, 'cutout', String(e).slice(0, 200), { visitor: vh, ua: request.headers.get('user-agent') }));
    return bad('cutout is not available right now', 503);
  }
}

// ---------------------------------------------------------------- the page's own errors
// POST /api/log {detail, step}: a JavaScript error or a dead call, reported by the maker. Five per
// visitor a day; nothing personal is kept, only the message, the step and the browser family.
async function pageError(env, request, ctx) {
  const body = await request.json().catch(() => ({}));
  const detail = String(body.detail || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!detail) return bad('nothing to log');
  // Pages opened before 11/11 still send the browser's blanked “Script error. @ :0” (someone else's script).
  if (/^Script error\.?\s*@\s*:0$/i.test(detail)) return json({ ok: true, kept: false });
  const step = String(body.step || '').slice(0, 40);
  const vh = await visitorHash(request, secret(env));
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM failures WHERE kind = \'page\' AND visitor = ? AND at > ?').bind(vh, now() - 86400).first())?.n || 0;
  if (n >= 5) return json({ ok: true, kept: false });
  ctx.waitUntil(sense(env, 'page', `${step ? `[${step}] ` : ''}${detail}`, { visitor: vh, ua: request.headers.get('user-agent') }));
  return json({ ok: true, kept: true });
}

async function invite(env, request, code) {
  code = code.replace(/[^a-z0-9]/g, '');
  const inv = await env.DB.prepare('SELECT entry_id FROM invites WHERE code = ?').bind(code).first();
  if (!inv) return html(notFoundPage(), 404);
  await env.DB.prepare('UPDATE invites SET visits = visits + 1 WHERE code = ?').bind(code).run();
  // Keep any UTMs the share or invite link carried, so GA4 sees the source on the dog page.
  const q = new URL(request.url).searchParams;
  const utm = [...q.entries()].filter(([k]) => k.startsWith('utm_')).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
  return Response.redirect(`${site(env)}/d/${inv.entry_id}?via=invite${utm}`, 302);
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
// The wall's contact address is the admin (11/12: Brock wanted /admin on his phone without the token).
// Signing in there with the emailed six-digit code, like any poster, opens /admin; the token still works.
const adminEmail = (env) => String(env.ADMIN_EMAIL || env.CONTACT_EMAIL || '').trim().toLowerCase();

async function adminAuth(env, request, url) {
  const tok = adminToken(env);
  if (tok) {
    const t = request.headers.get('x-admin-token') || url.searchParams.get('token');
    if (t && t === tok) return true;
    const m = /(?:^|;\s*)dw_admin=([^;]+)/.exec(request.headers.get('cookie') || '');
    if (m && m[1] === (await sha256(`${tok}|admin`))) return true;
  }
  const who = await readSession(secret(env), request.headers.get('cookie'));
  return !!(who && adminEmail(env) && who.email === adminEmail(env));
}

// /admin for anyone not signed in as the admin: the same email-and-code sign-in the maker uses.
async function adminSignInPage(env, request) {
  const who = await readSession(secret(env), request.headers.get('cookie'));
  const other = who ? `<p class="small">You’re signed in as ${h(who.email)}, which isn’t the admin account. <a href="/api/auth/logout?next=/admin">Sign out</a> first.</p>` : '';
  const bodyHtml = `${other}
<p>Sign in with the wall’s admin email. We’ll send a six-digit code.</p>
<form id="a-ask"><p><label>Email <input type="email" id="a-email" autocomplete="email" required style="width:100%;max-width:340px"></label></p><p><button class="btn" type="submit">Email me a code</button></p></form>
<form id="a-code" hidden><p><label>Six-digit code <input type="text" id="a-digits" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" style="width:10em;font-size:20px;letter-spacing:.15em"></label></p><p><button class="btn" type="submit">Sign in</button></p></form>
<p class="small" id="a-status" aria-live="polite"></p>
<script>
const st = document.getElementById('a-status');
document.getElementById('a-ask').addEventListener('submit', async (e) => {
  e.preventDefault(); st.textContent = 'Sending…';
  const email = document.getElementById('a-email').value.trim();
  const r = await fetch('/api/auth/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, next: '/admin' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { st.textContent = j.error || ('Couldn’t send (' + r.status + ').'); return; }
  document.getElementById('a-ask').hidden = true; document.getElementById('a-code').hidden = false;
  st.textContent = j.dev_code ? 'Test site: the code is ' + j.dev_code + '.' : 'Check your email for the code. It works for 15 minutes.';
  document.getElementById('a-digits').focus();
});
document.getElementById('a-code').addEventListener('submit', async (e) => {
  e.preventDefault(); st.textContent = 'Checking…';
  const email = document.getElementById('a-email').value.trim(), code = document.getElementById('a-digits').value.trim();
  const r = await fetch('/api/auth/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { st.textContent = j.error || ('Couldn’t check the code (' + r.status + ').'); return; }
  location.replace('/admin');
});
document.getElementById('a-digits').addEventListener('input', (e) => { if (e.target.value.replace(/\D/g, '').length === 6) document.getElementById('a-code').requestSubmit(); });
</script>`;
  return html(simplePage({ title: 'Admin', bodyHtml, noindex: true }), 401, { 'x-robots-tag': 'noindex, nofollow' });
}

// Fixing a post's pictures from /admin: the maker reopens the post (/?fix=<id>) with the owner's own photo,
// words and background; the admin moves things and the three new cuts replace the old ones. The words stay
// the owner's (only the pictures change). New files get new names (…-v<time>.jpg), so pages and browsers
// that cached the old pictures ask for the new ones; the old files are deleted once the new ones are in.
async function adminFix(env, request, id, part) {
  const e = await env.DB.prepare('SELECT id, dog_name, line, mode, background_id, photo_key, story_key, feed_key, card_key, status FROM entries WHERE id = ?').bind(id).first();
  if (!e || e.status === 'removed') return bad('no such entry', 404);
  if (!part && request.method === 'GET') {
    return json({ ok: true, entry: { id: e.id, dog_name: e.dog_name, line: e.line, mode: e.mode, background_id: e.background_id, status: e.status } }, 200, { 'cache-control': 'no-store' });
  }
  if (part === 'original' && request.method === 'GET') {
    const obj = await env.PHOTOS.get(e.photo_key);
    if (!obj) return bad('the original photo is missing', 404);
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  }
  if (part === 'pictures' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (!form) return bad('expected multipart form data');
    const files = {};
    for (const k of ['story', 'feed', 'card']) {
      const f = form.get(k);
      if (!(f instanceof File) || f.type !== 'image/jpeg') return bad(`missing JPEG: ${k}`);
      if (f.size > MAX_CUT) return bad(`${k} is too large`);
      files[k] = f;
    }
    const v = now();
    const keys = { story: `entries/${id}/story-v${v}.jpg`, feed: `entries/${id}/feed-v${v}.jpg`, card: `entries/${id}/card-v${v}.jpg` };
    await Promise.all(Object.entries(keys).map(([k, key]) => env.PHOTOS.put(key, files[k].stream(), { httpMetadata: { contentType: 'image/jpeg' } })));
    await env.DB.prepare('UPDATE entries SET story_key = ?, feed_key = ?, card_key = ? WHERE id = ?').bind(keys.story, keys.feed, keys.card, id).run();
    try { await env.PHOTOS.delete([e.story_key, e.feed_key, e.card_key].filter(Boolean)); } catch { /* old files linger; harmless */ }
    return json({ ok: true, url: `${site(env)}/d/${id}`, v });
  }
  return bad('not found', 404);
}

async function admin(env, request, url) {
  if (!(await adminAuth(env, request, url))) return bad('admin token needed', 401);
  const p = url.pathname.replace(/^\/api\/admin\/?/, '');
  const fix = /^entry\/([a-z0-9]+)(?:\/(original|pictures))?$/.exec(p);
  if (fix) return adminFix(env, request, fix[1], fix[2]);
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
    if (!['live', 'rejected', 'hidden', 'removed'].includes(to)) return bad('status must be live, rejected, hidden or removed');
    const e = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
    if (!e) return bad('not found', 404);
    const t = now();
    if (to === 'live') {
      await env.DB.prepare('UPDATE entries SET status = \'live\', live_at = COALESCE(live_at, ?) WHERE id = ?').bind(t, id).run();
      if (!e.live_at) await notifyLive(env, { ...e, live_at: t });
    } else if (to === 'rejected') {
      await rejectEntry(env, e);
    } else if (to === 'removed') {
      // An admin take-down: off the wall and photos deleted, like the owner's own link; no email.
      if (e.status !== 'removed') {
        await env.DB.prepare('UPDATE entries SET status = \'removed\', removed_at = ? WHERE id = ?').bind(t, id).run();
        await deletePhotos(env, e);
      }
    } else {
      await env.DB.prepare('UPDATE entries SET status = ? WHERE id = ?').bind(to, id).run();
    }
    return json({ ok: true, id, status: to });
  }
  if (p === 'settings' && request.method === 'GET') return json({ ok: true, settings: await settings(env) });
  if (p === 'settings' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const allowed = ['terms_version', 'dog_of_the_day', 'notify_live'];
    const stmts = [];
    for (const [k, v] of Object.entries(b)) {
      if (!allowed.includes(k)) continue;
      stmts.push(env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(k, String(v), now()));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, settings: await settings(env) });
  }
  if (p === 'failures' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT at, kind, detail, ua FROM failures WHERE at > ? ORDER BY at DESC LIMIT 50').bind(now() - 86400).all();
    return json({ ok: true, failures: results });
  }
  if (p === 'failures/test' && request.method === 'POST') {
    // Records one failure of the given kind and emails at once, so the whole path can be tried.
    const b = await request.json().catch(() => ({}));
    const kind = FAILURE_LABEL[String(b.kind || '')] ? String(b.kind) : 'server';
    await failure(env, kind, 'test from /admin: nothing is wrong');
    const sent = await alertIfNeeded(env, kind, { force: true });
    return json({ ok: true, kind, sent });
  }
  if (p === 'requests' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 200').all();
    return json({ ok: true, requests: results });
  }
  if (p === 'requests' && request.method === 'POST') {
    // Close (or reopen) a background request from the admin page.
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || ''), to = String(b.status || '');
    if (!['new', 'done'].includes(to)) return bad('status must be new or done');
    const r = await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ?').bind(to, id).run();
    if (!r.meta.changes) return bad('not found', 404);
    return json({ ok: true, id, status: to });
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
  if (!(await adminAuth(env, request, url))) return adminSignInPage(env, request);
  const headers = { 'x-robots-tag': 'noindex, nofollow' };
  if (url.searchParams.get('token')) headers['set-cookie'] = `dw_admin=${await sha256(`${adminToken(env)}|admin`)}; Path=/; Max-Age=${90 * 86400}; HttpOnly; SameSite=Lax; Secure`;
  const s = await settings(env);
  const { results: queue } = await env.DB.prepare('SELECT id, dog_name, line, mode, owner_email, screen_result, created_at, is_test FROM entries WHERE status = \'pending\' ORDER BY created_at ASC LIMIT 50').all();
  const { results: reqs } = await env.DB.prepare('SELECT id, text, email, created_at FROM requests WHERE status = \'new\' ORDER BY created_at DESC LIMIT 50').all();
  const { results: liveRows } = await env.DB.prepare('SELECT id, dog_name, line, owner_email, hearts, live_at, is_test FROM entries WHERE status = \'live\' ORDER BY live_at DESC LIMIT 50').all();
  const { results: counts } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM entries GROUP BY status').all();
  const { results: fails } = await env.DB.prepare('SELECT at, kind, detail, ua FROM failures WHERE at > ? ORDER BY at DESC LIMIT 20').bind(now() - 86400).all();
  // Asked for a sign-in in the last week and never posted (11/11: a friend asked whether she “did it right”
  // and nothing showed where she stopped). Signed in = the newest link or code was used.
  const { results: stalled } = await env.DB.prepare(`SELECT o.email, o.link_sent_at, o.links_n, o.magic_token IS NULL AS signed_in FROM owners o
    WHERE o.link_sent_at > ? AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.owner_email = o.email AND e.created_at >= o.link_sent_at - 3600)
    ORDER BY o.link_sent_at DESC LIMIT 30`).bind(now() - 7 * 86400).all();
  const body = `
<h2>Queue (${queue.length})</h2>
${queue.length ? queue.map((e) => `<div class="dotd" style="grid-template-columns:120px 1fr"><img src="/p/${h(e.id)}/card.jpg" onerror="this.style.visibility='hidden'" alt="" /><div><strong>${h(e.dog_name)}</strong> · ${e.mode === 'in_memory' ? 'In memory' : 'To'} · ${h(e.owner_email)}${e.is_test ? ' · TEST' : ''}<br><em>${h(e.line)}</em><br><span class="small">${h(e.screen_result || 'not screened yet')}</span><div class="row"><button class="btn" onclick="decide('${h(e.id)}','live')">Publish</button><button class="btn quiet" onclick="decide('${h(e.id)}','rejected')">Reject</button><a class="btn quiet" href="/?fix=${h(e.id)}">Fix pictures</a></div></div></div>`).join('') : '<p class="small">Nothing waiting.</p>'}
<h2>On the wall (${liveRows.length})</h2>
${liveRows.length ? `<ul class="small">${liveRows.map((e) => `<li><a href="/d/${h(e.id)}">${h(e.dog_name)}</a> · <em>${h(e.line)}</em> · ${h(e.owner_email)} · ♥ ${e.hearts} · ${h(centralDateTime(e.live_at))}${e.is_test ? ' · TEST' : ''} · <a class="btn quiet" style="padding:4px 10px;font-size:13px" href="/?fix=${h(e.id)}">Fix pictures</a> · <button class="btn quiet" style="padding:4px 10px;font-size:13px" onclick="takeDown('${h(e.id)}','${h(e.dog_name).replace(/'/g, '&#39;')}')">Take down</button></li>`).join('')}</ul>` : '<p class="small">Nothing live.</p>'}
<h2>Started but didn’t post (${stalled.length})</h2>
${stalled.length ? `<ul class="small">${stalled.map((o) => `<li><a href="mailto:${h(o.email)}">${h(o.email)}</a> · asked to sign in ${h(centralDateTime(o.link_sent_at))}${o.links_n > 1 ? ` (${o.links_n} emails that day)` : ''} · ${o.signed_in ? '<strong>signed in</strong>, then stopped' : 'never used the link or code'}</li>`).join('')}</ul>` : '<p class="small">Nobody this week.</p>'}
<h2>Switches</h2>
<form onsubmit="return saveSettings(event)">
<p><label>Dog of the day (entry id, blank = automatic) <input name="dog_of_the_day" value="${h(s.dogOfTheDay)}" size="10"/></label></p>
<p><label>Terms version recorded on new posts <input name="terms_version" value="${h(s.termsVersion)}" size="28"/></label></p>
<p><label><input type="checkbox" name="notify_live"${s.notifyLive ? ' checked' : ''}/> Email me each time a dog goes live (the “needs your look” note always comes)</label></p>
<p><button class="btn" type="submit">Save</button> <span class="small" id="saved"></span></p>
</form>
<h2>Background requests (${reqs.length} open)</h2>
${reqs.length ? `<ul class="small">${reqs.map((r) => `<li>${h(centralDateTime(r.created_at))} · <em>${h(r.text)}</em>${r.email ? ` · <a href="mailto:${h(r.email)}?subject=Your%20background%20request">${h(r.email)}</a>` : ''} · <button class="btn quiet" style="padding:4px 10px;font-size:13px" onclick="closeRequest('${h(r.id)}')">Done</button></li>`).join('')}</ul>` : '<p class="small">None open.</p>'}
<h2>Last 24 hours (${fails.length} failure${fails.length === 1 ? '' : 's'})</h2>
${fails.length ? `<ul class="small">${fails.map((f) => `<li>${h(centralDateTime(f.at))} · <strong>${h(FAILURE_LABEL[f.kind] || f.kind)}</strong> · ${h(f.detail || '')}${f.ua ? ` · ${h(f.ua)}` : ''}</li>`).join('')}</ul>` : '<p class="small">Nothing failed.</p>'}
<p class="small">An email comes when one kind fails three times in an hour (posting: once), then rests six hours. <button class="btn quiet" style="padding:4px 10px;font-size:13px" onclick="testAlert()">Send a test alert</button> <span class="small" id="tested"></span></p>
<p class="small">Entries: ${counts.map((c) => `${h(c.status)} ${c.n}`).join(' · ') || 'none'}. Posting on the live site: <strong>${postingOn(env) ? 'ON' : 'OFF'}</strong> (a deploy variable, not a switch here).</p>
<script>
async function takeDown(id, name){ if(!window.confirm('Take ' + name + ' off the wall and delete the photos? This cannot be undone.')) return; await decide(id, 'removed'); }
async function testAlert(){ const r = await fetch('/api/admin/failures/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'server'})}); const j = await r.json(); document.getElementById('tested').textContent = j.sent ? 'Sent; check your inbox.' : 'Recorded, but no email went out.'; }
async function closeRequest(id){ const r = await fetch('/api/admin/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,status:'done'})}); if((await r.json()).ok) location.reload(); }
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
  const q = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).first());
  // What broke yesterday: one email, only when something did. Then the canary, then the sweep.
  try {
    const { results: byKind } = await env.DB.prepare('SELECT kind, COUNT(*) AS n FROM failures WHERE at > ? AND at <= ? GROUP BY kind ORDER BY n DESC').bind(t - 86400, t).all();
    if (byKind.length && env.CONTACT_EMAIL) {
      const total = byKind.reduce((a, r) => a + r.n, 0);
      const line = byKind.map((r) => `${FAILURE_LABEL[r.kind] || r.kind} ${r.n}`).join(' · ');
      await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'digest', subject: `Dedication Wall: what broke yesterday (${total})`,
        text: `${line}\n\nThe last 24 hours, line by line: ${site(env)}/admin`,
        html: `<p>${h(line)}</p><p><a href="${site(env)}/admin">The last 24 hours, line by line</a></p>` });
    }
  } catch (err) { console.error('failure digest', err); }
  await canary(env);
  try { await env.DB.prepare('DELETE FROM failures WHERE at < ?').bind(t - 30 * 86400).run(); } catch (err) { console.error('failure sweep', err); }
  const since = t - 7 * 86400;
  const newLive = (await q('SELECT COUNT(*) AS n FROM entries WHERE status = \'live\' AND is_test = 0 AND live_at > ?', since)).n;
  const pending = (await q('SELECT COUNT(*) AS n FROM entries WHERE status = \'pending\'')).n;
  const hearts = (await q('SELECT COALESCE(SUM(hearts),0) AS n FROM entries WHERE is_test = 0')).n;
  const requests = (await q('SELECT COUNT(*) AS n FROM requests WHERE status = \'new\'')).n;
  const weekFails = (await q('SELECT COUNT(*) AS n FROM failures WHERE at > ?', since)).n;
  const isMonday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date()) === 'Mon';
  if (isMonday && env.CONTACT_EMAIL) {
    await sendMail(env, { to: env.CONTACT_EMAIL, kind: 'digest', subject: 'Dedication Wall, this week',
      text: `New dogs on the wall: ${newLive}\nWaiting in the queue: ${pending}\nHearts so far: ${hearts}\nBackground requests open: ${requests}\nFailures this week: ${weekFails}\n\nAdmin: ${site(env)}/admin`,
      html: `<p>New dogs on the wall: <strong>${newLive}</strong><br>Waiting in the queue: <strong>${pending}</strong><br>Hearts so far: ${hearts}<br>Background requests open: ${requests}<br>Failures this week: ${weekFails}</p><p><a href="${site(env)}/admin">Admin</a></p>` });
  }
}

// The nightly canary: one tiny call to Anthropic and one to Cloudflare Images, so an expired key or a
// lapsed allowance is caught before a visitor finds it. Each failure records and emails at once.
const CANARY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClRRRWJqFFFVrnUrKzOJ7hFYHBUcsO/Qc0wLNFU7fVrC6bbFdIWyAA2VJJ9M9auUAFFFFIAooooAxNf1drVRa2zgTOPnYHlB/if89RXLMzOxZmLMxySTkk1NeT/ar2afLEO5I3dQOw/KoKtEhXR6BrMjy/Y7uXdu/1buec/wB3Pf2/L0rnKVWZGDKxVlOQQcEGgD0SimQyrPBHMoIWRQwB64IzT6goKKKKAPPZI2ileJxh0Yqw9CKZWx4i042t2blP9VOxPQ/K3fP16/n6Vj1ZIUUVf0fTjqN6Fb/VR4aQ4PI9Pqf8aAOwso2isbeJxh0iVWHoQKmooqCgooooAZNDHcQtDMgdHGCprAu/CxLs9pOoUtxHID8o+vOfyroqKdxHNW/hWUt/pNwiqCOIwSSO/Jxj9a6C2tYLOHyreMImc4Hc/WpaKLgFFFFIZ//Z';
async function canary(env) {
  if (env.ANTHROPIC_API_KEY) {
    try {
      const { r, data } = await anthropic(env, { model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'Say ok.' }] });
      if (!r.ok) await sense(env, 'canary', `anthropic ${r.status}: ${String(data?.error?.message || '').slice(0, 160)}`);
    } catch (e) { await sense(env, 'canary', `anthropic: ${String(e).slice(0, 160)}`); }
  }
  const id = tokenHex(16); // the tmp route only serves 32-hex names
  const key = `tmp/cut/${id}.jpg`;
  try {
    const bytes = Uint8Array.from(atob(CANARY_JPEG), (c) => c.charCodeAt(0));
    await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    const r = await fetch(`${site(env)}/p/tmp/${id}.jpg`, { cf: { image: { segment: 'foreground', format: 'png', width: 64, height: 64, fit: 'scale-down', metadata: 'none' } } });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/png')) await sense(env, 'canary', `images ${r.status} ${ct} ${r.headers.get('cf-resized') || ''}`.trim());
  } catch (e) { await sense(env, 'canary', `images: ${String(e).slice(0, 160)}`); }
  finally { await env.PHOTOS.delete(key).catch(() => {}); }
}
