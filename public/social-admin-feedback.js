/**
 * social-admin-feedback.js — drop-in feedback widget for ANY website.
 *
 *   <script src="http://your-admin/social-admin-feedback.js" defer></script>
 *
 * Visitor feedback lands in Social Admin's Feedback board (and feed) live.
 * Zero dependencies, no build step, framework-agnostic.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var BASE = script.src.replace(/social-admin-feedback\.js.*$/, '');

  var css = [
    '.oa-fb-btn{position:fixed;right:22px;bottom:22px;z-index:99998;border:none;border-radius:999px;',
    'padding:13px 20px;font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#fff;',
    'background:linear-gradient(135deg,#6d5cff,#b45cff);box-shadow:0 10px 26px rgba(109,92,255,.45);cursor:pointer}',
    '.oa-fb-btn:hover{filter:brightness(1.07)}',
    '.oa-fb-modal{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(10,12,24,.55);',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}',
    '.oa-fb-panel{width:min(420px,92vw);background:#fff;border-radius:16px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,.3)}',
    '.oa-fb-panel h3{margin:0 0 4px;font-size:17px;color:#1c2030}',
    '.oa-fb-panel p{margin:0 0 14px;font-size:13px;color:#6b7280}',
    '.oa-fb-panel input,.oa-fb-panel textarea{width:100%;box-sizing:border-box;border:1px solid #e4e7ef;border-radius:10px;',
    'padding:9px 12px;font:inherit;font-size:14px;margin-bottom:10px;background:#f8f9fc;color:#1c2030}',
    '.oa-fb-types{display:flex;gap:6px;margin-bottom:10px}',
    '.oa-fb-type{flex:1;border:1px solid #e4e7ef;background:#f8f9fc;border-radius:999px;padding:7px 0;font-size:12.5px;',
    'font-weight:600;color:#6b7280;cursor:pointer}',
    '.oa-fb-type.on{background:rgba(109,92,255,.12);border-color:#6d5cff;color:#6d5cff}',
    '.oa-fb-send{width:100%;border:none;border-radius:10px;padding:11px;font-weight:700;font-size:14px;color:#fff;',
    'background:linear-gradient(135deg,#6d5cff,#b45cff);cursor:pointer}',
    '.oa-fb-close{position:absolute;top:10px;right:14px;border:none;background:none;font-size:20px;color:#9aa1b2;cursor:pointer}',
    '.oa-fb-done{text-align:center;padding:18px 0;font-size:15px;color:#16a34a;font-weight:600}',
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var type = 'idea';

  function open() {
    var modal = document.createElement('div');
    modal.className = 'oa-fb-modal';
    modal.innerHTML =
      '<div class="oa-fb-panel" style="position:relative">' +
      '<button class="oa-fb-close" title="Close">×</button>' +
      '<h3>Send feedback 💬</h3><p>Tell us what you love, what breaks, or what to build next.</p>' +
      '<div class="oa-fb-types">' +
      '<button class="oa-fb-type on" data-t="idea">💡 Idea</button>' +
      '<button class="oa-fb-type" data-t="bug">🐞 Bug</button>' +
      '<button class="oa-fb-type" data-t="praise">💜 Praise</button></div>' +
      '<input class="oa-fb-name" placeholder="Your name (optional)">' +
      '<textarea class="oa-fb-msg" rows="3" placeholder="Your feedback…"></textarea>' +
      '<button class="oa-fb-send">Send feedback</button></div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.className === 'oa-fb-close') modal.remove();
      var t = e.target.closest ? e.target.closest('.oa-fb-type') : null;
      if (t) {
        type = t.dataset.t;
        modal.querySelectorAll('.oa-fb-type').forEach(function (b) { b.classList.toggle('on', b === t); });
      }
      if (e.target.className === 'oa-fb-send') {
        var msg = modal.querySelector('.oa-fb-msg').value.trim();
        if (!msg) { modal.querySelector('.oa-fb-msg').focus(); return; }
        var btn = e.target;
        btn.disabled = true; btn.textContent = 'Sending…';
        fetch(BASE + 'api/social/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: modal.querySelector('.oa-fb-name').value.trim(),
            message: msg,
            type: type,
            from: location.href,
          }),
        })
          .then(function (r) { if (!r.ok) throw new Error('send failed'); })
          .then(function () {
            modal.querySelector('.oa-fb-panel').innerHTML = '<div class="oa-fb-done">✅ Thank you! Your feedback is on the team\'s feed.</div>';
            setTimeout(function () { modal.remove(); }, 1800);
          })
          .catch(function () {
            btn.disabled = false; btn.textContent = 'Send feedback';
            alert('Could not send feedback — is Open Admin running?');
          });
      }
    });
  }

  var btn = document.createElement('button');
  btn.className = 'oa-fb-btn';
  btn.textContent = '💬 Feedback';
  btn.addEventListener('click', open);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(btn); });
  } else {
    document.body.appendChild(btn);
  }
})();
