// "Meet the Dog of the Day each morning": a small panel that asks once, then one notification a day at
// 9 a.m. the phone's own time (the phone's time zone goes along with the subscription).
// iPhones can only ask inside the home-screen app (iOS 16.4 and later); Android phones can ask in the
// browser too. "Not now" hides it for two weeks. A phone that already said yes is kept in sync quietly.
(function () {
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var android = /Android/.test(navigator.userAgent);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (!(ios ? standalone : android)) return;
  var LATER = 'dw_push_later', SYNCED = 'dw_push_synced';
  function ev(name, p) { try { gtag('event', name, p || {}); } catch (e) { /* no analytics */ } }
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
