-- IronVault 0.4 (WoW 3.3.5a)
-- Read-only: it scans bags and bank and keeps the result as text, shown by /ivault and saved with the
-- addon's settings. It never moves items, sends mail or presses anything for you.
--
-- Export format, one record per line, fields separated by "^":
--   IRONVAULT1^character^copper^date^race^sex^bankSeen
--     (race as the client names it, e.g. NightElf; sex male/female; bankSeen empty until the bank was opened once)
--   itemId^suffixId^count^quality^stackSize^equipSlot^icon^type^subtype^name
--
-- Saved settings (WTF/Account/<account>/SavedVariables/IronVault.lua), written by the game at logout or /reload:
--   IronVaultDB.chars[character] = { export = <text above>, bank = <items seen in the bank>, bankSeen = <date> }
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
  end
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
  local header = table.concat({
    "IRONVAULT1", UnitName("player"), GetMoney(), date("%Y-%m-%d %H:%M"),
    clean(raceFile), sex == 3 and "female" or sex == 2 and "male" or "",
    bank and clean(c.bankSeen or "?") or ""
  }, "^")
  return header .. "\n" .. table.concat(lines, "\n"), n, bank ~= nil
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

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("PLAYER_LOGOUT")
events:RegisterEvent("BANKFRAME_OPENED")
events:RegisterEvent("BANKFRAME_CLOSED")
events:RegisterEvent("PLAYERBANKSLOTS_CHANGED")
events:RegisterEvent("BAG_UPDATE")
events:SetScript("OnEvent", function(self, event)
  if event == "PLAYER_ENTERING_WORLD" then
    if not ready then
      ready = true
      migrate()
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
  msg = string.lower(msg or "")
  local c = mine()
  if msg == "forgetbank" then
    if c then
      c.bank = nil
      c.bankSeen = nil
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
