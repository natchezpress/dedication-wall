// "Meet the Dog of the Day each morning": a small panel that asks once, then one notification a day at
// 9 a.m. the phone's own time (the phone's time zone goes along with the subscription).
// iPhones can only ask inside the home-screen app (iOS 16.4 and later); Android phones can ask in the
// browser too. "Not now" hides it for two weeks. A phone that already said yes is kept in sync quietly.
(function () {
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var android = /Android/.test(navigator.userAgent);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function ev(name, p) { try { gtag('event', name, p || {}); } catch (e) { /* no analytics */ } }
  // In an iPhone browser the notes can't be turned on yet: the wall has to be on the home screen first.
  // Right after a visitor hearts a dog, a card shows the two steps for the browser they're in.
  if (ios && !standalone) { homeCard(); return; }
  function homeCard() {
    if (!document.querySelector('.dog[data-hearted]')) return;
    var KEY = 'dw_home_card';
    try { if (Date.now() - (Number(localStorage.getItem(KEY)) || 0) < 14 * 86400000) return; } catch (e) { /* private mode */ }
    var ua = navigator.userAgent;
    var kind = /FBAN|FBAV|FB_IAB|Instagram|Line\/|GSA\/|Snapchat|Pinterest|LinkedInApp/.test(ua) ? 'inapp'
      : /CriOS/.test(ua) ? 'chrome'
      : /FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua) ? 'other'
      : Number((/Version\/(\d+)/.exec(ua) || [])[1] || 0) >= 26 ? 'safari26' : 'safari';
    var ICON = 'display:inline-block;vertical-align:-3px;margin:0 2px';
    var share = '<svg width="15" height="18" viewBox="0 0 16 20" style="' + ICON + '" aria-hidden="true"><path d="M8 1.5v11M4.2 5.2 8 1.5l3.8 3.7" fill="none" stroke="#1f2a44" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.2 8H3.2c-.7 0-1.2.5-1.2 1.2v8.6c0 .7.5 1.2 1.2 1.2h9.6c.7 0 1.2-.5 1.2-1.2V9.2c0-.7-.5-1.2-1.2-1.2h-2" fill="none" stroke="#1f2a44" stroke-width="1.8" stroke-linecap="round"/></svg>';
    var plus = '<svg width="17" height="17" viewBox="0 0 20 20" style="' + ICON + '" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="#1f2a44" stroke-width="1.8"/><path d="M10 6.5v7M6.5 10h7" stroke="#1f2a44" stroke-width="1.8" stroke-linecap="round"/></svg>';
    var dots = '<span style="display:inline-block;padding:0 6px;border:1px solid #1f2a44;border-radius:999px;font-size:12px;line-height:18px;letter-spacing:1px;color:#1f2a44">•••</span>';
    var add = 'Tap ' + plus + ' <strong>Add to Home Screen</strong>, then <strong>Add</strong>.';
    var steps = {
      safari26: ['Tap ' + dots + ' next to the address, then ' + share + ' <strong>Share</strong>.', add],
      safari: ['Tap ' + share + ' <strong>Share</strong>.', add],
      chrome: ['Tap ' + share + ' at the top right of the address bar.', add],
      other: ['Open this page in <strong>Safari</strong>.', 'Tap ' + dots + ' next to the address, then ' + share + ' <strong>Share</strong>, then ' + plus + ' <strong>Add to Home Screen</strong>.'],
      inapp: ['Open this page in <strong>Safari</strong>: tap ' + dots + ' or the compass, then <strong>Open in Safari</strong>.', 'Tap ' + dots + ' next to the address, then ' + share + ' <strong>Share</strong>, then ' + plus + ' <strong>Add to Home Screen</strong>.'],
    }[kind];
    var box = document.createElement('div');
    box.id = 'home-card';
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Put the wall on your phone');
    box.style.cssText = 'background:#fffaf2;border:1px solid #e3d8c6;border-radius:16px;padding:14px 16px;margin:16px 0;color:#2b2622;line-height:1.45;font-size:15px';
    box.innerHTML = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px"><img src="/email/dog-tile.png" width="44" height="44" alt="" style="flex:none;border-radius:10px">'
      + '<p style="margin:0;font-size:17px;line-height:1.3"><strong>Get the Dog of the Day on your phone each morning.</strong></p></div>'
      + '<p style="margin:0 0 6px">Put the wall on your home screen in two steps:</p>'
      + '<ol style="margin:0 0 6px;padding-left:22px"><li style="margin-bottom:4px">' + steps[0] + '</li><li style="margin-bottom:4px">' + steps[1] + '</li></ol>'
      + '<p style="margin:0 0 4px">Then open the wall from its new icon and tap <strong>Turn on</strong>. One notification at 9 a.m. your time, nothing else.</p>'
      + '<p style="margin:0 0 10px;font-size:13px;color:#6f665d">Don’t see Add to Home Screen? Scroll down the list.</p>'
      + '<button type="button" id="home-card-ok" style="font:inherit;font-size:15px;border-radius:999px;padding:8px 16px;cursor:pointer;border:1px solid #1f2a44;background:transparent;color:#1f2a44">Got it</button>';
    var after = document.getElementById('share') || document.querySelector('.dog .row') || document.querySelector('.top');
    if (after && after.parentNode) after.parentNode.insertBefore(box, after.nextSibling); else document.body.appendChild(box);
    ev('home_card_shown', { browser: kind });
    box.querySelector('#home-card-ok').addEventListener('click', function () {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode */ }
      box.remove(); ev('home_card_closed', { browser: kind });
    });
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (!(ios ? standalone : android)) return;
  var LATER = 'dw_push_later', SYNCED = 'dw_push_synced';
  function bytes(s) { var t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return Uint8Array.from(atob(t), function (c) { return c.charCodeAt(0); }); }
  function send(sub, welcome) {
    var body = JSON.parse(JSON.stringify(sub)); body.welcome = !!welcome;
    try { body.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* old browser: Central */ }
    return fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { if (!r.ok) throw new Error('subscribe ' + r.status); });
  }
  var BTN = 'font:inherit;font-size:16px;border-radius:999px;padding:10px 18px;cursor:pointer;border:1px solid #1f2a44;';
  function panel(reg) {
    var box = document.createElement('div');
    box.id = 'push-ask';
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Morning notes');
    box.style.cssText = 'display:flex;gap:14px;align-items:flex-start;background:#fffaf2;border:1px solid #e3d8c6;border-radius:16px;padding:14px 16px;margin:14px 0 18px;color:#2b2622;line-height:1.4';
    box.innerHTML = '<img src="/email/dog-tile.png" width="48" height="48" alt="" style="flex:none;border-radius:10px">'
      + '<div style="flex:1"><p style="margin:0 0 4px;font-size:17px"><strong>Meet the Dog of the Day each morning.</strong></p>'
      + '<p id="push-msg" style="margin:0 0 10px;font-size:15px;color:#6f665d">One notification at 9 a.m. your time, like a text: that day’s dog and the start of its dedication. Tap it to see the dog and leave a heart. Nothing else.</p>'
      + '<div id="push-btns" style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" id="push-on" style="' + BTN + 'background:#1f2a44;color:#fff">Turn on</button>'
      + '<button type="button" id="push-later" style="' + BTN + 'background:transparent;color:#1f2a44">Not now</button></div></div>';
    var top = document.querySelector('.top');
    if (top && top.parentNode) top.parentNode.insertBefore(box, top.nextSibling); else document.body.insertBefore(box, document.body.firstChild);
    ev('push_shown', { phone: ios ? 'iphone' : 'android' });
    var msg = box.querySelector('#push-msg'), btns = box.querySelector('#push-btns');
    function done(text, ms) { msg.textContent = text; btns.remove(); if (ms) setTimeout(function () { box.remove(); }, ms); }
    box.querySelector('#push-later').addEventListener('click', function () {
      try { localStorage.setItem(LATER, String(Date.now())); } catch (e) { /* private mode */ }
      box.remove(); ev('push_later');
    });
    box.querySelector('#push-on').addEventListener('click', function () {
      // The permission question must come straight from the tap (iPhones insist).
      Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') { done('No problem. You can turn them on any time in your phone’s Settings, under Notifications.', 6000); ev('push_denied', { perm: perm }); return; }
        msg.textContent = 'Turning them on…';
        btns.style.display = 'none';
        // The phone's push service usually answers in a second or two; give up after twenty.
        var giveUp = new Promise(function (_, no) { setTimeout(function () { no(new Error('timeout')); }, 20000); });
        return Promise.race([giveUp, fetch('/api/push/key').then(function (r) { return r.json(); }).then(function (j) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(j.key) });
        }).then(function (sub) { return send(sub, true); })]).then(function () {
          try { sessionStorage.setItem(SYNCED, '1'); } catch (e) { /* private mode */ }
          done('You’re set. A hello is on its way, and the first Dog of the Day arrives ' + (new Date().getHours() < 9 ? 'this morning' : 'tomorrow') + ' at 9 a.m.', 8000);
          ev('push_on', { phone: ios ? 'iphone' : 'android' });
        });
      }).catch(function (err) {
        done('Couldn’t turn them on just now. Try again later.', 6000);
        ev('push_failed', { why: String(err && err.message || err).slice(0, 80) });
      });
    });
  }
  navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
    return reg.pushManager.getSubscription().then(function (sub) {
      if (sub) {
        var synced = false;
        try { synced = sessionStorage.getItem(SYNCED) === '1'; } catch (e) { /* private mode */ }
        if (!synced) send(sub, false).then(function () { try { sessionStorage.setItem(SYNCED, '1'); } catch (e) { /* private mode */ } }).catch(function () {});
        return;
      }
      if (Notification.permission === 'denied') return;
      var later = 0;
      try { later = Number(localStorage.getItem(LATER)) || 0; } catch (e) { /* private mode */ }
      if (Date.now() - later < 14 * 86400000) return;
      panel(reg);
    });
  }).catch(function () { /* no service worker here */ });
})();
