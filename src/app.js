(function () {
  'use strict';
  var CFG = window.IRONVAULT_CONFIG || {};
  var API_URL = String(CFG.supabaseUrl || '').replace(/\/+$/, ''), API_KEY = String(CFG.supabaseAnonKey || '');
  var LIVE = !!(API_URL && API_KEY);
  var MAX_AGE_DAYS = CFG.maxAgeDays || 30;
  var MAX_LINES = 8, MAX_QTY = 60, CHAT_LIMIT = 255, INBOX_DAYS = 30;
  var MODES = [[1, 'Hardcore'], [2, 'Ironman'], [4, 'Bloodthirsty']];
  var NO_GEAR_SLOTS = { '': 1, INVTYPE_BAG: 1, INVTYPE_AMMO: 1, INVTYPE_QUIVER: 1 };
  var ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/large/';
  var RACE_CDN = 'https://wow.zamimg.com/images/wow/icons/medium/race_';
  // Keys are the client's own race names in lower case ("scourge" is Undead).
  var RACES = [['human', 'Human'], ['dwarf', 'Dwarf'], ['nightelf', 'Night Elf'], ['gnome', 'Gnome'], ['draenei', 'Draenei'],
    ['orc', 'Orc'], ['scourge', 'Undead'], ['tauren', 'Tauren'], ['troll', 'Troll'], ['bloodelf', 'Blood Elf']];

  // ChromieCraft's public API (github.com/azerothcore/acore-api). Optional: when it does not answer, the site works without it.
  var CC_API = String(CFG.chromieApi || '').replace(/\/+$/, '');
  var RACE_IDS = { 1: 'human', 2: 'orc', 3: 'dwarf', 4: 'nightelf', 5: 'scourge', 6: 'tauren', 7: 'gnome', 8: 'troll', 10: 'bloodelf', 11: 'draenei' };
  var CLASSES = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid' };

  /*ICONS_DATA*/
  /*DEMO_DATA*/

  var state = { mask: 3, vaults: [], items: [], cart: {}, filter: '', loading: true, error: '', donor: '', log: null, online: null, fallen: {}, hidden: [], inbox: null, inboxOpen: false, delivery: false };
  var share = null;            // parsed export waiting to be uploaded
  var demoVaults = [], demoLog = [];   // demo mode only
  var $ = function (id) { return document.getElementById(id); };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    for (k in (attrs || {})) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') { for (var ev in attrs.on) n.addEventListener(ev, attrs.on[ev]); }
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function svgUse(id) {
    var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#' + id); s.setAttribute('aria-hidden', 'true'); s.appendChild(u); return s;
  }
  function glyph(cat) {
    var c = cat.toLowerCase();
    if (/potion|elixir|flask/.test(c)) return 'g-flask';
    if (/scroll|recipe|book|glyph|quest/.test(c)) return 'g-scroll';
    if (/gem|enchant|elemental/.test(c)) return 'g-spark';
    if (/food|drink|meat|fish/.test(c)) return 'g-food';
    if (/bandage/.test(c)) return 'g-cross';
    if (/bag|container|quiver/.test(c)) return 'g-bag';
    if (/weapon|ammo|projectile|arrow|bullet/.test(c)) return 'g-sword';
    if (/armor|shield/.test(c)) return 'g-shield';
    if (/engineer|parts|device|explosive|enhancement/.test(c)) return 'g-gear';
    if (/herb|reagent/.test(c)) return 'g-leaf';
    if (/trade|metal|stone|cloth|leather/.test(c)) return 'g-ore';
    return 'g-spark';
  }
  // Embedded icon first, Wowhead's CDN for anything else, category glyph when neither loads.
  function iconNode(it, g) {
    var b = typeof ICONS !== 'undefined' && ICONS[it.icon];
    if (b) return el('img', { src: 'data:image/webp;base64,' + b, alt: '', width: '36', height: '36', loading: 'lazy' });
    if (LIVE && it.icon) {
      var img = el('img', { src: ICON_CDN + it.icon + '.jpg', alt: '', width: '36', height: '36', loading: 'lazy' });
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(svgUse(g), img); });
      return img;
    }
    return svgUse(g);
  }
  function raceKey(s) { s = String(s || '').toLowerCase().replace(/[^a-z]/g, ''); if (s === 'undead') s = 'scourge';
    return RACES.some(function (r) { return r[0] === s; }) ? s : ''; }
  function raceLabel(k) { var r = RACES.filter(function (x) { return x[0] === k; })[0]; return r ? r[1] : ''; }
  function genderKey(s) { s = String(s || '').toLowerCase(); return s === 'female' ? 'female' : s === 'male' ? 'male' : ''; }
  // Round race portrait from Wowhead's CDN; the character's initial when the race is unknown or the image fails.
  function raceNode(race, gender, name) {
    var k = raceKey(race), box = el('span', { class: 'race', 'aria-hidden': 'true' });
    var initial = function () { box.textContent = String(name || '?').charAt(0).toUpperCase(); };
    if (!k) { initial(); return box; }
    box.setAttribute('title', raceLabel(k));
    var img = el('img', { src: RACE_CDN + k + '_' + (genderKey(gender) || 'male') + '.jpg', alt: '', width: '22', height: '22', loading: 'lazy' });
    img.addEventListener('error', function () { box.textContent = ''; initial(); });
    box.appendChild(img); return box;
  }
  function whoNode(name, race, gender) {
    return el('span', { class: 'who' }, [raceNode(race, gender, name), document.createTextNode(name), isOnline(name) ? dot() : null]);
  }
  function fillRaces(sel, withBlank) {
    if (withBlank) sel.appendChild(el('option', { value: '', text: 'Not shown' }));
    RACES.forEach(function (r) { sel.appendChild(el('option', { value: r[0], text: r[1] })); });
  }
  function agoFine(iso) {
    var m = Math.floor((Date.now() - new Date(iso).getTime()) / 6e4);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return ago(iso);
  }
  function modeName(mask) {
    var names = MODES.filter(function (m) { return mask & m[0]; }).map(function (m) { return m[1]; });
    return names.join(' + ') + ' (' + names.length + '/3)';
  }
  function ago(iso) {
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }
  function catOf(type, sub) {
    type = type || 'Other';
    return /^consumable$/i.test(type) ? (sub || type) : /^gem$/i.test(type) ? 'Gems' : (sub && sub !== type ? type + ' – ' + sub : type);
  }
  function cleanName(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
  function validName(s) { return /^[A-Za-zÀ-ÿ]{2,12}$/.test(s); }

  // Item as stored: [itemId, suffixId, count, quality, stackSize, equipSlot, icon, type, subtype, name]
  function norm(a) {
    if (!Array.isArray(a) || a.length < 10) return null;
    var id = parseInt(a[0], 10), count = parseInt(a[2], 10), q = parseInt(a[3], 10);
    if (!(id > 0) || !(count > 0)) return null;
    var icon = String(a[6] || '').toLowerCase();
    return { id: id, suffix: parseInt(a[1], 10) || 0, count: count, q: q >= 0 && q <= 7 ? q : 1, stack: Math.max(1, parseInt(a[4], 10) || 1),
      equip: String(a[5] || ''), icon: /^[a-z0-9_]+$/.test(icon) ? icon : '', type: String(a[7] || ''), sub: String(a[8] || ''),
      cat: catOf(String(a[7] || ''), String(a[8] || '')).slice(0, 60), name: String(a[9] || ('Item ' + id)).slice(0, 80) };
  }
  function isLockedGear(it) { return it.q > 1 && !NO_GEAR_SLOTS[it.equip]; }   // Ironman cannot equip it

  // Addon export: header "IRONVAULT1^name^copper^date", then one "^"-separated item per line.
  function parseExport(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length || lines[0].indexOf('IRONVAULT1^') !== 0) throw new Error('This is not an IronVault export. The first line must start with IRONVAULT1.');
    var h = lines[0].split('^'), items = [], bad = 0;
    if (!validName(h[1] || '')) throw new Error('The export has no valid character name on its first line.');
    lines.slice(1).forEach(function (l) {
      var f = l.split('^');
      var it = f.length >= 10 ? norm(f.slice(0, 9).concat(f.slice(9).join('^'))) : null;
      if (it) items.push(it); else bad++;
    });
    items.sort(function (a, b) { return a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name); });
    return { character: cleanName(h[1]), date: h[3] || '', race: raceKey(h[4]), gender: genderKey(h[5]), items: items, bad: bad };
  }

  /* ---------- data: Supabase when configured, in-page demo otherwise ---------- */
  function headers() {
    var h = { apikey: API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (/^eyJ/.test(API_KEY)) h.Authorization = 'Bearer ' + API_KEY;   // legacy anon key
    return h;
  }
  async function apiList(mask) {
    if (!LIVE) return demoVaults.filter(function (v) { return v.mask === mask || v.mask === 0; });
    var since = new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString();
    var q = '&mask=eq.' + mask + '&updated_at=gte.' + encodeURIComponent(since) + '&order=updated_at.desc&limit=500';
    var r = await fetch(API_URL + '/rest/v1/vaults?select=character,mask,note,items,updated_at,race,gender' + q, { headers: headers() });
    // Database not migrated yet (no race columns): read the original columns.
    if (!r.ok) r = await fetch(API_URL + '/rest/v1/vaults?select=character,mask,note,items,updated_at' + q, { headers: headers() });
    if (!r.ok) throw new Error('load_failed');
    return (await r.json()).map(function (v) {
      return { character: String(v.character || ''), mask: v.mask, note: String(v.note || ''), updated_at: v.updated_at,
        race: raceKey(v.race), gender: genderKey(v.gender),
        items: (Array.isArray(v.items) ? v.items : []).map(norm).filter(Boolean) };
    });
  }
  async function rpc(name, body) {
    var r, j = null;
    try { r = await fetch(API_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers(), body: JSON.stringify(body) }); }
    catch (e) { throw new Error('network'); }
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((j && j.message) || 'request_failed'); err.code = (j && j.code) || ''; throw err; }
    return j;
  }
  function logRow(v) {
    return { id: v.id, delivered: v.delivered_at || '', when: v.created_at, requester: String(v.requester || ''), race: raceKey(v.race), gender: genderKey(v.gender),
      donor: String(v.donor || ''), donorRace: raceKey(v.donor_race), donorGender: genderKey(v.donor_gender),
      items: (Array.isArray(v.items) ? v.items : []).filter(Array.isArray).map(function (a) {
        var icon = String(a[4] || '').toLowerCase(), q = parseInt(a[2], 10);
        return { id: parseInt(a[0], 10) || 0, qty: parseInt(a[1], 10) || 1, q: q >= 0 && q <= 7 ? q : 1, name: String(a[3] || '').slice(0, 80),
          icon: /^[a-z0-9_]+$/.test(icon) ? icon : '' };
      }) };
  }
  // Returns null when the log is not available (database not migrated yet, or unreachable).
  async function apiLogList(mask) {
    if (!LIVE) return demoLog.filter(function (r) { return r.mask === mask || r.mask === 0; });
    var cols = 'created_at,requester,race,gender,donor,donor_race,donor_gender,items', q = '&mask=eq.' + mask + '&order=created_at.desc&limit=30';
    try {
      var r = await fetch(API_URL + '/rest/v1/requests?select=id,delivered_at,' + cols + q, { headers: headers() });
      state.delivery = r.ok;
      // Database not migrated yet (no delivered_at column): read the original columns.
      if (!r.ok) r = await fetch(API_URL + '/rest/v1/requests?select=' + cols + q, { headers: headers() });
      if (!r.ok) return null;
      return (await r.json()).map(logRow);
    } catch (e) { return null; }
  }
  // Requests addressed to the given donors, newest first. Null when not available.
  async function apiInbox(names) {
    if (!names.length) return [];
    if (!LIVE) return demoLog.filter(function (r) { return names.indexOf(r.donor) >= 0; });
    var since = new Date(Date.now() - INBOX_DAYS * 864e5).toISOString();
    try {
      var r = await fetch(API_URL + '/rest/v1/requests?select=id,delivered_at,created_at,requester,race,gender,donor,donor_race,donor_gender,items' +
        '&donor=in.(' + names.map(encodeURIComponent).join(',') + ')&created_at=gte.' + encodeURIComponent(since) +
        '&order=created_at.desc&limit=100', { headers: headers() });
      if (!r.ok) return null;
      return (await r.json()).map(logRow);
    } catch (e) { return null; }
  }
  // Removes a request: with the requester's token, or as the donor with the vault code.
  async function apiCancel(id, token, donor, code) {
    if (LIVE) return rpc('cancel_request', { p_id: id, p_token: token || null, p_donor: donor || null, p_code: code || null });
    demoLog = demoLog.filter(function (r) { return r.id !== id; });
    return { cancelled: true };
  }
  // Cancel tokens of the requests made from this browser: { id: token }, newest 40 kept.
  function myTokens() { try { return JSON.parse(lsGet('ironvault.reqs') || '{}') || {}; } catch (e) { return {}; } }
  function saveToken(id, token) {
    var t = myTokens(); if (token) t[id] = token; else delete t[id];
    Object.keys(t).sort(function (a, b) { return b - a; }).slice(40).forEach(function (k) { delete t[k]; });
    lsSet('ironvault.reqs', JSON.stringify(t));
  }
  // A button that asks for a second press before acting.
  function armedButton(label, act) {
    var armed = false, timer = 0;
    var b = el('button', { class: 'btn xs ghost', type: 'button', text: label, on: { click: function () {
      if (!armed) { armed = true; b.textContent = 'Press again'; timer = setTimeout(function () { armed = false; b.textContent = label; }, 4000); return; }
      clearTimeout(timer); b.disabled = true; act(b);
    } } });
    return b;
  }
  // Marks a request as delivered or waiting again; with no id it only checks the donor's vault code.
  async function apiMark(donor, code, id, delivered) {
    if (LIVE) return rpc('mark_request', { p_donor: donor, p_code: code, p_id: id, p_delivered: delivered !== false });
    var v = demoVaults.filter(function (x) { return x.character === donor; })[0];
    if (!v) throw new Error('not_found');
    if (v.code && v.code !== code) throw new Error('wrong_code');
    demoLog.forEach(function (r) { if (id !== null && r.id === id) r.delivered = delivered !== false ? new Date().toISOString() : ''; });
    return { ok: true };
  }
  async function apiLog(p) {
    if (LIVE) return rpc('log_request', { p_requester: p.requester, p_donor: p.donor, p_items: p.items, p_race: p.race || null, p_gender: p.gender || null });
    var d = demoVaults.filter(function (v) { return v.character === p.donor; })[0] || {};
    var nid = Date.now();
    demoLog.unshift({ id: nid, delivered: '', mask: 0, when: new Date().toISOString(), requester: p.requester, race: p.race, gender: p.gender, donor: p.donor,
      donorRace: d.race || '', donorGender: d.gender || '', items: p.shown });
    return { id: nid, token: 'demo' };
  }
  async function apiUpload(p) {
    if (LIVE) {
      var body = { p_character: p.character, p_mask: p.mask, p_items: p.items, p_code: p.code || null, p_note: p.note };
      try { return await rpc('upload_vault', Object.assign({ p_race: p.race || null, p_gender: p.gender || null }, body)); }
      catch (e) { if (e.code !== 'PGRST202') throw e; }   // database not migrated yet: upload without the race
      return rpc('upload_vault', body);
    }
    var key = p.character.toLowerCase(), old = demoVaults.filter(function (v) { return v.character.toLowerCase() === key; })[0];
    if (old && old.code !== p.code) throw new Error('wrong_code');
    if (old) demoVaults.splice(demoVaults.indexOf(old), 1);
    demoVaults.push({ character: p.character, mask: p.mask, note: p.note, race: p.race, gender: p.gender, updated_at: new Date().toISOString(), code: 'DEMO-0000-0000',
      items: p.items.map(norm).filter(Boolean) });
    return { character: p.character, code: old ? null : 'DEMO-0000-0000', count: p.items.length };
  }
  async function apiRemove(character, code) {
    if (LIVE) return rpc('delete_vault', { p_character: character, p_code: code });
    var key = character.toLowerCase(), old = demoVaults.filter(function (v) { return v.character.toLowerCase() === key; })[0];
    if (!old) throw new Error('not_found');
    if (old.code !== code) throw new Error('wrong_code');
    demoVaults.splice(demoVaults.indexOf(old), 1);
    return { deleted: true };
  }
  var ERRORS = {
    wrong_code: 'That code does not match. A list for this character already exists: enter the code you received when you first uploaded it.',
    invalid_character: 'The character name must be 2 to 12 letters.',
    invalid_mask: 'Tick at least one challenge for this character.',
    invalid_items: 'The item list is too large or damaged. Export again with /ivault and retry.',
    too_many_new_vaults: 'Too many new lists were created in the last hour. Try again later.',
    not_found: 'There is no list for this character.',
    request_not_found: 'That request is no longer in the log.',
    already_delivered: 'The donor already marked this request as delivered, so it stays in the log.',
    network: 'The vault could not be reached. Check your connection and try again.'
  };
  function errText(e) { return ERRORS[e && e.message] || 'Something went wrong (' + ((e && e.message) || 'unknown') + '). Try again.'; }

  function buildDemo() {
    var a = [], b = [];
    DEMO.forEach(function (row, ri) {
      var cat = row.split('>')[0];
      row.split('>')[1].split(';').forEach(function (r, i) {
        var f = r.split('|'), id = +f[0], stack = +f[3];
        var n = stack > 1 ? (id * 7) % 90 + 3 : id % 2 + 1;   // placeholder quantities, stable across visits
        var it = { id: id, suffix: 0, count: n, q: +f[2], stack: stack, equip: '', icon: DEMO_ICON[id] || '', type: '', sub: '', cat: cat, name: f[1] };
        a.push(it);
        if ((ri + i) % 3 === 0) b.push({ id: id, suffix: 0, count: Math.max(1, Math.floor(n / 2)), q: it.q, stack: stack, equip: '', icon: it.icon, type: '', sub: '', cat: cat, name: f[1] });
      });
    });
    var now = Date.now();
    demoVaults = [   // mask 0: shown for every challenge set in demo mode
      { character: 'Frostmule', mask: 0, note: 'Demo donor', race: 'dwarf', gender: 'male', updated_at: new Date(now - 864e5).toISOString(), items: a, code: '' },
      { character: 'Saronite', mask: 0, note: 'Demo donor', race: 'bloodelf', gender: 'female', updated_at: new Date(now - 4 * 864e5).toISOString(), items: b, code: '' }
    ];
    var pick = function (list, i, qty) { var it = list[i % list.length]; return { id: it.id, qty: qty, q: it.q, name: it.name, icon: it.icon }; };
    demoLog = [
      { id: 2, delivered: '', mask: 0, when: new Date(now - 25 * 6e4).toISOString(), requester: 'Tundrawolf', race: 'tauren', gender: 'male', donor: 'Frostmule', donorRace: 'dwarf', donorGender: 'male', items: [pick(a, 0, 5), pick(a, 9, 2)] },
      { id: 1, delivered: new Date(now - 5 * 36e5).toISOString(), mask: 0, when: new Date(now - 7 * 36e5).toISOString(), requester: 'Elunara', race: 'nightelf', gender: 'female', donor: 'Saronite', donorRace: 'bloodelf', donorGender: 'female', items: [pick(b, 2, 10)] }
    ];
  }

  /* ---------- ChromieCraft API: who a character is, who is online, who has fallen ---------- */
  // The API allows few calls per hour, so every answer is kept for a while in this tab's storage.
  var ccDownUntil = 0;
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  async function ccGet(path, ttlMin) {
    if (!CC_API || Date.now() < ccDownUntil) return null;
    var key = 'ivcc:' + path, hit = null;
    try { hit = JSON.parse(ssGet(key) || 'null'); } catch (e) {}
    if (hit && Date.now() - hit.t < ttlMin * 6e4) return hit.d;
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 7000);
    try {
      var r = await fetch(CC_API + path, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error('cc_' + r.status);
      var d = await r.json();
      ssSet(key, JSON.stringify({ t: Date.now(), d: d }));
      return d;
    } catch (e) { ccDownUntil = Date.now() + 3 * 6e4; return null; }   // leave it alone for a few minutes
    finally { clearTimeout(timer); }
  }
  function ccChar(r) {
    return { name: String(r.name || ''), race: RACE_IDS[r.race] || '', gender: +r.gender === 1 ? 'female' : 'male', cls: CLASSES[r['class']] || '',
      level: +r.level || 0, mask: +r.challenge || 0, dead: +r.dead === 1, completed: +r.completed === 1, deleted: +r.char_deleted === 1,
      diedOn: +r.died_on || 0 };
  }
  async function ccInMask(name, mask) {
    var res = await ccGet('/characters/challenge_modes/leaderboard?challenge=' + mask + '&name=' + encodeURIComponent(name) + '&limit=20', 30);
    if (!res || !Array.isArray(res.data)) return null;
    var same = res.data.map(ccChar).filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
    // A name can appear twice (a fallen character deleted and rolled again): prefer the one still around.
    same.sort(function (a, b) { return (a.deleted - b.deleted) || (a.dead - b.dead); });
    return same[0] || false;
  }
  // { status: 'found', c } | { status: 'missing' } | { status: 'unknown' } (API not answering)
  async function ccFind(name, preferMask) {
    name = cleanName(name);
    var order = [1, 2, 3, 4, 5, 6, 7];
    if (preferMask >= 1 && preferMask <= 7) {
      var first = await ccInMask(name, preferMask);
      if (first === null) return { status: 'unknown' };
      if (first) return { status: 'found', c: first };
      order = order.filter(function (m) { return m !== preferMask; });
    }
    var all = await Promise.all(order.map(function (m) { return ccInMask(name, m); }));
    var found = all.filter(Boolean).sort(function (a, b) { return (a.deleted - b.deleted) || (a.dead - b.dead); })[0];
    if (found) return { status: 'found', c: found };
    return all.some(function (x) { return x === null; }) ? { status: 'unknown' } : { status: 'missing' };
  }
  function ccLine(c) { return [c.level ? 'Level ' + c.level : '', raceLabel(c.race), c.cls].filter(Boolean).join(' ') + ' · ' + modeName(c.mask); }
  function ccCard(box, res, name) {
    box.textContent = ''; box.hidden = true;
    if (!res || res.status === 'unknown') return;
    box.hidden = false;
    if (res.status === 'missing') {
      box.className = 'ccard warn';
      return box.appendChild(el('span', { text: 'No challenge character called ' + name + ' on ChromieCraft. Check the spelling.' }));
    }
    var c = res.c; box.className = 'ccard' + (c.dead ? ' warn' : '');
    box.appendChild(whoNode(c.name, c.race, c.gender));
    box.appendChild(el('span', { class: 'cc-sub', text: ccLine(c) + (c.dead ? ' · fallen' : c.completed ? ' · completed' : '') }));
  }
  function isOnline(name) { return !!(state.online && state.online[String(name).toLowerCase()]); }
  function dot() { return el('span', { class: 'dot', title: 'Online now', role: 'img', 'aria-label': 'online now' }); }
  var onlineSeq = 0;
  async function loadOnline() {
    var seq = ++onlineSeq, list = await ccGet('/characters/online', 4);
    if (seq !== onlineSeq || !Array.isArray(list)) return;
    var map = {}; list.forEach(function (p) { if (p && p.name) map[String(p.name).toLowerCase()] = 1; });
    state.online = map; renderCatalog(); renderOrder(); renderLog(); renderInbox();
  }
  // Donors whose character died after their last upload cannot trade any more: their stock is hidden.
  async function loadFallen(mask) {
    if (!(mask & 1)) return {};
    var res = await ccGet('/characters/challenge_modes/leaderboard?challenge=' + mask + '&status=dead&sort=date&direction=desc&limit=100', 15);
    var map = {};
    if (res && Array.isArray(res.data)) res.data.map(ccChar).forEach(function (c) { if (!map[c.name.toLowerCase()]) map[c.name.toLowerCase()] = c.diedOn || 1; });
    return map;
  }
  function hasFallen(v) {
    var died = state.fallen[v.character.toLowerCase()];
    return !!died && (died === 1 || died * 1000 > new Date(v.updated_at).getTime());
  }

  /* ---------- catalog ---------- */
  function aggregate() {
    var map = {}, list = [];
    state.hidden = [];
    state.vaults.forEach(function (v) {
      if (hasFallen(v)) { state.hidden.push(v.character); return; }
      v.items.forEach(function (it) {
        if ((state.mask & 2) && isLockedGear(it)) return;
        var k = it.id + ':' + it.suffix, a = map[k];
        if (!a) { a = map[k] = { key: k, id: it.id, suffix: it.suffix, name: it.name, q: it.q, stack: it.stack, icon: it.icon, cat: it.cat, total: 0, holders: [] }; list.push(a); }
        a.total += it.count;
        a.holders.push({ who: v.character, count: it.count, when: v.updated_at, race: v.race, gender: v.gender });
      });
    });
    list.forEach(function (a) { a.holders.sort(function (x, y) { return y.count - x.count; }); });
    list.sort(function (a, b) { return a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name); });
    state.items = list;
    Object.keys(state.cart).forEach(function (k) { if (!map[k]) delete state.cart[k]; });
  }
  function byKey(k) { for (var i = 0; i < state.items.length; i++) if (state.items[i].key === k) return state.items[i]; return null; }
  function holderOf(a, who) { return a.holders.filter(function (h) { return h.who === who; })[0] || a.holders[0]; }
  function maxFor(a, who) { return Math.min(holderOf(a, who).count, a.stack > 1 ? MAX_QTY : 2); }
  function notify(msg, ok) {
    var box = $('notices'); box.textContent = '';
    if (msg) box.appendChild(el('div', { class: 'notice' + (ok ? ' ok' : ''), text: msg }));
  }
  function addToCart(k) {
    var a = byKey(k); if (!a) return;
    var line = state.cart[k];
    if (!line && Object.keys(state.cart).length >= MAX_LINES) return notify('A request holds up to ' + MAX_LINES + ' different items. Remove one to add another.');
    if (!line) { var who = holderOf(a, state.donor).who; state.cart[k] = { who: who, qty: Math.min(maxFor(a, who), a.stack > 1 ? Math.min(a.stack, 20) : 1) }; }
    else if (line.qty >= maxFor(a, line.who)) return notify(line.who + ' has ' + holderOf(a, line.who).count + ' × ' + a.name + '. One request can ask for up to ' + maxFor(a, line.who) + '.');
    else line.qty++;
    notify(''); renderOrder();
  }
  function setQty(k, q) {
    var a = byKey(k), line = state.cart[k]; if (!a || !line) return;
    if (q < 1) delete state.cart[k]; else line.qty = Math.min(q, maxFor(a, line.who));
    renderOrder();
  }

  function renderPick() {
    MODES.forEach(function (m) { $('m' + m[0]).checked = !!(state.mask & m[0]); });
    $('pickHint').textContent = state.mask
      ? 'Showing donors who run exactly ' + modeName(state.mask) + ', updated in the last ' + MAX_AGE_DAYS + ' days.'
      : 'Tick at least one challenge to see the stock.';
  }
  function renderCatalog() {
    var root = $('catalog'), groups = {}, order = [], f = state.filter.toLowerCase(), stacks = 0;
    root.textContent = '';
    $('statVaults').textContent = String(state.vaults.length - state.hidden.length);
    var only = state.donor;
    state.items.forEach(function (a) {
      stacks += Math.ceil(a.total / a.stack);
      if (only && !a.holders.some(function (h) { return h.who === only; })) return;
      if (f && a.name.toLowerCase().indexOf(f) < 0) return;
      if (!groups[a.cat]) { groups[a.cat] = []; order.push(a.cat); }
      groups[a.cat].push(a);
    });
    $('statStacks').textContent = stacks.toLocaleString('en');
    if (state.loading) return root.appendChild(el('p', { class: 'empty', text: 'Loading the vault…' }));
    if (state.error) return root.appendChild(el('p', { class: 'notice', text: state.error }));
    if (state.hidden.length) root.appendChild(el('p', { class: 'hint fallen', text: 'Hidden: ' + state.hidden.join(', ') +
      (state.hidden.length === 1 ? ' has' : ' have') + ' fallen since the last upload, so the list can no longer be traded.' }));
    order.forEach(function (cat) {
      var g = glyph(cat), grid = el('div', { class: 'grid' });
      groups[cat].forEach(function (a) {
        var url = 'https://www.wowhead.com/wotlk/item=' + a.id;
        var mine = only ? holderOf(a, only) : null;
        var donors = mine ? mine.who : a.holders.length === 1 ? a.holders[0].who : a.holders.length + ' donors';
        var on = mine ? isOnline(mine.who) : a.holders.some(function (h) { return isOnline(h.who); });
        grid.appendChild(el('div', { class: 'item', on: { contextmenu: function (e) { e.preventDefault(); addToCart(a.key); } } }, [
          el('a', { class: 'tile q' + a.q, href: url, target: '_blank', rel: 'noopener', 'aria-hidden': 'true', tabindex: '-1' }, [iconNode(a, g), el('span', { class: 'cnt', text: String(mine ? mine.count : a.total) })]),
          el('a', { class: 'nm q' + a.q, href: url, target: '_blank', rel: 'noopener', text: a.name }),
          el('span', { class: 'holders' }, [on ? dot() : null, document.createTextNode(donors)]),
          el('button', { class: 'btn sm', type: 'button', 'aria-label': 'Add ' + a.name + ' to request', text: '+', on: { click: function () { addToCart(a.key); } } })
        ]));
      });
      var sec = el('section', { class: 'cat' }, [
        el('h2', {}, [document.createTextNode(cat), el('span', { text: groups[cat].length + (groups[cat].length === 1 ? ' item' : ' items') })]), grid]);
      sec.style.marginBottom = '16px';
      root.appendChild(sec);
    });
    if (!order.length) root.appendChild(el('p', { class: 'empty', text: !state.mask ? 'Tick your challenges above.'
      : f ? 'No item matches "' + state.filter + '"' + (only ? ' in ' + only + "'s list." : '.')
      : 'Nobody running ' + modeName(state.mask) + ' has shared an inventory yet. Be the first: press Share your inventory on the right.' }));
  }
  // Donor filter: "All donors" plus one entry per donor of the current challenge set.
  function renderDonors() {
    var sel = $('donorFilter'), names = {}, list = [];
    state.items.forEach(function (a) { a.holders.forEach(function (h) { if (!names[h.who]) { names[h.who] = 0; list.push(h.who); } names[h.who]++; }); });
    list.sort(function (x, y) { return x.localeCompare(y); });
    if (list.indexOf(state.donor) < 0) state.donor = '';
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: 'All donors (' + list.length + ')' }));
    list.forEach(function (w) { sel.appendChild(el('option', { value: w, text: w + ' (' + names[w] + (names[w] === 1 ? ' item)' : ' items)') })); });
    sel.value = state.donor; sel.hidden = list.length < 2;
  }
  function renderOrder() {
    var ul = $('lines'), keys = Object.keys(state.cart); ul.textContent = '';
    keys.forEach(function (k) {
      var a = byKey(k), line = state.cart[k]; if (!a) return;
      var from;
      if (a.holders.length > 1) {
        from = el('select', { 'aria-label': 'Donor for ' + a.name, on: { change: function (e) { line.who = e.target.value; line.qty = Math.min(line.qty, maxFor(a, line.who)); renderOrder(); } } },
          a.holders.map(function (h) {
            var o = el('option', { value: h.who, text: h.who + ' has ' + h.count + (isOnline(h.who) ? ' · online now' : ' · updated ' + ago(h.when)) });
            if (h.who === line.who) o.selected = true; return o;
          }));
      } else from = el('span', { class: 'from' }, [document.createTextNode('from ' + line.who + ' · '),
        isOnline(line.who) ? dot() : null, document.createTextNode(isOnline(line.who) ? 'online now' : 'updated ' + ago(a.holders[0].when))]);
      ul.appendChild(el('li', { class: 'line' }, [
        el('span', { class: 'mini' }, [iconNode(a, glyph(a.cat))]),
        el('span', { class: 'nm q' + a.q, text: a.name }),
        el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'One less ' + a.name, text: '−', on: { click: function () { setQty(k, line.qty - 1); } } }),
        el('span', { class: 'qty', text: String(line.qty) }),
        el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'One more ' + a.name, text: '+', on: { click: function () { setQty(k, line.qty + 1); } } }),
        el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Remove ' + a.name, text: '×', on: { click: function () { setQty(k, 0); } } }),
        from
      ]));
    });
    $('emptyHint').hidden = keys.length > 0;
  }

  // One or more chat lines per donor, each within WoW's 255-character limit.
  function whisperLines(who, me, parts) {
    var first = '/w ' + who + ' Iron Vault request for ' + me + ': ', next = '/w ' + who + ' ...and: ';
    var lines = [], cur = first, empty = true;
    parts.forEach(function (p) {
      var add = (empty ? '' : ', ') + p;
      if (!empty && (cur + add).length > CHAT_LIMIT) { lines.push(cur); cur = next + p; }
      else { cur += add; empty = false; }
    });
    lines.push(cur);
    return lines;
  }
  function copyButton(text) {
    var msg = el('span', { class: 'hint', 'aria-live': 'polite' });
    var b = el('button', { class: 'btn', type: 'button', text: 'Copy', on: { click: function () {
      var fail = function () { msg.textContent = 'Copy failed. Select the text and copy it by hand.'; };
      try { navigator.clipboard.writeText(text).then(function () { msg.textContent = 'Copied.'; }, fail); } catch (e) { fail(); }
    } } });
    return el('div', { class: 'row' }, [b, msg]);
  }
  function prepare() {
    var name = $('recipient').value.trim(), keys = Object.keys(state.cart);
    if (!keys.length) return notify('Your request is empty. Add an item first.');
    if (!validName(name)) return notify('Enter your character name: 2 to 12 letters, no spaces or numbers.');
    name = cleanName(name); lsSet('ironvault.me', name);
    var race = $('myRace').value, gender = race ? $('myGender').value : '';
    lsSet('ironvault.race', race); lsSet('ironvault.gender', $('myGender').value);
    var by = {}, order = [], sent = {};
    keys.forEach(function (k) {
      var a = byKey(k), line = state.cart[k]; if (!a) return;
      if (line.who.toLowerCase() === name.toLowerCase()) return;
      if (!by[line.who]) { by[line.who] = []; order.push(line.who); sent[line.who] = { ids: [], shown: [] }; }
      by[line.who].push(line.qty + 'x ' + a.name);
      sent[line.who].ids.push([a.id, a.suffix, line.qty]);
      sent[line.who].shown.push({ id: a.id, qty: line.qty, q: a.q, name: a.name, icon: a.icon });
    });
    if (!order.length) return notify('Every item in this request is from your own list.');
    var box = $('requests'); box.textContent = '';
    order.forEach(function (who) {
      var text = whisperLines(who, name, by[who]).join('\n');
      var where = !state.online ? '' : isOnline(who) ? ' (online now)' : ' (offline: send it by in-game mail)';
      box.appendChild(el('div', { class: 'req' }, [el('h3', { text: 'Whisper ' + who + where }), el('pre', { text: text }), copyButton(text)]));
    });
    notify('');
    var d = $('done'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    // Public log, best effort: a failure here never blocks the request itself.
    Promise.all(order.map(function (who) {
      return Promise.resolve(apiLog({ requester: name, donor: who, items: sent[who].ids, shown: sent[who].shown, race: race, gender: gender }))
        .then(function (res) { if (res && res.id && res.token) saveToken(res.id, res.token); }).catch(function () {});
    })).then(function () { loadLog(); loadInbox(); });
  }

  /* ---------- request log ---------- */
  function renderLog() {
    var sec = $('log'), ul = $('logList'); ul.textContent = '';
    if (state.log === null || !state.mask) { sec.hidden = true; return; }
    sec.hidden = false;
    if (!state.log.length) return ul.appendChild(el('li', { class: 'empty', text: 'No requests yet for ' + modeName(state.mask) + '.' }));
    var tokens = myTokens();
    state.log.forEach(function (r) {
      var t = el('time', { datetime: r.when, text: agoFine(r.when) });
      var mine = r.id && tokens[r.id] && !r.delivered ? el('div', { class: 'row' }, [armedButton('Cancel request', function (b) { cancelMine(r, b); }),
        el('span', { class: 'hint', text: 'Your request, still waiting.' })]) : null;
      ul.appendChild(el('li', { class: 'log-row' }, [
        el('div', { class: 'log-head' }, [whoNode(r.requester, r.race, r.gender), el('span', { class: 'arrow', text: 'asked' }),
          whoNode(r.donor, r.donorRace, r.donorGender), r.delivered ? el('span', { class: 'tag ok', text: 'delivered' }) : null, t]),
        itemsNode(r), mine
      ]));
    });
  }
  async function cancelMine(r, btn) {
    try { await apiCancel(r.id, myTokens()[r.id]); }
    catch (e) {
      if (e.message !== 'request_not_found') { notify(e.message === 'wrong_code' ? 'This request can no longer be cancelled from this browser.' : errText(e)); btn.disabled = false; if (e.message !== 'already_delivered') return; }
    }
    saveToken(r.id, null); loadLog(); loadInbox();
  }
  function itemsNode(r) {
    return el('div', { class: 'log-items' }, r.items.map(function (it) {
      return el('span', {}, [el('span', { class: 'mini' }, [iconNode(it, 'g-spark')]), el('span', { class: 'q' + it.q, text: it.qty + '× ' + it.name })]);
    }));
  }
  var logSeq = 0;
  async function loadLog() {
    var seq = ++logSeq, rows = state.mask ? await apiLogList(state.mask) : [];
    if (seq !== logSeq) return;
    state.log = rows; renderLog(); renderInbox();
  }

  /* ---------- donor inbox: requests waiting for the characters this browser holds a vault code for ---------- */
  function myChars() {
    var out = [], pre = 'ironvault.code.';
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(pre) === 0 && validName(k.slice(pre.length))) out.push({ name: cleanName(k.slice(pre.length)), code: localStorage.getItem(k) || '' });
      }
    } catch (e) {}
    return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function inboxMsg(text, ok) { var b = $('inboxMsg'); b.textContent = ''; if (text) b.appendChild(note(text, ok)); }
  function renderInbox() {
    var sec = $('inbox'), mine = myChars(), rows = state.inbox || [];
    var waiting = rows.filter(function (r) { return !r.delivered; }), done = rows.filter(function (r) { return r.delivered; });
    $('inboxLink').hidden = !state.delivery;
    $('inboxLink').textContent = 'Requests for you' + (waiting.length ? ' (' + waiting.length + ')' : '');
    document.title = (waiting.length ? '(' + waiting.length + ') ' : '') + 'Iron Vault';
    sec.hidden = !state.delivery || state.inbox === null || !(mine.length || state.inboxOpen);
    if (sec.hidden) return;
    $('inboxCount').textContent = waiting.length ? String(waiting.length) : ''; $('inboxCount').hidden = !waiting.length;
    $('inboxHint').textContent = !mine.length ? 'For donors: enter the character you shared and its vault code to see who asked you for items.'
      : waiting.length ? 'Trade or mail the items in game, then mark the request as delivered.'
      : 'Nothing waiting for ' + mine.map(function (c) { return c.name; }).join(', ') + '.';
    var row = function (r) {
      var btn = el('button', { class: 'btn xs' + (r.delivered ? ' ghost' : ''), type: 'button', text: r.delivered ? 'Undo' : 'Mark delivered',
        on: { click: function () { markRequest(r, !r.delivered, btn); } } });
      return el('li', { class: 'log-row' }, [
        el('div', { class: 'log-head' }, [whoNode(r.requester, r.race, r.gender),
          mine.length > 1 ? el('span', { class: 'arrow', text: 'asked ' + r.donor }) : null,
          el('time', { datetime: r.when, text: agoFine(r.when) })]),
        itemsNode(r),
        el('div', { class: 'row' }, [btn, r.delivered ? el('span', { class: 'hint', text: 'delivered ' + agoFine(r.delivered) })
          : armedButton('Remove', function (b) { removeRequest(r, b); })])
      ]);
    };
    var ul = $('inboxList'), dl = $('inboxDoneList'); ul.textContent = ''; dl.textContent = '';
    waiting.forEach(function (r) { ul.appendChild(row(r)); });
    done.forEach(function (r) { dl.appendChild(row(r)); });
    ul.hidden = !waiting.length;
    $('inboxDone').hidden = !done.length; $('inboxDoneSum').textContent = 'Delivered (' + done.length + ')';
    if (!mine.length) $('inboxSign').open = true;
  }
  async function markRequest(r, delivered, btn) {
    var me = myChars().filter(function (c) { return c.name === r.donor; })[0];
    if (!me) return;
    btn.disabled = true; inboxMsg('');
    try { await apiMark(r.donor, me.code, r.id, delivered); }
    catch (e) { inboxMsg(e.message === 'wrong_code' ? 'The vault code saved in this browser for ' + r.donor + ' no longer matches. Enter it again below.' : errText(e)); btn.disabled = false; return; }
    await loadInbox(); loadLog();
  }
  async function removeRequest(r, btn) {
    var me = myChars().filter(function (c) { return c.name === r.donor; })[0];
    if (!me) return;
    inboxMsg('');
    try { await apiCancel(r.id, '', r.donor, me.code); }
    catch (e) {
      if (e.code === 'PGRST202') { inboxMsg('Removing requests is not available yet.'); btn.disabled = false; return; }
      if (e.message !== 'request_not_found') { inboxMsg(e.message === 'wrong_code' ? 'The vault code saved in this browser for ' + r.donor + ' no longer matches. Enter it again below.' : errText(e)); btn.disabled = false; return; }
    }
    await loadInbox(); loadLog();
  }
  var inboxSeq = 0;
  async function loadInbox() {
    var seq = ++inboxSeq, rows = await apiInbox(myChars().map(function (c) { return c.name; }));
    if (seq !== inboxSeq) return;
    state.inbox = rows; renderInbox();
  }
  async function signIn() {
    var name = $('inName').value.trim(), code = $('inCode').value.trim().toUpperCase(), btn = $('inBtn');
    if (!validName(name)) return inboxMsg(ERRORS.invalid_character);
    if (!code) return inboxMsg('Enter the vault code you received when you first uploaded the list.');
    name = cleanName(name); btn.disabled = true; inboxMsg('');
    try {
      await apiMark(name, code, null, true);
      lsSet('ironvault.code.' + name.toLowerCase(), code);
      $('inName').value = ''; $('inCode').value = ''; $('inboxSign').open = false;
      await loadInbox();
    } catch (e) { inboxMsg(errText(e)); }
    btn.disabled = false;
  }

  /* ---------- sharing an inventory ---------- */
  function shareMsg(nodes) {
    var b = $('shareMsg'); b.textContent = ''; (nodes || []).forEach(function (n) { b.appendChild(n); });
    if (nodes && nodes.length && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });   // keep the result (and the code) in view
  }
  function note(text, ok) { return el('div', { class: 'notice' + (ok ? ' ok' : ''), text: text }); }
  function skipSet() { try { return JSON.parse(lsGet('ironvault.skip') || '{}') || {}; } catch (e) { return {}; } }
  function shareMask() { return MODES.reduce(function (m, x) { return m | ($('s' + x[0]).checked ? x[0] : 0); }, 0); }
  function renderPreview() {
    var box = $('sharePreview'), picked = 0; box.textContent = '';
    share.items.forEach(function (it) {
      var cb = el('input', { type: 'checkbox', id: 'pk-' + it.id + '-' + it.suffix });
      cb.checked = !share.skip[it.id + ':' + it.suffix]; if (cb.checked) picked++;
      cb.addEventListener('change', function () {
        if (cb.checked) delete share.skip[it.id + ':' + it.suffix]; else share.skip[it.id + ':' + it.suffix] = 1;
        lsSet('ironvault.skip', JSON.stringify(share.skip)); countPicked();
      });
      box.appendChild(el('label', { 'for': cb.id }, [cb, el('span', { class: 'n', text: String(it.count) }), el('span', { class: 'q' + it.q, text: it.name })]));
    });
    countPicked();
  }
  function countPicked() {
    var n = share.items.filter(function (it) { return !share.skip[it.id + ':' + it.suffix]; }).length;
    $('pickCount').textContent = 'Offering ' + n + ' of ' + share.items.length + ' items.';
  }
  function readExport() {
    shareMsg(); $('sharePrep').hidden = true; share = null;
    try { share = parseExport($('importText').value); } catch (e) { return shareMsg([note(e.message)]); }
    share.skip = skipSet();
    $('shareChar').textContent = share.character;
    $('shareDate').textContent = share.date ? 'exported ' + share.date : '';
    MODES.forEach(function (m) { $('s' + m[0]).checked = !!(state.mask & m[0]); });
    $('shareCode').value = lsGet('ironvault.code.' + share.character.toLowerCase()) || '';
    $('shareNote').value = lsGet('ironvault.note') || '';
    var known = state.vaults.filter(function (v) { return v.character === share.character; })[0] || {};
    $('shareRace').value = share.race || known.race || lsGet('ironvault.share.race') || '';
    $('shareGender').value = share.gender || known.gender || lsGet('ironvault.share.gender') || 'male';
    renderPreview(); $('sharePrep').hidden = false; lookupShare();
    if (share.bad) shareMsg([note(share.bad + ' lines could not be read and were skipped.')]);
  }
  async function upload() {
    if (!share) return;
    var mask = shareMask(), code = $('shareCode').value.trim().toUpperCase(), noteText = $('shareNote').value.trim();
    var sRace = $('shareRace').value, sGender = sRace ? $('shareGender').value : '';
    lsSet('ironvault.share.race', sRace); lsSet('ironvault.share.gender', $('shareGender').value);
    if (!mask) return shareMsg([note(ERRORS.invalid_mask)]);
    var locked = 0;
    var items = share.items.filter(function (it) {
      if (share.skip[it.id + ':' + it.suffix]) return false;
      if ((mask & 2) && isLockedGear(it)) { locked++; return false; }
      return true;
    }).map(function (it) { return [it.id, it.suffix, it.count, it.q, it.stack, it.equip, it.icon, it.type, it.sub, it.name]; });
    if (!items.length) return shareMsg([note('Nothing to upload: tick at least one item.')]);
    var btn = $('uploadBtn'); btn.disabled = true;
    try {
      var res = await apiUpload({ character: share.character, mask: mask, items: items, code: code, note: noteText, race: sRace, gender: sGender });
      var out = [note('Uploaded ' + items.length + ' items for ' + share.character + ' (' + modeName(mask) + ').' +
        (locked ? ' ' + locked + ' green or better gear pieces were left out because Ironman characters cannot equip them.' : ''), true)];
      if (res && res.code) {
        lsSet('ironvault.code.' + share.character.toLowerCase(), res.code); $('shareCode').value = res.code;
        out.push(el('div', { class: 'codebox' }, [document.createTextNode('Your vault code: '), el('b', { text: res.code }),
          el('p', { class: 'hint', text: 'Write it down. It is the only way to update or remove this list, and it cannot be recovered. This browser will remember it for you.' })]));
      }
      lsSet('ironvault.note', noteText);
      shareMsg(out);
      state.mask = mask; lsSet('ironvault.mask', String(mask)); await load();
    } catch (e) { shareMsg([note(errText(e))]); }
    btn.disabled = false;
  }
  var removeArmed = false;
  async function removeList() {
    if (!share) return;
    var btn = $('removeBtn'), code = $('shareCode').value.trim().toUpperCase();
    if (!code) return shareMsg([note('Enter your vault code to remove the list of ' + share.character + '.')]);
    if (!removeArmed) { removeArmed = true; btn.textContent = 'Press again to remove'; setTimeout(function () { removeArmed = false; btn.textContent = 'Remove my list'; }, 5000); return; }
    removeArmed = false; btn.textContent = 'Remove my list'; btn.disabled = true;
    try {
      await apiRemove(share.character, code);
      lsSet('ironvault.code.' + share.character.toLowerCase(), null);
      shareMsg([note('The list of ' + share.character + ' was removed.', true)]); await load();
    } catch (e) { shareMsg([note(errText(e))]); }
    btn.disabled = false;
  }

  var loadSeq = 0;
  async function load() {
    var seq = ++loadSeq;
    state.loading = true; state.error = ''; state.vaults = []; state.items = [];
    renderPick(); renderCatalog();
    try {
      var got = await Promise.all([state.mask ? apiList(state.mask) : [], state.mask ? loadFallen(state.mask) : {}]);
      if (seq !== loadSeq) return;
      state.vaults = got[0]; state.fallen = got[1] || {};
    } catch (e) {
      if (seq !== loadSeq) return;
      state.error = 'The vault could not be loaded. Check your connection and reload the page.';
    }
    state.loading = false; aggregate(); renderDonors(); renderCatalog(); renderOrder();
    loadLog(); loadOnline(); loadInbox();
  }

  /* ---------- recognising characters by name ---------- */
  function applyMask(mask) {
    if (mask === state.mask) return false;
    state.mask = mask; state.cart = {}; lsSet('ironvault.mask', String(mask)); load(); return true;
  }
  var meSeq = 0, meTimer = 0;
  function lookupMe() {
    clearTimeout(meTimer);
    var name = $('recipient').value.trim(), box = $('meCard'), seq = ++meSeq;
    if (!CC_API || !validName(name)) { box.hidden = true; return; }
    meTimer = setTimeout(async function () {
      var res = await ccFind(name, state.mask);
      if (seq !== meSeq) return;
      ccCard(box, res, cleanName(name));
      if (res.status !== 'found') return;
      if (res.c.race) { $('myRace').value = res.c.race; $('myGender').value = res.c.gender; }
      if (!res.c.dead && applyMask(res.c.mask)) notify('Showing the stock for ' + modeName(res.c.mask) + ', the challenges ' + res.c.name + ' runs.', true);
    }, 50);
  }
  async function lookupShare() {
    var box = $('shareCard'); box.hidden = true;
    if (!CC_API || !share) return;
    var who = share.character, res = await ccFind(who, state.mask);
    if (!share || share.character !== who) return;
    ccCard(box, res, who);
    if (res.status !== 'found') return;
    MODES.forEach(function (m) { $('s' + m[0]).checked = !!(res.c.mask & m[0]); });
    if (res.c.race) { $('shareRace').value = res.c.race; $('shareGender').value = res.c.gender; }
  }

  MODES.forEach(function (m) {
    $('m' + m[0]).addEventListener('change', function () {
      state.mask = MODES.reduce(function (acc, x) { return acc | ($('m' + x[0]).checked ? x[0] : 0); }, 0);
      state.cart = {}; lsSet('ironvault.mask', String(state.mask)); load();
    });
  });
  $('search').addEventListener('input', function (e) { state.filter = e.target.value.trim(); renderCatalog(); });
  $('donorFilter').addEventListener('change', function (e) { state.donor = e.target.value; renderCatalog(); });
  $('confirm').addEventListener('click', prepare);
  var shareDlg = $('share');
  function openShare(e) { if (e) e.preventDefault(); if (shareDlg.open) return; if (shareDlg.showModal) shareDlg.showModal(); else shareDlg.setAttribute('open', ''); }
  $('shareOpen').addEventListener('click', openShare);
  $('shareClose').addEventListener('click', function () { shareDlg.close(); });
  shareDlg.addEventListener('click', function (e) { if (e.target === shareDlg) shareDlg.close(); });   // click on the backdrop
  Array.prototype.forEach.call(document.querySelectorAll('a[href="#share"]'), function (a) { a.addEventListener('click', openShare); });
  if (location.hash === '#share') openShare();
  var toTop = $('toTop');
  window.addEventListener('scroll', function () { toTop.hidden = window.scrollY < 500; }, { passive: true });
  toTop.addEventListener('click', function () {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  });
  // Looked up when the field is left, not on every keystroke: the API allows few calls per hour.
  $('recipient').addEventListener('change', lookupMe);
  $('recipient').addEventListener('input', function () { meSeq++; clearTimeout(meTimer); $('meCard').hidden = true; });
  setInterval(function () { if (!document.hidden) loadOnline(); }, 5 * 6e4);
  // A donor who leaves the tab open sees new requests arrive (count in the tab title).
  setInterval(function () { if (!document.hidden && myChars().length) loadInbox(); }, 2 * 6e4);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && myChars().length) loadInbox(); });
  $('inboxLink').addEventListener('click', function (e) {
    e.preventDefault(); state.inboxOpen = true; renderInbox();
    if (!$('inbox').hidden) $('inbox').scrollIntoView({ block: 'start' });
  });
  $('inBtn').addEventListener('click', signIn);
  $('closeBtn').addEventListener('click', function () { $('done').close(); });
  $('readBtn').addEventListener('click', readExport);
  $('uploadBtn').addEventListener('click', upload);
  $('removeBtn').addEventListener('click', removeList);
  $('allBtn').addEventListener('click', function () { if (!share) return; share.skip = {}; lsSet('ironvault.skip', '{}'); renderPreview(); });
  $('noneBtn').addEventListener('click', function () {
    if (!share) return; share.items.forEach(function (it) { share.skip[it.id + ':' + it.suffix] = 1; });
    lsSet('ironvault.skip', JSON.stringify(share.skip)); renderPreview();
  });

  var savedMask = parseInt(lsGet('ironvault.mask') || '', 10);
  if (savedMask >= 1 && savedMask <= 7) state.mask = savedMask;
  $('recipient').value = lsGet('ironvault.me') || '';
  fillRaces($('myRace'), true); fillRaces($('shareRace'), true);
  $('myRace').value = raceKey(lsGet('ironvault.race')); $('myGender').value = genderKey(lsGet('ironvault.gender')) || 'male';
  if (!LIVE) { buildDemo(); $('modePill').hidden = false; state.delivery = true; }
  load(); lookupMe();
})();
