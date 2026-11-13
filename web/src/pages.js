// Server-rendered pages for the wall. Same paper, ink, navy and EB Garamond as the maker.
import { escapeHtml as h, centralDateTime } from './lib.js';

const CSS = `
:root{--paper:#f7f1e6;--paper-2:#efe6d6;--ink:#2b2622;--quiet:#6f665d;--navy:#1f2a44;--gold:#b48a3c;--serif:"EB Garamond",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:18px;line-height:1.45}
a{color:var(--navy)}
.wrap{max-width:1040px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.eyebrow{font-family:var(--sans);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--quiet)}
h1{font-weight:500;font-size:30px;margin:4px 0 2px}
h1 a{text-decoration:none;color:inherit}
.nav{font-family:var(--sans);font-size:14px;display:flex;gap:14px;flex-wrap:wrap}
.nav a{text-decoration:none;color:var(--navy);border-bottom:1px solid transparent}.nav a.on{border-color:var(--navy)}
.lede{color:var(--quiet);margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
@media(min-width:720px){.grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}}
.card{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #e3d9c7;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.card img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--paper-2)}
.card .meta{padding:8px 10px 10px;font-family:var(--sans);font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.card .name{font-family:var(--serif);font-size:17px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hearts{color:var(--quiet);white-space:nowrap}
.dotd{background:#fff;border:1px solid #e3d9c7;border-radius:12px;padding:14px;margin:0 0 22px;display:grid;grid-template-columns:120px 1fr;gap:14px;align-items:center}
.dotd img{width:120px;height:120px;object-fit:cover;border-radius:8px}
.dotd-ribbon{display:inline-block;background:var(--navy);color:var(--paper);font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:6px 11px;border-radius:999px;margin:0 0 10px}
.share-dog{margin-top:12px}
.dotd .lab{font-family:var(--sans);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}
.dog{display:grid;gap:18px;grid-template-columns:1fr}
@media(min-width:720px){.dog{grid-template-columns:minmax(0,420px) 1fr;align-items:start}}
.dog img.story{width:100%;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.12)}
.dog .words{padding-top:6px}
.mode{font-family:var(--sans);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--quiet)}
.dogname{font-size:34px;font-weight:500;margin:4px 0 8px}
.line{font-style:italic;font-size:22px;margin:0 0 18px}
.btn{display:inline-block;font-family:var(--sans);font-size:15px;font-weight:600;background:var(--navy);color:#fff;border:0;border-radius:999px;padding:11px 18px;text-decoration:none;cursor:pointer}
.btn.quiet{background:#fff;color:var(--navy);border:1px solid var(--navy)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}
.small{font-family:var(--sans);font-size:13px;color:var(--quiet)}
.empty{padding:40px 16px;text-align:center;color:var(--quiet)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid #e3d9c7;font-family:var(--sans);font-size:13px;color:var(--quiet);display:flex;gap:14px;flex-wrap:wrap}
footer a{color:var(--quiet)}
.prose{max-width:760px}.prose h2{font-size:22px;font-weight:500;margin:28px 0 8px}.prose p{margin:0 0 12px}
.owner{background:#fff;border:1px solid #e3d9c7;border-radius:12px;padding:14px 16px;margin:14px 0}
.owner .lab{font-family:var(--sans);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:6px}
.owner p{margin:0 0 8px}
.owner textarea{width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid #e3d9c7;border-radius:10px;background:#fff;color:var(--ink);resize:vertical}
.tell{max-width:640px;margin:36px auto 0;padding:18px 0 0;border-top:1px solid #e3d9c7}
.tell h2{font-size:24px;font-weight:500;margin:0 0 6px}
.tell label{display:block;margin:10px 0 6px}.tell label span{display:block;font-size:15px;color:var(--quiet);margin-bottom:4px}
.tell input{width:100%;font:inherit;font-size:17px;padding:10px 12px;border:1px solid #e3d9c7;border-radius:10px;background:#fff;color:var(--ink)}
`;

// analytics: false leaves out Google Analytics (the admin pages, so Brock's own visits don't count as wall
// traffic; planner session, 11/13). Every public page keeps it.
function layout({ title, description, image, url, body, nav = '', noindex = false, analytics = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${h(title)}</title>
<meta name="description" content="${h(description)}" />
${analytics ? `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZQLVEN820R"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ZQLVEN820R');</script>
` : ''}<meta property="og:title" content="${h(title)}" />
<meta property="og:description" content="${h(description)}" />
<meta property="og:type" content="website" />
${url ? `<meta property="og:url" content="${h(url)}" />` : ''}
${image ? `<meta property="og:image" content="${h(image)}" /><meta property="og:image:width" content="1648" /><meta property="og:image:height" content="1648" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content="${h(image)}" />` : ''}
${noindex ? '<meta name="robots" content="noindex" />' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet" />
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" />
<meta name="apple-mobile-web-app-title" content="Dedication" />
<meta name="theme-color" content="#f7f1e6" />
<style>${CSS}</style>
</head>
<body><div class="wrap">
<div class="top">
  <div><div class="eyebrow">From the novel Jetson’s Journey</div><h1><a href="/">Every Dog Deserves a Dedication</a></h1></div>
  <nav class="nav">${nav}</nav>
</div>
${body}
<footer>
  <a href="/">Make a dedication</a>
  <a href="/wall">The wall</a>
  <a href="/memory">In Memory</a>
  <a href="https://brockalston.com/privacy-policy">Privacy</a>
  <a href="https://brockalston.com/terms-of-use">Terms</a>
  <a href="https://brockalston.com/jetsonsjourney">The book</a>
</footer>
</div><script src="/push.js?v=1" defer></script></body></html>`;
}

const nav = (on) => ['/wall|The wall', '/memory|In Memory', '/|Make yours'].map((s) => {
  const [href, label] = s.split('|');
  return `<a href="${href}"${href === on ? ' class="on"' : ''}>${label}</a>`;
}).join('');

// Tell friends about the wall: up to five addresses, any separator; opens the reader's own mail app.
// Nothing is sent from the server and no address is kept.
const tellHtml = (site) => `
<section class="tell" aria-labelledby="tell-title">
  <h2 id="tell-title">Know a dog who deserves one?</h2>
  <p class="small">Up to five friends. This opens your own mail app with a short note and the link; nothing is sent from here, and we never see the addresses.</p>
  <form id="tell-form">
    <label><span>Friends’ emails (commas, spaces or semicolons between them)</span><input type="text" id="tell-emails" inputmode="email" autocomplete="off" placeholder="ann@example.com, ben@example.com" /></label>
    <p class="small" id="tell-status"></p>
    <div class="row"><button class="btn" type="submit">Open my mail</button><button class="btn quiet" type="button" id="tell-share">Share the wall</button><button class="btn quiet" type="button" id="tell-copy">Copy link</button></div>
  </form>
</section>
<script>
(function(){
  var link=${JSON.stringify(site)}+'/?utm_source=tell&utm_medium=email&utm_campaign=ops-57';
  var subject='Every dog deserves a dedication';
  var body='I found a wall of dedications people wrote to their dogs, and thought of yours. Making one takes about a minute, on your phone:\n\n'+link+'\n\nIt comes from the novel Jetson’s Journey by Brock Alston.';
  var f=document.getElementById('tell-form'),st=document.getElementById('tell-status'),inp=document.getElementById('tell-emails');
  function ev(n,p){try{gtag('event',n,p||{})}catch(e){}}
  f.addEventListener('submit',function(e){e.preventDefault();
    var all=inp.value.split(/[\s,;]+/).map(function(x){return x.trim()}).filter(Boolean);all=all.filter(function(x,i){return all.indexOf(x)===i});
    var good=all.filter(function(x){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)});
    if(!good.length){st.textContent='An email address or two first.';inp.focus();return}
    if(good.length>5){st.textContent='Five at a time, please; send the rest in a second note.';return}
    st.textContent=all.length>good.length?'Skipped '+(all.length-good.length)+' that didn’t look like an address.':'';
    location.href='mailto:'+encodeURIComponent(good.join(','))+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);ev('tell_friends',{count:good.length,page:'wall'})});
  document.getElementById('tell-share').addEventListener('click',function(){var u=${JSON.stringify(site)}+'/wall?utm_source=tell&utm_medium=share&utm_campaign=ops-57';
    if(navigator.share){navigator.share({title:subject,text:'Dogs and the dedications their people wrote for them.',url:u}).then(function(){ev('tell_friends',{via:'sheet',page:'wall'})}).catch(function(){});return}
    navigator.clipboard.writeText(u).then(function(){st.textContent='Link copied; paste it anywhere.'}).catch(function(){st.textContent=u})});
  document.getElementById('tell-copy').addEventListener('click',function(){var u=${JSON.stringify(site)}+'/wall?utm_source=tell&utm_medium=copy&utm_campaign=ops-57';
    navigator.clipboard.writeText(u).then(function(){st.textContent='Link copied.';ev('tell_friends',{via:'copy',page:'wall'})}).catch(function(){st.textContent=u})});
})();
</script>`;

// A post whose pictures were fixed from /admin has new file names (…-v<time>.jpg); the version rides on
// every picture address so browsers that cached the old pictures fetch the new ones.
export const picV = (key) => (/-v(\d+)\.jpg$/.exec(key || '') || [])[1] || '';
const withV = (url, key, sep = '?') => (picV(key) ? `${url}${sep}v=${picV(key)}` : url);
const cardHtml = (e) => `<a class="card" href="/d/${h(e.id)}"><img src="${withV(`/p/${h(e.id)}/card.jpg`, e.card_key)}" alt="${h(e.dog_name)}" loading="lazy" /><div class="meta"><span class="name">${h(e.dog_name)}</span><span class="hearts">♥ ${e.hearts}</span></div></a>`;

export function wallPage({ entries, dotd, memory = false, site }) {
  const title = memory ? 'In Memory · Every Dog Deserves a Dedication' : 'The Dedication Wall';
  const description = memory
    ? 'A quiet wall for the dogs we have lost, each with the dedication they deserved.'
    : 'Dogs and the dedications their people wrote for them, from readers of Jetson’s Journey.';
  const body = `
${!memory && dotd ? `<div class="dotd"><img src="${withV(`/p/${h(dotd.id)}/card.jpg`, dotd.card_key)}" alt="" /><div><div class="lab">Dog of the day</div><div class="dogname" style="font-size:26px;margin:2px 0 4px">${h(dotd.dog_name)}</div><div class="line" style="font-size:18px;margin:0 0 6px">${h(dotd.line)}</div><a href="/d/${h(dotd.id)}">See the page →</a></div></div>` : ''}
<p class="lede">${memory ? 'For the dogs who are gone. Hearts are welcome.' : 'Newest first. Tap a dog to see the page and leave a heart.'}</p>
${entries.length ? `<div class="grid">${entries.map(cardHtml).join('')}</div>` : `<div class="empty">${memory ? 'No dedications here yet.' : 'The wall is empty for now. Be the first: <a href="/">make a dedication</a>.'}</div>`}
${tellHtml(site)}`;
  return layout({ title, description, url: `${site}${memory ? '/memory' : '/wall'}`, body, nav: nav(memory ? '/memory' : '/wall') });
}

// The Share button on a dog's page. Everyone gets the phone's share sheet with the page link (its preview
// is the dog's card). The dog's person (signed in, or from the link in an email) gets the picture itself
// too, ready for Instagram or Facebook: it is fetched while the page settles, because an iPhone only opens
// the share sheet straight from the tap. A computer copies the link instead.
const jsStr = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
function shareRow({ e, site, owner, dotd, modeText }) {
  const link = `${site}/i/${e.invite_code}?utm_source=share-sheet&utm_medium=referral&utm_campaign=ops-57`;
  const text = dotd ? `${e.dog_name} is today’s Dog of the Day on the Dedication Wall.` : `${modeText} ${e.dog_name}: ${e.line}`;
  const label = dotd && owner ? `Share ${e.dog_name}’s day` : `Share ${e.dog_name}`;
  const pic = withV(`/p/${e.id}/feed.jpg`, e.feed_key);
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link.replace('share-sheet', 'share-facebook'))}`;
  return `<div class="row share-dog" id="share"><button class="btn" type="button" id="share-dog">${h(label)}</button><a class="btn quiet" href="${h(fb)}" target="_blank" rel="noopener">Facebook</a></div>
<p class="small" id="share-msg" hidden></p>
<script>(function(){var link=${jsStr(link)},text=${jsStr(text)},pic=${jsStr(pic)},owner=${owner ? 'true' : 'false'},dotd=${dotd ? 'true' : 'false'},file=null;
function ev(n,p){try{gtag('event',n,p||{})}catch(x){}}
function say(t){var m=document.getElementById('share-msg');m.textContent=t;m.hidden=false}
if((owner||location.hash==='#share')&&navigator.canShare){fetch(pic).then(function(r){return r.ok?r.blob():null}).then(function(b){if(!b)return;var f=new File([b],${jsStr(`${e.dog_name.replace(/[^A-Za-z0-9]+/g, '-')}-dedication.jpg`)},{type:'image/jpeg'});if(navigator.canShare({files:[f]}))file=f}).catch(function(){})}
document.getElementById('share-dog').addEventListener('click',function(){
if(file){navigator.share({files:[file],text:text+' '+link}).then(function(){ev('share_dog',{how:'picture',owner:owner,dotd:dotd})}).catch(function(){});return}
if(navigator.share){navigator.share({title:document.title,text:text,url:link}).then(function(){ev('share_dog',{how:'sheet',owner:owner,dotd:dotd})}).catch(function(){});return}
(navigator.clipboard?navigator.clipboard.writeText(link):Promise.reject()).then(function(){say('Link copied. Paste it anywhere.');ev('share_dog',{how:'copy',owner:owner,dotd:dotd})},function(){say(link)})});
if(location.hash==='#share'){var el=document.getElementById('share');try{el.scrollIntoView({block:'center'})}catch(x){}}})();</script>`;
}

// owner: null for visitors; for the dog's person {key, left, max, sent, skipped, msg, pending}.
// dotd: this dog is today's Dog of the Day (a label above the name, and the Share button says so).
export function dogPage({ e, site, hearted = false, owner = null, dotd = false }) {
  const modeText = e.mode === 'in_memory' ? 'In memory of' : 'To';
  const title = `${modeText} ${e.dog_name} · Every Dog Deserves a Dedication`;
  const description = e.line;
  const image = withV(`${site}/p/${e.id}/card.jpg`, e.card_key);
  const q = owner?.pending ? `?k=${h(owner.key)}` : '';
  let ownerHtml = '';
  if (owner) {
    const note = owner.msg === 'notlive' ? 'Invitations go out once the page is live.'
      : owner.sent != null ? `Sent ${h(owner.sent)}${Number(owner.skipped) ? `; ${h(owner.skipped)} skipped (already invited, asked not to be emailed, or over the limit)` : ''}.` : '';
    ownerHtml = `
<div class="owner">
  <div class="lab">${owner.pending ? 'Only you can see this page until it is published' : 'Your page'}</div>
  ${owner.pending ? '<p class="small">We look at every post before it goes up, usually within a day. You’ll get an email when it’s live.</p>' : `
  <p><strong>Invite friends by email.</strong> Up to ${owner.max} per dedication, ${owner.left} left. We send one short note with this page and a heart to leave; we keep no addresses.</p>
  ${owner.left > 0 ? `<form method="post" action="/api/invite">
    <input type="hidden" name="id" value="${h(e.id)}" /><input type="hidden" name="k" value="${h(owner.key)}" />
    <textarea name="emails" rows="3" placeholder="friend@example.com, another@example.com" required></textarea>
    <div class="row"><button class="btn" type="submit">Send invitations</button>${note ? `<span class="small">${note}</span>` : ''}</div>
  </form>` : `<p class="small">${note || 'All five invitations have been sent.'}</p>`}
  <p class="small">Share link that counts visits: <a href="/i/${h(e.invite_code)}">${h(site.replace(/^https?:\/\//, ''))}/i/${h(e.invite_code)}</a></p>`}
</div>`;
  }
  const body = `
<div class="dog"${hearted ? ' data-hearted="1"' : ''}>
  <img class="story" src="${withV(`/p/${h(e.id)}/story.jpg${q}`, e.story_key, q ? '&' : '?')}" alt="${h(e.dog_name)}’s dedication page" />
  <div class="words">
    ${dotd ? '<div class="dotd-ribbon">Today’s Dog of the Day</div>' : ''}
    <div class="mode">${modeText}</div>
    <div class="dogname">${h(e.dog_name)}</div>
    <p class="line">${h(e.line)}</p>
    <div class="row">
      <form method="post" action="/api/heart" style="display:inline"><input type="hidden" name="entry_id" value="${h(e.id)}" /><button class="btn${hearted ? ' quiet' : ''}" type="submit"${hearted || owner?.pending ? ' disabled' : ''}>♥ ${hearted ? 'Hearted today' : 'Heart this dog'} · ${e.hearts}</button></form>
      <a class="btn quiet" href="/">Make one for your dog</a>
    </div>
    ${owner?.pending ? '' : shareRow({ e, site, owner: !!owner, dotd, modeText })}
    ${ownerHtml}
    <p class="small">Posted ${h(centralDateTime(e.live_at || e.created_at))}. Something wrong with this page? <a href="mailto:admin@brockalston.com?subject=Dedication%20${h(e.id)}">Tell us</a>.</p>
  </div>
</div>`;
  // GA4: the owner just sent invitations (the form redirects back with ?sent=N).
  const sentN = owner && owner.sent != null ? Number(owner.sent) : 0;
  const bodyWithEvents = sentN > 0 ? `${body}<script>try{gtag('event','invite_sent',{count:${sentN}})}catch(e){}</script>` : body;
  return layout({ title, description, image, url: `${site}/d/${e.id}`, body: bodyWithEvents, nav: nav(e.mode === 'in_memory' ? '/memory' : '/wall'), noindex: !!owner?.pending });
}

export function simplePage({ title, description = title, bodyHtml, site, path, noindex = false, analytics = true }) {
  return layout({ title, description, url: site && path ? `${site}${path}` : '', body: `<div class="prose">${bodyHtml}</div>`, nav: nav(''), noindex, analytics });
}

export function notFoundPage() {
  return layout({ title: 'Not here', description: 'That page isn’t on the wall.', body: '<div class="empty">That page isn’t on the wall. <a href="/wall">See the wall</a> or <a href="/">make a dedication</a>.</div>', nav: nav(''), noindex: true });
}
