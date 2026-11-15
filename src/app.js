(function () {
  'use strict';
  var CFG = window.IRONVAULT_CONFIG || {};
  var API_URL = String(CFG.supabaseUrl || '').replace(/\/+$/, ''), API_KEY = String(CFG.supabaseAnonKey || '');
  var LIVE = !!(API_URL && API_KEY);
  var MAX_AGE_DAYS = CFG.maxAgeDays || 30;
  var MAX_LINES = 8, MAX_QTY = 60, CHAT_LIMIT = 255;
  var MODES = [[1, 'Hardcore'], [2, 'Ironman'], [4, 'Bloodthirsty']];
  var NO_GEAR_SLOTS = { '': 1, INVTYPE_BAG: 1, INVTYPE_AMMO: 1, INVTYPE_QUIVER: 1 };
  var ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/large/';
  var RACE_CDN = 'https://wow.zamimg.com/images/wow/icons/medium/race_';
  // Keys are the client's own race names in lower case ("scourge" is Undead).
  var RACES = [['human', 'Human'], ['dwarf', 'Dwarf'], ['nightelf', 'Night Elf'], ['gnome', 'Gnome'], ['draenei', 'Draenei'],
    ['orc', 'Orc'], ['scourge', 'Undead'], ['tauren', 'Tauren'], ['troll', 'Troll'], ['bloodelf', 'Blood Elf']];

  /*ICONS_DATA*/
  /*DEMO_DATA*/

  var state = { mask: 3, vaults: [], items: [], cart: {}, filter: '', loading: true, error: '', log: null };
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
  function whoNode(name, race, gender) { return el('span', { class: 'who' }, [raceNode(race, gender, name), document.createTextNode(name)]); }
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
    return { when: v.created_at, requester: String(v.requester || ''), race: raceKey(v.race), gender: genderKey(v.gender),
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
    try {
      var r = await fetch(API_URL + '/rest/v1/requests?select=created_at,requester,race,gender,donor,donor_race,donor_gender,items&mask=eq.' + mask +
        '&order=created_at.desc&limit=30', { headers: headers() });
      if (!r.ok) return null;
      return (await r.json()).map(logRow);
    } catch (e) { return null; }
  }
  async function apiLog(p) {
    if (LIVE) return rpc('log_request', { p_requester: p.requester, p_donor: p.donor, p_items: p.items, p_race: p.race || null, p_gender: p.gender || null });
    var d = demoVaults.filter(function (v) { return v.character === p.donor; })[0] || {};
    demoLog.unshift({ mask: 0, when: new Date().toISOString(), requester: p.requester, race: p.race, gender: p.gender, donor: p.donor,
      donorRace: d.race || '', donorGender: d.gender || '', items: p.shown });
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
      { mask: 0, when: new Date(now - 25 * 6e4).toISOString(), requester: 'Tundrawolf', race: 'tauren', gender: 'male', donor: 'Frostmule', donorRace: 'dwarf', donorGender: 'male', items: [pick(a, 0, 5), pick(a, 9, 2)] },
      { mask: 0, when: new Date(now - 7 * 36e5).toISOString(), requester: 'Elunara', race: 'nightelf', gender: 'female', donor: 'Saronite', donorRace: 'bloodelf', donorGender: 'female', items: [pick(b, 2, 10)] }
    ];
  }

  /* ---------- catalog ---------- */
  function aggregate() {
    var map = {}, list = [];
    state.vaults.forEach(function (v) {
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
    if (!line) { var who = a.holders[0].who; state.cart[k] = { who: who, qty: Math.min(maxFor(a, who), a.stack > 1 ? Math.min(a.stack, 20) : 1) }; }
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
    $('statVaults').textContent = String(state.vaults.length);
    state.items.forEach(function (a) {
      stacks += Math.ceil(a.total / a.stack);
      if (f && a.name.toLowerCase().indexOf(f) < 0) return;
      if (!groups[a.cat]) { groups[a.cat] = []; order.push(a.cat); }
      groups[a.cat].push(a);
    });
    $('statStacks').textContent = stacks.toLocaleString('en');
    if (state.loading) return root.appendChild(el('p', { class: 'empty', text: 'Loading the vault…' }));
    if (state.error) return root.appendChild(el('p', { class: 'notice', text: state.error }));
    order.forEach(function (cat) {
      var g = glyph(cat), grid = el('div', { class: 'grid' });
      groups[cat].forEach(function (a) {
        var url = 'https://www.wowhead.com/wotlk/item=' + a.id;
        var donors = a.holders.length === 1 ? a.holders[0].who : a.holders.length + ' donors';
        grid.appendChild(el('div', { class: 'item', on: { contextmenu: function (e) { e.preventDefault(); addToCart(a.key); } } }, [
          el('a', { class: 'tile q' + a.q, href: url, target: '_blank', rel: 'noopener', 'aria-hidden': 'true', tabindex: '-1' }, [iconNode(a, g), el('span', { class: 'cnt', text: String(a.total) })]),
          el('a', { class: 'nm q' + a.q, href: url, target: '_blank', rel: 'noopener', text: a.name }),
          el('span', { class: 'holders', text: donors }),
          el('button', { class: 'btn sm', type: 'button', 'aria-label': 'Add ' + a.name + ' to request', text: '+', on: { click: function () { addToCart(a.key); } } })
        ]));
      });
      var sec = el('section', { class: 'cat' }, [
        el('h2', {}, [document.createTextNode(cat), el('span', { text: groups[cat].length + (groups[cat].length === 1 ? ' item' : ' items') })]), grid]);
      sec.style.marginBottom = '16px';
      root.appendChild(sec);
    });
    if (!order.length) root.appendChild(el('p', { class: 'empty', text: !state.mask ? 'Tick your challenges above.'
      : f ? 'No item matches "' + state.filter + '".'
      : 'Nobody running ' + modeName(state.mask) + ' has shared an inventory yet. Be the first: open Share your inventory below.' }));
  }
  function renderOrder() {
    var ul = $('lines'), keys = Object.keys(state.cart); ul.textContent = '';
    keys.forEach(function (k) {
      var a = byKey(k), line = state.cart[k]; if (!a) return;
      var from;
      if (a.holders.length > 1) {
        from = el('select', { 'aria-label': 'Donor for ' + a.name, on: { change: function (e) { line.who = e.target.value; line.qty = Math.min(line.qty, maxFor(a, line.who)); renderOrder(); } } },
          a.holders.map(function (h) {
            var o = el('option', { value: h.who, text: h.who + ' has ' + h.count + ' · updated ' + ago(h.when) });
            if (h.who === line.who) o.selected = true; return o;
          }));
      } else from = el('span', { class: 'from', text: 'from ' + line.who + ' · updated ' + ago(a.holders[0].when) });
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
      box.appendChild(el('div', { class: 'req' }, [el('h3', { text: 'Whisper ' + who }), el('pre', { text: text }), copyButton(text)]));
    });
    notify('');
    var d = $('done'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    // Public log, best effort: a failure here never blocks the request itself.
    Promise.all(order.map(function (who) {
      return Promise.resolve(apiLog({ requester: name, donor: who, items: sent[who].ids, shown: sent[who].shown, race: race, gender: gender })).catch(function () {});
    })).then(loadLog);
  }

  /* ---------- request log ---------- */
  function renderLog() {
    var sec = $('log'), ul = $('logList'); ul.textContent = '';
    if (state.log === null || !state.mask) { sec.hidden = true; return; }
    sec.hidden = false;
    if (!state.log.length) return ul.appendChild(el('li', { class: 'empty', text: 'No requests yet for ' + modeName(state.mask) + '.' }));
    state.log.forEach(function (r) {
      var t = el('time', { datetime: r.when, text: agoFine(r.when) });
      ul.appendChild(el('li', { class: 'log-row' }, [
        el('div', { class: 'log-head' }, [whoNode(r.requester, r.race, r.gender), el('span', { class: 'arrow', text: 'asked' }),
          whoNode(r.donor, r.donorRace, r.donorGender), el('span', { class: 'arrow', text: 'for' }), t]),
        el('div', { class: 'log-items' }, r.items.map(function (it) {
          return el('span', {}, [el('span', { class: 'mini' }, [iconNode(it, 'g-spark')]), el('span', { class: 'q' + it.q, text: it.qty + '× ' + it.name })]);
        }))
      ]));
    });
  }
  var logSeq = 0;
  async function loadLog() {
    var seq = ++logSeq, rows = state.mask ? await apiLogList(state.mask) : [];
    if (seq !== logSeq) return;
    state.log = rows; renderLog();
  }

  /* ---------- sharing an inventory ---------- */
  function shareMsg(nodes) { var b = $('shareMsg'); b.textContent = ''; (nodes || []).forEach(function (n) { b.appendChild(n); }); }
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
    renderPreview(); $('sharePrep').hidden = false;
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
      var v = state.mask ? await apiList(state.mask) : [];
      if (seq !== loadSeq) return;
      state.vaults = v;
    } catch (e) {
      if (seq !== loadSeq) return;
      state.error = 'The vault could not be loaded. Check your connection and reload the page.';
    }
    state.loading = false; aggregate(); renderCatalog(); renderOrder();
    loadLog();
  }

  MODES.forEach(function (m) {
    $('m' + m[0]).addEventListener('change', function () {
      state.mask = MODES.reduce(function (acc, x) { return acc | ($('m' + x[0]).checked ? x[0] : 0); }, 0);
      state.cart = {}; lsSet('ironvault.mask', String(state.mask)); load();
    });
  });
  $('search').addEventListener('input', function (e) { state.filter = e.target.value.trim(); renderCatalog(); });
  $('confirm').addEventListener('click', prepare);
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
  if (!LIVE) { buildDemo(); $('modePill').hidden = false; }
  load();
})();
