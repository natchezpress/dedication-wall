// Plain words for the wall's failures (11/16, Brock: “is there a way to have the errors that show up in the
// admin panel be more descriptive?”). Each failure becomes three short lines: what happened, what the person
// saw, and what (if anything) to do. The raw message stays underneath, small, for when it's needed. Used by
// the admin page, the morning “what broke yesterday” email and the alert email.

// “Safari/iOS” → “iPhone or iPad, Safari”.
export function device(ua = '') {
  if (!ua) return '';
  const [br, os] = String(ua).split('/');
  const where = { iOS: 'iPhone or iPad', Android: 'Android phone', Mac: 'Mac', Windows: 'Windows PC' }[os] || 'a device';
  const app = { Safari: 'Safari', Chrome: 'Chrome', Firefox: 'Firefox', Edge: 'Edge' }[br] || 'a browser';
  return `${where}, ${app}`;
}

const NOTHING = 'Nothing, unless it keeps happening.';
const MAIL_KIND = {
  signin: ['a sign-in code', 'They didn’t get their code, so they couldn’t post.'],
  live: ['an “on the wall” email', 'Their dog is up; they just weren’t told.'],
  rejected: ['a “couldn’t go up” email', 'They weren’t told their post didn’t go up.'],
  invite: ['an invitation to a friend', 'The friend never got the invitation.'],
  hearts: ['an evening note', 'One owner missed one evening note.'],
  dotd: ['the Dog of the Week email', 'That dog’s person missed the email.'],
  alert: ['an alert to you', 'You missed one alert email.'],
  digest: ['a summary to you', 'You missed one summary email.'],
};

// Page errors arrive as “[Step] message”; the step is where the person was in the maker.
const PAGE = [
  [/^post: expected multipart/i, {
    what: 'A post didn’t go through: the photo upload arrived broken.',
    saw: 'They saw “Couldn’t post … try again.” Nothing was saved.',
    todo: 'Nothing, if they got through later. Usually an iPhone that lost the kept photo while they fetched their sign-in code.' }],
  [/^post: (failed to fetch|load failed|networkerror|the network connection was lost|cancelled|the internet connection)/i, {
    what: 'A post didn’t go through: the phone lost its connection while sending.',
    saw: 'They saw “Couldn’t post … try again.” Nothing was saved.',
    todo: 'Nothing, if they got through later.' }],
  [/^post: (sign in first|401)/i, {
    what: 'Their sign-in had run out when they tapped Post.',
    saw: 'They were asked to sign in again.',
    todo: 'Nothing.' }],
  [/^post: posting is not open/i, {
    what: 'Someone tried to post while posting was switched off.',
    saw: 'They were told posting isn’t open yet.',
    todo: 'Nothing, unless posting should be on.' }],
  [/^post: /i, {
    what: 'A post didn’t go through: the wall answered with an error.',
    saw: 'They saw “Couldn’t post … try again.” Nothing was saved.',
    todo: 'Worth a look if it happens again or they never got through.' }],
  [/^sign-in link: /i, {
    what: 'Asking for a sign-in code didn’t work.',
    saw: 'They saw an error after asking for their code.',
    todo: NOTHING }],
  [/setPointerCapture|object can not be found here/i, {
    what: 'A drag on the card stopped short (a touch the phone cancelled).',
    saw: 'That one touch did nothing; the next one worked.',
    todo: 'Nothing. Fixed Nov 14.' }],
  [/^unhandled: (load failed|failed to fetch|networkerror|the network connection was lost)/i, {
    what: 'Something the page asked the wall for didn’t arrive, usually a dropped connection.',
    saw: 'Probably nothing, or one step that didn’t respond.',
    todo: NOTHING }],
];

const CAPS = {
  'sign-in links: six for one address today': 'Someone asked for a seventh sign-in code today.',
  'sign-in links: twenty from one visitor today': 'One visitor asked for twenty sign-in codes today.',
  'word help: one visitor at the daily limit': 'One visitor used up their word help for today.',
  'word help: the whole site at the daily limit': 'Word help hit its daily limit for the whole site.',
  'cutout: one visitor at the daily limit': 'One visitor used up their eight dog cut-outs for today.',
  'cutout: the whole site at the daily limit': 'The dog cut-out hit its daily limit for the whole site (300).',
};

const KIND = {
  cutout: () => ({ what: 'The dog cut-out didn’t work for one photo.', saw: 'They got their photo on the plain book page instead.', todo: 'Nothing, unless several fail in a row (then Cloudflare Images may be down).' }),
  words: () => ({ what: 'Word help couldn’t suggest lines.', saw: 'They could still write their own line.', todo: NOTHING }),
  screen: () => ({ what: 'The screener couldn’t check a post.', saw: 'Nothing; the post waits in your queue.', todo: 'Look at the queue on the admin page.' }),
  newsletter: () => ({ what: 'A newsletter sign-up didn’t reach MailerLite.', saw: 'Nothing; their dog posted as usual.', todo: 'If it keeps happening, check the MailerLite key.' }),
  mail: (d) => {
    const k = String(d).split(':')[0].trim();
    const [which, saw] = MAIL_KIND[k] || ['an email', 'Someone missed one email.'];
    return { what: `An email didn’t send: ${which}.`, saw, todo: 'If it keeps happening, check Resend.' };
  },
  cap: (d) => ({
    what: CAPS[d] || `A daily limit was reached (${d}).`,
    saw: /whole site/.test(d) ? 'Everyone was told it’s resting until tomorrow.' : 'They were told they’ve had plenty for today.',
    todo: /whole site/.test(d) ? 'If this happens often, the limit may be too low.' : 'Nothing; the limits keep costs down.' }),
  canary: (d) => ({
    what: `The nightly check found a key that doesn’t work: ${/^images/.test(d) ? 'Cloudflare Images (the dog cut-out)' : 'Anthropic (the screener and word help)'}.`,
    saw: 'Visitors may be hitting errors until it’s fixed.',
    todo: 'Make a new key and paste it into Cloudflare (the Worker’s Settings, Variables and secrets).' }),
  server: (d) => ({ what: `The wall itself hit an error (${String(d).split(':')[0] || 'unknown'}).`, saw: 'Someone may have seen “server error.”', todo: 'Worth a look if it happens again.' }),
  post: () => ({ what: 'A post failed inside the wall.', saw: 'They saw “Couldn’t post … try again.”', todo: 'Worth a look.' }),
};

export function explainFailure({ kind, detail = '' }) {
  if (kind === 'page') {
    const m = String(detail).match(/^\[([^\]]*)\]\s*(.*)$/);
    const step = m ? m[1] : '', msg = m ? m[2] : String(detail);
    for (const [re, out] of PAGE) if (re.test(msg)) return out;
    return { what: `Something broke in the page${step ? ` on the ${step} step` : ''}.`, saw: 'Maybe nothing; maybe one step that didn’t respond.', todo: 'Worth a look if it happens again.' };
  }
  return (KIND[kind] || (() => ({ what: 'Something failed.', saw: '', todo: 'Worth a look if it happens again.' })))(detail);
}

// Failures a person ran into while making or posting a card: worth saying whether they got through later.
export const TRYING = (f) => ['page', 'cutout', 'words', 'post'].includes(f.kind) || (f.kind === 'mail' && /^signin/.test(f.detail || ''));

// The same failure from the same person within ten minutes counts once, with a tally.
export function groupFailures(rows) {
  const out = [];
  for (const f of rows) {
    const g = out.find((x) => x.kind === f.kind && x.detail === f.detail && (x.email || x.visitor) === (f.email || f.visitor) && Math.abs(x.at - f.at) < 600);
    if (g) { g.n++; g.first = Math.min(g.first, f.at); } else out.push({ ...f, n: 1, first: f.at });
  }
  return out;
}
