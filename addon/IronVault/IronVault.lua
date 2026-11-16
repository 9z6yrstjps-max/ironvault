-- IronVault 0.6 (WoW 3.3.5a)
-- It scans bags and bank and keeps the result as text, shown by /ivault and saved with the addon's settings.
-- On its own it only reads. The one thing it does with your items happens when you type /ivault send at a
-- mailbox: it fills in a mail and attaches the items you named. It never presses Send: that is always you.
--
-- Export format, one record per line, fields separated by "^":
--   IRONVAULT1^character^copper^date^race^sex^bankSeen^class^level^challenges
--     (race and class as the client names them, e.g. NightElf, DEATHKNIGHT; sex male/female;
--      bankSeen empty until the bank was opened once; challenges 1 = Hardcore + 2 = Ironman + 4 = Bloodthirsty,
--      empty when the addon cannot tell)
--   itemId^suffixId^count^quality^stackSize^equipSlot^icon^type^subtype^name
--   SENT^recipient^time^mail|trade^itemId:suffixId:count,itemId:suffixId:count,...
--     (what this character mailed or traded away lately; the site uses it to mark requests as delivered)
--
-- Saved settings (WTF/Account/<account>/SavedVariables/IronVault.lua), written by the game at logout or /reload:
--   IronVaultDB.chars[character] = { export = <text above>, bank = <items seen in the bank>, bankSeen = <date>,
--                                    bankTime = <same, as a number>, sent = <list of things sent> }
--   IronVaultDB.quiet = true turns the login reminder off (/ivault quiet)
-- The Iron Vault site can read that file to refresh a list without copying anything.

IronVaultDB = IronVaultDB or {}

local bankOpen = false
local ready = false
local pending = nil     -- seconds left before the saved export is rebuilt
local win, edit

-- This character's own record. Each character keeps its own bank contents and export.
local function mine()
  local name = UnitName("player")
  if not name or name == "" or name == UNKNOWNOBJECT then
    return nil
  end
  IronVaultDB = IronVaultDB or {}
  IronVaultDB.chars = IronVaultDB.chars or {}
  local c = IronVaultDB.chars[name]
  if not c then
    c = {}
    IronVaultDB.chars[name] = c
  end
  return c
end

local function say(msg)
  DEFAULT_CHAT_FRAME:AddMessage("|cff69ccf0IronVault|r: " .. msg)
end

-- item:itemId:enchant:gem1:gem2:gem3:gem4:suffixId:uniqueId:level
local function parseLink(link)
  local id, suffix = link:match("item:(%d+):%-?%d*:%-?%d*:%-?%d*:%-?%d*:%-?%d*:(%-?%d*)")
  return tonumber(id), tonumber(suffix) or 0
end

-- Hidden tooltip used to read the "Soulbound" / "Quest Item" line: those items cannot be mailed.
local tip = CreateFrame("GameTooltip", "IronVaultScanTip", nil, "GameTooltipTemplate")

local function isBound(bag, slot)
  tip:SetOwner(WorldFrame, "ANCHOR_NONE")
  tip:ClearLines()
  if bag == BANK_CONTAINER then
    tip:SetInventoryItem("player", BankButtonIDToInvSlotID(slot))
  else
    tip:SetBagItem(bag, slot)
  end
  local last = math.min(tip:NumLines() or 0, 6)
  for i = 2, last do
    local fs = _G["IronVaultScanTipTextLeft" .. i]
    local text = fs and fs:GetText()
    if text == ITEM_SOULBOUND or text == ITEM_BIND_QUEST then
      return true
    end
  end
  return false
end

local function scanBag(bag, into)
  local slots = GetContainerNumSlots(bag) or 0
  for slot = 1, slots do
    local link = GetContainerItemLink(bag, slot)
    if link and not isBound(bag, slot) then
      local _, count = GetContainerItemInfo(bag, slot)
      local id, suffix = parseLink(link)
      if id then
        local key = id .. ":" .. suffix
        local rec = into[key]
        if not rec then
          rec = { link = link, count = 0 }
          into[key] = rec
        end
        rec.count = rec.count + (count or 1)
      end
    end
  end
end

local function scanBank()
  local bank = {}
  scanBag(BANK_CONTAINER, bank)
  for bag = NUM_BAG_SLOTS + 1, NUM_BAG_SLOTS + NUM_BANKBAGSLOTS do
    scanBag(bag, bank)
  end
  local c = mine()
  if c then
    c.bank = bank
    c.bankSeen = date("%Y-%m-%d %H:%M")
    c.bankTime = time()
  end
end

-- Challenge modes, when the server shows them as auras on the character. Returns nil when none is visible,
-- so the site keeps whatever the player ticked there.
local CHALLENGE_WORDS = { { "hardcore", 1 }, { "iron ?man", 2 }, { "bloodthirsty", 4 } }
local function auraNames()
  local names = {}
  for _, filter in ipairs({ "HELPFUL", "HARMFUL" }) do
    for i = 1, 40 do
      local name, _, _, _, _, _, _, _, _, _, spellId = UnitAura("player", i, filter)
      if not name then
        break
      end
      names[#names + 1] = { name = name, id = spellId }
    end
  end
  return names
end
local function challenges()
  local mask = 0
  for _, aura in ipairs(auraNames()) do
    local low = string.lower(aura.name)
    for _, w in ipairs(CHALLENGE_WORDS) do
      if low:find(w[1]) and mask % (w[2] * 2) < w[2] then
        mask = mask + w[2]
      end
    end
  end
  if mask > 0 then
    return mask
  end
  return nil
end

-- What this character sent: kept for two weeks, at most 60 entries.
local SENT_KEEP, SENT_DAYS = 60, 14
local function remember(to, via, items)
  local c = mine()
  if not c or not to or to == "" or #items == 0 then
    return
  end
  c.sent = c.sent or {}
  table.insert(c.sent, { to = to, t = time(), via = via, items = table.concat(items, ",") })
  local limit = time() - SENT_DAYS * 86400
  while #c.sent > SENT_KEEP or (c.sent[1] and (c.sent[1].t or 0) < limit) do
    table.remove(c.sent, 1)
  end
end
local function itemKey(link, count)
  if not link then
    return nil
  end
  local id, suffix = link:match("item:(%d+):%-?%d*:%-?%d*:%-?%d*:%-?%d*:%-?%d*:(%-?%d*)")
  if not id then
    return nil
  end
  return id .. ":" .. (tonumber(suffix) or 0) .. ":" .. (count or 1)
end

local function clean(s)
  return (tostring(s or ""):gsub("[%^\r\n]", " "))
end

local function buildExport()
  local all = {}
  for bag = 0, NUM_BAG_SLOTS do
    scanBag(bag, all)
  end
  if bankOpen then
    scanBank()
  end
  local c = mine()
  local bank = c and c.bank
  if bank then
    for key, rec in pairs(bank) do
      local a = all[key]
      if a then
        a.count = a.count + rec.count
      else
        all[key] = { link = rec.link, count = rec.count }
      end
    end
  end

  local lines, n = {}, 0
  for key, rec in pairs(all) do
    local id, suffix = parseLink(rec.link)
    local name, _, quality, _, _, itemType, subType, stack, equipLoc, texture = GetItemInfo(rec.link)
    if not name then
      name = rec.link:match("%[(.-)%]") or ("Item " .. id)
    end
    local icon = texture and texture:match("([^\\]+)$") or ""
    n = n + 1
    lines[n] = table.concat({
      id, suffix, rec.count, quality or -1, stack or 1, equipLoc or "",
      string.lower(icon), clean(itemType), clean(subType), clean(name)
    }, "^")
  end
  table.sort(lines)

  local _, raceFile = UnitRace("player")
  local sex = UnitSex("player")   -- 2 = male, 3 = female
  local _, classFile = UnitClass("player")
  local header = table.concat({
    "IRONVAULT1", UnitName("player"), GetMoney(), date("%Y-%m-%d %H:%M"),
    clean(raceFile), sex == 3 and "female" or sex == 2 and "male" or "",
    bank and clean(c.bankSeen or "?") or "",
    clean(classFile), UnitLevel("player") or "", challenges() or ""
  }, "^")
  local out = header
  if n > 0 then
    out = out .. "\n" .. table.concat(lines, "\n")
  end
  if c and c.sent then
    for _, s in ipairs(c.sent) do
      out = out .. "\n" .. table.concat({ "SENT", clean(s.to), s.t or 0, s.via or "", s.items or "" }, "^")
    end
  end
  return out, n, bank ~= nil
end

local function showExport(text)
  if not win then
    win = CreateFrame("Frame", "IronVaultExportFrame", UIParent)
    win:SetWidth(560)
    win:SetHeight(380)
    win:SetPoint("CENTER")
    win:SetFrameStrata("DIALOG")
    win:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 32,
      insets = { left = 11, right = 12, top = 12, bottom = 11 }
    })
    win:EnableMouse(true)
    win:SetMovable(true)
    win:RegisterForDrag("LeftButton")
    win:SetScript("OnDragStart", win.StartMoving)
    win:SetScript("OnDragStop", win.StopMovingOrSizing)

    local title = win:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOP", 0, -18)
    title:SetText("IronVault export: press Ctrl+C, then paste on the site")

    local close = CreateFrame("Button", nil, win, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -6, -6)

    local scroll = CreateFrame("ScrollFrame", "IronVaultExportScroll", win, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 20, -44)
    scroll:SetPoint("BOTTOMRIGHT", -40, 20)

    edit = CreateFrame("EditBox", "IronVaultExportEdit", scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(ChatFontNormal)
    edit:SetWidth(490)
    edit:SetMaxLetters(0)
    edit:SetScript("OnEscapePressed", function() win:Hide() end)
    scroll:SetScrollChild(edit)

    tinsert(UISpecialFrames, "IronVaultExportFrame")
  end
  edit:SetText(text)
  win:Show()
  edit:SetFocus()
  edit:HighlightText()
end

-- Rebuilds the export kept in the saved settings. Errors are swallowed: this also runs at logout.
local function saveExport()
  local c = mine()
  if not c then
    return
  end
  local ok, text = pcall(buildExport)
  if ok and text then
    c.export = text
  end
end

-- Settings written by 0.3 had one bank for the whole account: hand it to the character that last exported.
local function migrate()
  IronVaultDB = IronVaultDB or {}
  IronVaultDB.chars = IronVaultDB.chars or {}
  if IronVaultDB.bank then
    local owner = type(IronVaultDB.lastExport) == "string" and IronVaultDB.lastExport:match("^IRONVAULT1%^([^%^]+)")
    if owner then
      local c = IronVaultDB.chars[owner] or {}
      IronVaultDB.chars[owner] = c
      if not c.bank then
        c.bank = IronVaultDB.bank
        c.bankSeen = IronVaultDB.bankSeen
      end
    end
  end
  IronVaultDB.bank = nil
  IronVaultDB.bankSeen = nil
  IronVaultDB.lastExport = nil
end

-- Mail: what is attached is read when Send is pressed, and kept once the game confirms it was sent.
local mailDraft = nil
hooksecurefunc("SendMail", function(recipient)
  mailDraft = nil
  if not GetSendMailItemLink then
    return
  end
  local ok = pcall(function()
    local items = {}
    for i = 1, (ATTACHMENTS_MAX_SEND or 12) do
      local _, _, count = GetSendMailItem(i)
      local key = itemKey(GetSendMailItemLink(i), count)
      if key then
        items[#items + 1] = key
      end
    end
    mailDraft = { to = recipient, items = items }
  end)
  if not ok then
    mailDraft = nil
  end
end)

-- Trade: what this character gives is read when both sides have accepted, and kept once the trade completes.
local tradeDraft = nil
local function readTrade()
  tradeDraft = nil
  if not GetTradePlayerItemLink then
    return
  end
  local items = {}
  for i = 1, 6 do     -- the seventh slot is "will not be traded"
    local _, _, count = GetTradePlayerItemInfo(i)
    local key = itemKey(GetTradePlayerItemLink(i), count)
    if key then
      items[#items + 1] = key
    end
  end
  tradeDraft = { to = UnitName("NPC"), items = items }
end

-- One line at login, only when there is something to do.
local function reminder()
  if IronVaultDB.quiet then
    return
  end
  local c = mine()
  if not c then
    return
  end
  if not c.bank then
    say("open your bank once so the Iron Vault list includes it. (/ivault quiet hides these reminders)")
  elseif c.bankTime and time() - c.bankTime > 3 * 86400 then
    say("bank last seen " .. math.floor((time() - c.bankTime) / 86400) .. " days ago: open it to refresh your Iron Vault list.")
  end
end

-- ---------- /ivault send: prepares a mail for a request; the player checks it and presses Send ----------
local mailOpen = false
local job = nil     -- { to, wants = { { id, suffix, qty } }, steps, i, wait, got, notes }
local MAX_ATTACH = ATTACHMENTS_MAX_SEND or 12

local function slotInfo(bag, slot)
  local _, count, locked = GetContainerItemInfo(bag, slot)
  return count or 0, locked
end
local function freeAttachment()
  for i = 1, MAX_ATTACH do
    if not GetSendMailItem(i) then
      return i
    end
  end
  return nil
end

-- Decides which bag slots to attach. Whole stacks first; one split per item when the amount asked is not a
-- sum of whole stacks (the split part goes to an empty bag slot first, as the game requires).
local function planJob(j)
  local used, empties, attachments = {}, {}, 0
  for bag = 0, NUM_BAG_SLOTS do
    local _, bagType = GetContainerNumFreeSlots(bag)
    if (bagType or 0) == 0 then
      for slot = 1, GetContainerNumSlots(bag) or 0 do
        if not GetContainerItemLink(bag, slot) then
          empties[#empties + 1] = { bag, slot }
        end
      end
    end
  end
  j.steps, j.got, j.notes = {}, {}, {}
  for _, w in ipairs(j.wants) do
    local cands, name = {}, nil
    for bag = 0, NUM_BAG_SLOTS do
      for slot = 1, GetContainerNumSlots(bag) or 0 do
        local link = GetContainerItemLink(bag, slot)
        if link and not used[bag .. ":" .. slot] then
          local id, suffix = parseLink(link)
          if id == w.id and (w.suffix == nil or suffix == w.suffix) and not isBound(bag, slot) then
            cands[#cands + 1] = { bag = bag, slot = slot, count = slotInfo(bag, slot) }
            name = name or link:match("%[(.-)%]")
          end
        end
      end
    end
    table.sort(cands, function(a, b) return a.count > b.count end)
    local need = w.qty
    for _, c in ipairs(cands) do
      if need > 0 and c.count > 0 and c.count <= need and attachments < MAX_ATTACH then
        j.steps[#j.steps + 1] = { kind = "attach", bag = c.bag, slot = c.slot }
        used[c.bag .. ":" .. c.slot] = true
        need = need - c.count
        attachments = attachments + 1
      end
    end
    if need > 0 and attachments < MAX_ATTACH then
      local from
      for i = #cands, 1, -1 do     -- smallest stack that is large enough
        local c = cands[i]
        if not used[c.bag .. ":" .. c.slot] and c.count > need then
          from = c
          break
        end
      end
      if from then
        local e = table.remove(empties)
        if e then
          j.steps[#j.steps + 1] = { kind = "split", bag = from.bag, slot = from.slot, n = need, ebag = e[1], eslot = e[2] }
          used[from.bag .. ":" .. from.slot] = true
          attachments = attachments + 1
          need = 0
        end
      end
    end
    local label = name or ("item " .. w.id)
    if need > 0 then
      local have = 0
      for _, c in ipairs(cands) do
        have = have + c.count
      end
      local why = #cands == 0 and " (not in your bags: is it in the bank?)"
        or have < w.qty and " (only " .. have .. " in your bags)"
        or attachments >= MAX_ATTACH and " (a mail holds 12 attachments)"
        or " (no free bag slot to split a stack)"
      j.notes[#j.notes + 1] = (w.qty - need) .. " of " .. w.qty .. " " .. label .. why
    else
      j.got[#j.got + 1] = w.qty .. "x " .. label
    end
  end
end

local function stopJob(msg)
  if CursorHasItem() then
    ClearCursor()
  end
  job = nil
  if msg then
    say(msg)
  end
end

local function finishJob()
  local j = job
  job = nil
  if #j.got > 0 then
    say("mail for " .. j.to .. " is ready: " .. table.concat(j.got, ", ") .. ". Check it and press Send.")
  end
  for _, n in ipairs(j.notes) do
    say("|cffff6b5enot complete|r: " .. n)
  end
  if #j.got == 0 and #j.notes == 0 then
    say("nothing to attach.")
  end
end

-- One small step at a time, so the game can confirm each move before the next.
local function runJob(elapsed)
  if not job or not mailOpen then
    return
  end
  job.wait = (job.wait or 0) - elapsed
  if job.wait > 0 then
    return
  end
  if not job.started then
    job.started = true
    if not pcall(MailFrameTab_OnClick, nil, 2) and MailFrameTab2 then
      MailFrameTab2:Click()
    end
    ClearSendMail()
    SendMailNameEditBox:SetText(job.to)
    SendMailSubjectEditBox:SetText("Iron Vault")
    planJob(job)
    job.i = 1
    job.wait = 0.3
    return
  end
  local st = job.steps[job.i]
  if not st then
    finishJob()
    return
  end
  st.tries = (st.tries or 0) + 1
  if st.tries > 25 then
    job.notes[#job.notes + 1] = "one stack could not be attached, add it by hand"
    if CursorHasItem() then
      ClearCursor()
    end
    job.i = job.i + 1
    return
  end
  job.wait = 0.2
  if st.kind == "split" then
    if not st.moved then
      local _, locked = slotInfo(st.bag, st.slot)
      if locked then
        return
      end
      if CursorHasItem() then
        ClearCursor()
      end
      SplitContainerItem(st.bag, st.slot, st.n)
      if CursorHasItem() then
        PickupContainerItem(st.ebag, st.eslot)
        st.moved = true
      end
      return
    end
    local count, locked = slotInfo(st.ebag, st.eslot)
    if not GetContainerItemLink(st.ebag, st.eslot) or locked or count ~= st.n then
      return     -- still on its way
    end
    st.kind, st.bag, st.slot = "attach", st.ebag, st.eslot
  end
  local _, locked = slotInfo(st.bag, st.slot)
  if locked then
    return
  end
  local idx = freeAttachment()
  if not idx then
    job.notes[#job.notes + 1] = "no attachment slot left"
    job.i = job.i + 1
    return
  end
  if CursorHasItem() then
    ClearCursor()
  end
  PickupContainerItem(st.bag, st.slot)
  if CursorHasItem() then
    ClickSendMailItemButton(idx)
  end
  if CursorHasItem() then
    ClearCursor()
  end
  if GetSendMailItem(idx) then
    job.i = job.i + 1
  end
end

-- "/ivault send Name 929:0:5 9999:7:1": recipient, then itemId:suffixId:quantity for each item (suffixId may be empty).
local function startSend(text)
  local to, list = text:match("^(%S+)%s+(.+)$")
  if not to or to:find("[%d%p]") then
    say("usage: /ivault send Name itemId:suffixId:quantity ... (copy it from Requests for you on the site)")
    return
  end
  local wants = {}
  for id, suffix, qty in list:gmatch("(%d+):(%-?%d*):(%d+)") do
    if #wants < 12 and tonumber(qty) > 0 then
      wants[#wants + 1] = { id = tonumber(id), suffix = tonumber(suffix), qty = tonumber(qty) }
    end
  end
  if #wants == 0 then
    say("no items in that command. Copy it again from the site.")
    return
  end
  job = { to = to, wants = wants, wait = 0 }
  if not mailOpen then
    say("request for " .. to .. " noted: open a mailbox and the mail will be prepared. (/ivault send cancel to drop it)")
  end
end

local remindIn = nil
local events = CreateFrame("Frame")
events:RegisterEvent("MAIL_SHOW")
events:RegisterEvent("MAIL_CLOSED")
events:RegisterEvent("MAIL_SEND_SUCCESS")
events:RegisterEvent("MAIL_FAILED")
events:RegisterEvent("TRADE_ACCEPT_UPDATE")
events:RegisterEvent("TRADE_REQUEST_CANCEL")
events:RegisterEvent("UI_INFO_MESSAGE")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("PLAYER_LOGOUT")
events:RegisterEvent("BANKFRAME_OPENED")
events:RegisterEvent("BANKFRAME_CLOSED")
events:RegisterEvent("PLAYERBANKSLOTS_CHANGED")
events:RegisterEvent("BAG_UPDATE")
events:SetScript("OnEvent", function(self, event, a1, a2)
  if event == "MAIL_SHOW" then
    mailOpen = true
  elseif event == "MAIL_CLOSED" then
    mailOpen = false
    if job and job.started then
      stopJob("mailbox closed: the mail was not prepared. Paste the command again to retry.")
    end
  elseif event == "MAIL_SEND_SUCCESS" then
    if mailDraft then
      remember(mailDraft.to, "mail", mailDraft.items)
      mailDraft = nil
      pending = 2
    end
  elseif event == "MAIL_FAILED" then
    mailDraft = nil
  elseif event == "TRADE_ACCEPT_UPDATE" then
    if a1 == 1 and a2 == 1 then
      readTrade()
    end
  elseif event == "TRADE_REQUEST_CANCEL" then
    tradeDraft = nil
  elseif event == "UI_INFO_MESSAGE" then
    if tradeDraft and a1 == ERR_TRADE_COMPLETE then
      remember(tradeDraft.to, "trade", tradeDraft.items)
      tradeDraft = nil
      pending = 2
    elseif a1 == ERR_TRADE_CANCELLED then
      tradeDraft = nil
    end
  elseif event == "PLAYER_ENTERING_WORLD" then
    if not ready then
      ready = true
      migrate()
      remindIn = 8
    end
    pending = 5
  elseif event == "PLAYER_LOGOUT" then
    saveExport()
  elseif event == "BANKFRAME_OPENED" then
    bankOpen = true
    scanBank()
    pending = 2
    say("bank scanned.")
  elseif event == "BANKFRAME_CLOSED" then
    bankOpen = false
  else
    if bankOpen then
      scanBank()
    end
    if ready then
      pending = 2     -- wait for the burst of bag events to end
    end
  end
end)
events:SetScript("OnUpdate", function(self, elapsed)
  if job then
    local ok, err = pcall(runJob, elapsed)
    if not ok then
      stopJob("could not prepare the mail (" .. tostring(err) .. ").")
    end
  end
  if remindIn then
    remindIn = remindIn - elapsed
    if remindIn <= 0 then
      remindIn = nil
      reminder()
    end
  end
  if not pending then
    return
  end
  pending = pending - elapsed
  if pending <= 0 then
    pending = nil
    saveExport()
  end
end)

SLASH_IRONVAULT1 = "/ivault"
SLASH_IRONVAULT2 = "/ironvault"
SlashCmdList["IRONVAULT"] = function(msg)
  local raw = (msg or ""):gsub("^%s+", "")
  msg = string.lower(raw)
  if msg:sub(1, 4) == "send" then
    local rest = raw:sub(5):gsub("^%s+", ""):gsub("%s+$", "")
    if rest == "cancel" or rest == "" and job then
      stopJob("send cancelled.")
    else
      startSend(rest)
    end
    return
  end
  local c = mine()
  if msg == "quiet" then
    IronVaultDB.quiet = not IronVaultDB.quiet
    say(IronVaultDB.quiet and "login reminders off." or "login reminders on.")
    return
  end
  if msg == "auras" then
    -- Helps to find out how the server marks challenge characters.
    local list = auraNames()
    say(#list .. " auras on this character; challenges read from them: " .. tostring(challenges() or "none"))
    for _, aura in ipairs(list) do
      say("  " .. aura.name .. " (" .. tostring(aura.id) .. ")")
    end
    return
  end
  if msg == "forgetbank" then
    if c then
      c.bank = nil
      c.bankSeen = nil
      c.bankTime = nil
    end
    pending = 1
    say("stored bank contents cleared.")
    return
  end
  local text, n, hasBank = buildExport()
  if c then
    c.export = text
  end
  showExport(text)
  if hasBank then
    say(n .. " different items exported (bags + bank as seen " .. ((c and c.bankSeen) or "?") .. ").")
  else
    say(n .. " different items exported from bags only. Open the bank once to include it.")
  end
  say("the same list is saved by itself when you log out; the site can read it from the addon's settings file.")
end
