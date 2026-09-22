-- Jev System One Autonomous Cavebot & Combat Module for OTClient
-- Supports OpenTibiaBR, Tibia 15.11+, and standard OTClient distributions

local botWindow = nil
local toggleBtn = nil
local statusLbl = nil
local macroLbl = nil
local decisionLbl = nil
local waypointLbl = nil
local lootLbl = nil
local patrolModeBtn = nil
local vocationBtn = nil
local healSpellEdit = nil
local atkSpellEdit = nil
local topButton = nil

local isBotEnabled = false
local tickEvent = nil
local tickCounter = 0
local serverUrl = "http://192.168.1.101:3000/tick"
local isWaitingResponse = false
local requestTimestamp = 0

-- Cooldown tracking (in milliseconds)
local lastSpellCastTime = 0
local lastHealCastTime = 0
local lastAttackCastTime = 0
local lastItemUseTime = 0

local function nowMs()
  if g_clock and g_clock.millis then
    return g_clock.millis()
  end
  if socket and socket.gettime then
    return math.floor(socket.gettime() * 1000)
  end
  return math.floor(os.clock() * 1000)
end

-- Vocations
local vocations = { "Knight", "Paladin", "Sorcerer", "Druid" }
local currentVocationIndex = 1
local autoDetectedVocation = false

-- Cavebot Waypoints State
local waypoints = {}
local currentWaypointIndex = 1
local patrolMode = "ping_pong" -- "ping_pong" (1-2-3-4-3-2-1) or "loop" (1-2-3-4-1)
local patrolDirection = 1      -- 1 = forward, -1 = reverse
local lootedCorpses = {} -- [key: "x,y,z"] = timestamp
local unreachableTicks = 0
local ticksOnCurrentWp = 0
local lastWpIndex = 1
local currentWalkDest = nil

-- Direction offsets and Enums
local dirOffsets = {
  north      = { dx = 0,  dy = -1, dir = (Directions and Directions.North) or 0 },
  east       = { dx = 1,  dy = 0,  dir = (Directions and Directions.East) or 1 },
  south      = { dx = 0,  dy = 1,  dir = (Directions and Directions.South) or 2 },
  west       = { dx = -1, dy = 0,  dir = (Directions and Directions.West) or 3 },
  north_east = { dx = 1,  dy = -1, dir = (Directions and Directions.NorthEast) or 4 },
  south_east = { dx = 1,  dy = 1,  dir = (Directions and Directions.SouthEast) or 5 },
  south_west = { dx = -1, dy = 1,  dir = (Directions and Directions.SouthWest) or 6 },
  north_west = { dx = -1, dy = -1, dir = (Directions and Directions.NorthWest) or 7 },
}

-- Trash items to strictly ignore
local trashItemIds = {
  [3492] = true, -- Worms (Rotworm drop)
  [3976] = true, -- Worm
  [3115] = true, -- Bone
  [3116] = true, -- Bones
  [3117] = true, -- Skull
  [3118] = true, -- Bone
  [283]  = true, -- Empty vial
  [284]  = true, -- Empty vial
  [285]  = true, -- Empty vial
}

local trashKeywords = {
  "worm", "bone", "skull", "dead rat", "empty vial", "flask", "trash"
}

-- Forward declarations
local showWindow, hideWindow, toggleWindow, startBot, stopBot, toggleBot
local runTick, executeActions, autoWalkTo, safeWalk, lootCorpseAt, isTileWalkable
local addCurrentWaypoint, clearWaypoints, skipWaypoint, updateWaypointLabel
local cycleVocation, applyVocationDefaults, generateCavePatrol
local lootOpenContainers, isItemValuable, cyclePatrolMode, advanceWaypoint

local function safeCall(obj, method, fallback)
  if obj and obj[method] and type(obj[method]) == "function" then
    local ok, res = pcall(function() return obj[method](obj) end)
    if ok and res ~= nil then return res end
  end
  return fallback
end

function isItemValuable(item)
  if not item then return false end
  local id = safeCall(item, "getId", 0)
  if trashItemIds[id] then
    return false
  end

  local name = safeCall(item, "getName", ""):lower()
  for _, trash in ipairs(trashKeywords) do
    if name:find(trash) then
      return false
    end
  end

  -- 1. All currency coins (Gold, Platinum, Crystal)
  if id == 3031 or id == 2148 or id == 3035 or id == 2152 or id == 3043 or id == 2160 then
    return true
  end

  -- 2. Rotworm & cave equipment and valuable products
  if id == 3286 or id == 2398 or -- Mace
     id == 3264 or id == 2376 or -- Sword
     id == 3374 or id == 2480 or -- Legion Helmet
     id == 3430 or id == 2530 or -- Copper Shield
     id == 3577 or id == 2666 or -- Meat
     id == 3582 or id == 2671 or -- Ham
     id == 9690                 then -- Lump of Dirt (creature product)
    return true
  end

  -- 3. Valuable item names (weapons, armor, gems, creature products)
  local valuableKeywords = {
    "coin", "gold", "platinum", "crystal",
    "sword", "mace", "axe", "club", "dagger", "bow", "wand", "rod",
    "helmet", "armor", "shield", "legs", "boots",
    "ring", "amulet", "necklace",
    "ruby", "emerald", "diamond", "sapphire", "amethyst", "pearl",
    "meat", "ham", "mushroom",
    "fang", "dirt", "pelt", "essence", "scale", "eye", "tail", "tooth"
  }
  for _, kw in ipairs(valuableKeywords) do
    if name:find(kw) then
      return true
    end
  end

  -- 4. Stackable items that are not in trash list
  if safeCall(item, "isStackable", false) then
    return true
  end

  return false
end

function lootOpenContainers()
  local containers = safeCall(g_game, "getContainers", nil)
  if not containers then return end

  local player = g_game.getLocalPlayer()
  if not player then return end

  local pPos = player:getPosition()
  local backpackDest = { x = 65535, y = (InventorySlotBack or 3), z = 0 }
  local backItem = safeCall(player, "getInventoryItem", nil, (InventorySlotBack or 3))

  for _, container in pairs(containers) do
    local isCorpse = false
    local cItem = safeCall(container, "getContainerItem", nil)

    -- Guard 1: Never loot the player's worn backpack
    if cItem and backItem and cItem == backItem then
      isCorpse = false
    -- Guard 2: Never loot child containers inside another container (nested bags)
    elseif safeCall(container, "hasParent", false) then
      isCorpse = false
    else
      -- Check container position
      local pos = cItem and safeCall(cItem, "getPosition", nil)
      -- Guard 3: In Tibia protocol, inventory / equipment items have pos.x == 65535
      if pos and pos.x == 65535 then
        isCorpse = false
      elseif pos and pos.x < 65000 and pPos and pos.z == pPos.z then
        -- Container is physically located on the map floor near the player
        local dist = math.max(math.abs(pPos.x - pos.x), math.abs(pPos.y - pos.y))
        if dist <= 2 then
          local cName = safeCall(container, "getName", ""):lower()
          -- Strictly match monster corpses / slain bodies (NEVER "bag" or "chest")
          if safeCall(container, "isCorpse", false) or
             cName:find("dead ") or cName:find("slain ") or cName:find("remains") or
             cName:find("body of") or cName:find("corpse") or
             cName:find("rotworm") or cName:find("rat") or cName:find("skeleton") then
            isCorpse = true
          end
        end
      end
    end

    if isCorpse then
      local items = safeCall(container, "getItems", {})
      local itemsToLoot = {}

      for _, item in ipairs(items) do
        if isItemValuable(item) then
          table.insert(itemsToLoot, item)
        end
      end

      -- Loot valuable items into backpack
      for _, item in ipairs(itemsToLoot) do
        local count = safeCall(item, "getCount", 1)
        g_game.move(item, backpackDest, count)
        print(string.format("[JevBot] Auto-looted: %s (x%d)", safeCall(item, "getName", "Valuable Item"), count))
      end

      -- Once all valuables have been looted (or container only has trash like worms/bones), close it!
      if #itemsToLoot == 0 then
        pcall(function()
          if g_game.close then
            g_game.close(container)
          elseif container.window and container.window.destroy then
            container.window:destroy()
          end
        end)
      end
    end
  end
end

function applyVocationDefaults(vocName)
  if not healSpellEdit or not atkSpellEdit then return end
  local v = vocName:lower()
  if v:find("knight") then
    healSpellEdit:setText("exura ico")
    atkSpellEdit:setText("exori ico")
  elseif v:find("paladin") then
    healSpellEdit:setText("exura")
    atkSpellEdit:setText("exori con")
  elseif v:find("sorcerer") then
    healSpellEdit:setText("exura")
    atkSpellEdit:setText("exori vis")
  elseif v:find("druid") then
    healSpellEdit:setText("exura")
    atkSpellEdit:setText("exori tera")
  end
end

function cycleVocation()
  currentVocationIndex = (currentVocationIndex % #vocations) + 1
  local voc = vocations[currentVocationIndex]
  if vocationBtn then
    vocationBtn:setText(tr(voc))
  end
  applyVocationDefaults(voc)
  print("[JevBot] Vocation set to: " .. voc)
end

function cyclePatrolMode()
  if patrolMode == "ping_pong" then
    patrolMode = "loop"
  else
    patrolMode = "ping_pong"
  end
  if patrolModeBtn then
    if patrolMode == "ping_pong" then
      patrolModeBtn:setText(tr('Patrol Mode: Ping-Pong (1-2-3-4-3-2-1)'))
    else
      patrolModeBtn:setText(tr('Patrol Mode: Loop (1-2-3-4-1)'))
    end
  end
  updateWaypointLabel()
  print("[JevBot] Waypoint patrol mode switched to: " .. patrolMode)
end

function updateWaypointLabel()
  if not waypointLbl then return end
  local player = g_game.getLocalPlayer()
  local currentZ = player and player:getPosition() and player:getPosition().z or 7
  local modeStr = patrolMode == "ping_pong" and (patrolDirection == 1 and "PP-Fwd" or "PP-Rev") or "Loop"

  if #waypoints == 0 then
    waypointLbl:setText(tr('Waypoints: None (will auto-patrol floor Z=%d)', currentZ))
  else
    local nextWp = waypoints[currentWaypointIndex] or waypoints[1]
    if nextWp.z ~= currentZ then
      waypointLbl:setText(tr('WPs: %d/%d [%s] (WP Floor Z=%d != Your Z=%d)', currentWaypointIndex, #waypoints, modeStr, nextWp.z, currentZ))
    else
      waypointLbl:setText(tr('WPs: %d/%d [%s Z:%d] (Next: %d,%d)', currentWaypointIndex, #waypoints, modeStr, nextWp.z, nextWp.x, nextWp.y))
    end
  end
end

function advanceWaypoint()
  if #waypoints == 0 then return end
  if #waypoints == 1 then
    currentWaypointIndex = 1
    unreachableTicks = 0
    ticksOnCurrentWp = 0
    updateWaypointLabel()
    return
  end

  if patrolMode == "ping_pong" then
    if patrolDirection == 1 then
      if currentWaypointIndex >= #waypoints then
        patrolDirection = -1
        currentWaypointIndex = #waypoints - 1
      else
        currentWaypointIndex = currentWaypointIndex + 1
      end
    else -- reverse direction (-1)
      if currentWaypointIndex <= 1 then
        patrolDirection = 1
        currentWaypointIndex = 2
      else
        currentWaypointIndex = currentWaypointIndex - 1
      end
    end
  else -- "loop"
    currentWaypointIndex = (currentWaypointIndex % #waypoints) + 1
  end

  unreachableTicks = 0
  ticksOnCurrentWp = 0
  currentWalkDest = nil
  updateWaypointLabel()
  local nextWp = waypoints[currentWaypointIndex]
  if nextWp then
    print(string.format("[JevBot] Advanced to waypoint #%d (%d, %d, %d) [%s dir=%d]",
      currentWaypointIndex, nextWp.x, nextWp.y, nextWp.z, patrolMode, patrolDirection))
  end
end

function skipWaypoint()
  advanceWaypoint()
end

function addCurrentWaypoint()
  local player = g_game.getLocalPlayer()
  if not player then
    print("[JevBot] Cannot add waypoint: Player not logged in.")
    return
  end
  local pos = player:getPosition()
  if not pos then return end

  table.insert(waypoints, { x = pos.x, y = pos.y, z = pos.z })
  print(string.format("[JevBot] Added waypoint #%d at (%d, %d, %d)", #waypoints, pos.x, pos.y, pos.z))
  updateWaypointLabel()
end

function clearWaypoints()
  waypoints = {}
  currentWaypointIndex = 1
  patrolDirection = 1
  unreachableTicks = 0
  ticksOnCurrentWp = 0
  currentWalkDest = nil
  print("[JevBot] Waypoints cleared.")
  updateWaypointLabel()
end

function generateCavePatrol(playerPos)
  local patrol = {}
  local cardinalDirs = {
    { dx = 0, dy = -1 },
    { dx = 1, dy = 0  },
    { dx = 0, dy = 1  },
    { dx = -1, dy = 0 },
  }

  for _, d in ipairs(cardinalDirs) do
    local farthestPos = nil
    for step = 1, 6 do
      local testPos = { x = playerPos.x + d.dx * step, y = playerPos.y + d.dy * step, z = playerPos.z }
      if isTileWalkable(testPos) then
        farthestPos = testPos
      else
        break -- Hit a cave wall; stop raycast
      end
    end
    if farthestPos and (farthestPos.x ~= playerPos.x or farthestPos.y ~= playerPos.y) then
      table.insert(patrol, farthestPos)
    end
  end

  if #patrol == 0 then
    table.insert(patrol, { x = playerPos.x, y = playerPos.y, z = playerPos.z })
  end
  return patrol
end

function ensureWindow()
  if botWindow then return botWindow end

  local ok, err = pcall(function()
    botWindow = g_ui.displayUI('jev_bot.otui')
    if botWindow then
      toggleBtn = botWindow:getChildById('toggleButton')
      statusLbl = botWindow:getChildById('statusLabel')
      macroLbl = botWindow:getChildById('macroLabel')
      decisionLbl = botWindow:getChildById('decisionLabel')
      waypointLbl = botWindow:getChildById('waypointLabel')
      lootLbl = botWindow:getChildById('lootLabel')
      vocationBtn = botWindow:getChildById('vocationButton')
      healSpellEdit = botWindow:getChildById('healSpellEdit')
      atkSpellEdit = botWindow:getChildById('atkSpellEdit')
      patrolModeBtn = botWindow:getChildById('patrolModeButton')
      if patrolModeBtn then
        if patrolMode == "ping_pong" then
          patrolModeBtn:setText(tr('Patrol Mode: Ping-Pong (1-2-3-4-3-2-1)'))
        else
          patrolModeBtn:setText(tr('Patrol Mode: Loop (1-2-3-4-1)'))
        end
      end
      updateWaypointLabel()
    end
  end)

  if not ok or not botWindow then
    print("[JevBot] Warning: UI window could not be created: " .. tostring(err))
    return nil
  end

  return botWindow
end

function init()
  print("[JevBot] Initializing Jev Autonomous Cavebot & Combat module...")

  -- Bind hotkeys
  pcall(function()
    g_keyboard.bindKeyDown('Ctrl+J', toggleWindow)
    g_keyboard.bindKeyDown('Ctrl+W', addCurrentWaypoint)
  end)

  -- Register console commands
  if _G.commandEnv then
    _G.commandEnv.jev_show = showWindow
    _G.commandEnv.jev_hide = hideWindow
    _G.commandEnv.jev_start = startBot
    _G.commandEnv.jev_stop = stopBot
    _G.commandEnv.jev_toggle = toggleBot
    _G.commandEnv.jev_add_wp = addCurrentWaypoint
    _G.commandEnv.jev_skip_wp = skipWaypoint
    _G.commandEnv.jev_clear_wp = clearWaypoints
    _G.commandEnv.jev_voc = cycleVocation
    _G.commandEnv.jev_patrol = cyclePatrolMode
  end

  -- Safely attempt top-menu button registration
  pcall(function()
    if modules.client_topmenu then
      if modules.client_topmenu.addRightToggleButton then
        topButton = modules.client_topmenu.addRightToggleButton('jevBotButton', tr('Jev AI Bot'), '/images/topbuttons/bot', toggleWindow)
      elseif modules.client_topmenu.addRightButton then
        topButton = modules.client_topmenu.addRightButton('jevBotButton', tr('Jev AI Bot'), '/images/topbuttons/bot', toggleWindow)
      end
    end
  end)

  print("[JevBot] Ready! Press Ctrl+J for UI or Ctrl+W to add waypoints.")
end

function terminate()
  stopBot()
  pcall(function()
    g_keyboard.unbindKeyDown('Ctrl+J')
    g_keyboard.unbindKeyDown('Ctrl+W')
  end)
  if topButton then
    pcall(function() topButton:destroy() end)
    topButton = nil
  end
  if botWindow then
    pcall(function() botWindow:destroy() end)
    botWindow = nil
  end
end

function showWindow()
  local win = ensureWindow()
  if win then
    win:show()
    win:raise()
    win:focus()
    updateWaypointLabel()
  end
end

function hideWindow()
  if botWindow then
    botWindow:hide()
  end
end

function toggleWindow()
  if botWindow and botWindow:isVisible() then
    hideWindow()
  else
    showWindow()
  end
end

function toggleBot()
  if isBotEnabled then
    stopBot()
  else
    startBot()
  end
end

function startBot()
  isBotEnabled = true
  if toggleBtn then toggleBtn:setText(tr('Stop Jev Bot')) end
  if statusLbl then statusLbl:setText(tr('Status: Active (Connecting to Jev)')) end
  if macroLbl then macroLbl:setText(tr('State: ACTIVE')) end
  tickCounter = 0
  isWaitingResponse = false
  unreachableTicks = 0
  ticksOnCurrentWp = 0
  currentWalkDest = nil

  -- Auto-generate cave-aware patrol waypoints along walkable floor if none recorded
  local player = g_game.getLocalPlayer()
  if player and #waypoints == 0 then
    local p = player:getPosition()
    if p then
      waypoints = generateCavePatrol(p)
      currentWaypointIndex = 1
      patrolDirection = 1
      print(string.format("[JevBot] Generated %d cave-aware floor waypoints on Z=%d", #waypoints, p.z))
    end
  end

  updateWaypointLabel()
  print("[JevBot] Bot started! Polling and streaming ticks to " .. serverUrl)
  runTick()
end

function stopBot()
  isBotEnabled = false
  if toggleBtn then toggleBtn:setText(tr('Start Jev Bot')) end
  if statusLbl then statusLbl:setText(tr('Status: Stopped')) end
  if macroLbl then macroLbl:setText(tr('State: STOPPED')) end
  if tickEvent then
    removeEvent(tickEvent)
    tickEvent = nil
  end
  currentWalkDest = nil
  print("[JevBot] Bot stopped.")
end

function isTileWalkable(pos)
  if not pos then return false end
  local tile = g_map.getTile(pos)
  if not tile then return false end

  -- Check if tile has walkable property (no rock walls, water, solid obstacles)
  local ok, walkable = pcall(function() return tile:isWalkable() end)
  if ok and not walkable then return false end

  -- Check if tile is blocked by another creature
  local okCreatures, creatures = pcall(function() return tile:getCreatures() end)
  if okCreatures and creatures and #creatures > 0 then
    return false
  end

  return true
end

function safeWalk(action)
  local player = g_game.getLocalPlayer()
  if not player then return end
  local playerPos = player:getPosition()
  if not playerPos then return end

  -- 1. Check if the directly requested direction is walkable
  local requested = dirOffsets[action.direction]
  if requested then
    local destPos = { x = playerPos.x + requested.dx, y = playerPos.y + requested.dy, z = playerPos.z }
    if isTileWalkable(destPos) then
      g_game.walk(requested.dir)
      return
    end
  end

  -- 2. Requested tile is BLOCKED (wall or obstacle) -> Smart obstacle evasion!
  local targetPos = action.targetPosition
  local fallbackMode = action.fallbackMode or "kite_away"
  local bestDir = nil
  local bestScore = fallbackMode == "kite_away" and -9999 or 9999

  for name, offset in pairs(dirOffsets) do
    local candidatePos = { x = playerPos.x + offset.dx, y = playerPos.y + offset.dy, z = playerPos.z }
    if isTileWalkable(candidatePos) then
      if targetPos then
        local dist = math.max(math.abs(candidatePos.x - targetPos.x), math.abs(candidatePos.y - targetPos.y))
        if fallbackMode == "kite_away" then
          -- Pick the walkable tile that maximizes distance away from monster
          if dist > bestScore then
            bestScore = dist
            bestDir = offset.dir
          end
        else
          -- Pick the walkable tile that closes in to monster
          if dist < bestScore then
            bestScore = dist
            bestDir = offset.dir
          end
        end
      else
        bestDir = offset.dir
        break
      end
    end
  end

  -- If a safe walkable path exists, walk it. If all 8 tiles are blocked, do NOT walk into walls!
  if bestDir then
    g_game.walk(bestDir)
  end
end

-- Smooth, fluid auto-walk (avoids wasteful 1 SQM stutter steps)
function autoWalkTo(destination)
  if not destination then return end
  local player = g_game.getLocalPlayer()
  if not player then return end
  local playerPos = player:getPosition()
  if not playerPos then return end

  -- 1. Floor / Z-level check
  if destination.z ~= playerPos.z then
    unreachableTicks = unreachableTicks + 1
    if unreachableTicks >= 3 then
      print(string.format("[JevBot] Waypoint on floor Z=%d is not on current floor Z=%d. Advancing.", destination.z, playerPos.z))
      advanceWaypoint()
    end
    return
  end

  -- 2. Check if player is ALREADY smoothly walking towards this destination
  local isAlreadyWalking = false
  pcall(function()
    if player.isAutoWalking and player:isAutoWalking() then
      isAlreadyWalking = true
    elseif g_game.isAutoWalking and g_game.isAutoWalking() then
      isAlreadyWalking = true
    end
  end)

  -- If character is already running fluidly to this waypoint, let it run!
  if isAlreadyWalking and currentWalkDest and
     currentWalkDest.x == destination.x and
     currentWalkDest.y == destination.y and
     currentWalkDest.z == destination.z then
    return
  end

  -- 3. Pre-validate path with g_map.findPath to eliminate "Não há rota"
  local calculatedPath = nil
  pcall(function()
    if g_map.findPath then
      local path = g_map.findPath(playerPos, destination, 100, 0)
      if path and #path > 0 then
        calculatedPath = path
      end
    end
  end)

  if g_map.findPath and not calculatedPath then
    unreachableTicks = unreachableTicks + 1
    if unreachableTicks >= 3 then
      print(string.format("[JevBot] No route to waypoint #%d (%d,%d,Z%d) -> auto-skipping.", currentWaypointIndex, destination.x, destination.y, destination.z))
      advanceWaypoint()
    end
    return
  end

  unreachableTicks = 0
  currentWalkDest = { x = destination.x, y = destination.y, z = destination.z }

  -- 4. Initiate continuous fluid auto-walk across the entire path (continuous motion)
  local walked = false

  -- Primary: player:autoWalk accepts coordinate {x, y, z}
  pcall(function()
    if player.autoWalk then
      player:autoWalk(destination)
      walked = true
    end
  end)

  -- Secondary: g_game.autoWalk accepts direction array (vector<Direction>)
  if (not walked or (player.isAutoWalking and not player:isAutoWalking())) and calculatedPath then
    pcall(function()
      if g_game.autoWalk then
        g_game.autoWalk(calculatedPath)
        walked = true
      end
    end)
  end
end

function lootCorpseAt(position)
  if not position then return end
  local key = position.x .. "," .. position.y .. "," .. position.z
  local now = os.time()

  local tile = g_map.getTile(position)
  if not tile then return end

  local topThing = safeCall(tile, "getTopUseThing", nil)
  if topThing then
    g_game.use(topThing)
    lootedCorpses[key] = now
    return
  end

  local items = safeCall(tile, "getItems", nil)
  if items and #items > 0 then
    for _, item in ipairs(items) do
      if safeCall(item, "isContainer", false) or safeCall(item, "isCorpse", false) then
        g_game.use(item)
        lootedCorpses[key] = now
        break
      end
    end
  end
end

function runTick()
  if not isBotEnabled then return end

  local ok, err = pcall(function()
    if not g_game.isOnline() then
      if statusLbl then statusLbl:setText(tr('Status: Waiting for Character Login...')) end
      tickEvent = scheduleEvent(runTick, 1000)
      return
    end

    local player = g_game.getLocalPlayer()
    if not player then
      tickEvent = scheduleEvent(runTick, 500)
      return
    end

    -- Process and loot any open corpse containers (picks valuables, ignores trash)
    lootOpenContainers()

    local now = os.time()

    -- Watchdog: if waiting for response > 3 seconds, reset and retry
    if isWaitingResponse then
      if now - requestTimestamp > 3 then
        print("[JevBot] Warning: Backend tick request timed out (3s). Resetting.")
        isWaitingResponse = false
      else
        tickEvent = scheduleEvent(runTick, 100)
        return
      end
    end

    -- Auto-detect vocation once upon login if not manually set
    if not autoDetectedVocation then
      local rawVoc = safeCall(player, "getVocation", nil)
      if rawVoc then
        local vStr = tostring(rawVoc):lower()
        if vStr:find("knight") or rawVoc == 1 or rawVoc == 5 then
          currentVocationIndex = 1
        elseif vStr:find("paladin") or rawVoc == 2 or rawVoc == 6 then
          currentVocationIndex = 2
        elseif vStr:find("sorcerer") or rawVoc == 3 or rawVoc == 7 then
          currentVocationIndex = 3
        elseif vStr:find("druid") or rawVoc == 4 or rawVoc == 8 then
          currentVocationIndex = 4
        end
        local voc = vocations[currentVocationIndex]
        if vocationBtn then vocationBtn:setText(tr(voc)) end
        applyVocationDefaults(voc)
        autoDetectedVocation = true
        print("[JevBot] Detected character vocation: " .. voc)
      end
    end

    tickCounter = tickCounter + 1

    -- Clean old looted corpse entries (> 60s)
    for k, time in pairs(lootedCorpses) do
      if now - time > 60 then
        lootedCorpses[k] = nil
      end
    end

    local playerPos = player:getPosition()
    local attackingCreature = g_game.getAttackingCreature()
    local targetId = attackingCreature and attackingCreature:getId() or nil

    -- 1. Scan for active visible monsters
    local monsters = {}
    pcall(function()
      local spectators = g_map.getSpectators(playerPos, false)
      for _, spec in ipairs(spectators) do
        if spec:isMonster() and not spec:isDead() then
          local mPos = spec:getPosition()
          local dist = math.max(math.abs(playerPos.x - mPos.x), math.abs(playerPos.y - mPos.y))
          table.insert(monsters, {
            id = spec:getId(),
            name = spec:getName(),
            healthPercent = spec:getHealthPercent(),
            distance = dist,
            position = { x = mPos.x, y = mPos.y, z = mPos.z },
            isMonster = true,
            isPlayer = false,
            facingPlayer = false
          })
        end
      end
    end)

    -- 2. Scan for unlooted corpses around player (radius 3 SQMs)
    local corpses = {}
    local scanned = {}
    pcall(function()
      for dx = -3, 3 do
        for dy = -3, 3 do
          local tilePos = { x = playerPos.x + dx, y = playerPos.y + dy, z = playerPos.z }
          local key = tilePos.x .. "," .. tilePos.y .. "," .. tilePos.z
          if not lootedCorpses[key] and not scanned[key] then
            local tile = g_map.getTile(tilePos)
            if tile then
              local items = safeCall(tile, "getItems", nil)
              if items then
                for _, item in ipairs(items) do
                  if safeCall(item, "isContainer", false) or safeCall(item, "isCorpse", false) then
                    scanned[key] = true
                    local dist = math.max(math.abs(dx), math.abs(dy))
                    table.insert(corpses, {
                      id = safeCall(item, "getId", 0),
                      position = tilePos,
                      distance = dist
                    })
                    break
                  end
                end
              end
            end
          end
        end
      end
    end)

    table.sort(corpses, function(a, b) return a.distance < b.distance end)

    -- 3. Waypoint advancement & stuck detector
    if #waypoints > 0 then
      local currentWp = waypoints[currentWaypointIndex]
      if currentWp then
        local wpDist = math.max(math.abs(playerPos.x - currentWp.x), math.abs(playerPos.y - currentWp.y))
        if wpDist <= 1 and playerPos.z == currentWp.z then
          advanceWaypoint()
        else
          if lastWpIndex == currentWaypointIndex then
            ticksOnCurrentWp = ticksOnCurrentWp + 1
            -- If stuck on same waypoint for > 20 ticks (~5s) without reaching it, skip
            if ticksOnCurrentWp >= 20 then
              print(string.format("[JevBot] Stuck trying to reach waypoint #%d -> auto-skipping.", currentWaypointIndex))
              advanceWaypoint()
            end
          else
            lastWpIndex = currentWaypointIndex
            ticksOnCurrentWp = 0
          end
        end
      end
    end

    local nextWp = (#waypoints > 0) and waypoints[currentWaypointIndex] or nil
    local currentVoc = vocations[currentVocationIndex]
    local customHeal = healSpellEdit and healSpellEdit:getText() or ""
    local customAtk = atkSpellEdit and atkSpellEdit:getText() or ""

    local currentMs = nowMs()
    local spellCdRem = math.max(0, 1000 - (currentMs - lastSpellCastTime))
    local healCdRem = math.max(0, 1000 - (currentMs - lastHealCastTime))
    local attackCdRem = math.max(0, 2000 - (currentMs - lastAttackCastTime))
    local itemCdRem = math.max(0, 1000 - (currentMs - lastItemUseTime))

    local payload = {
      tickNumber = tickCounter,
      player = {
        name = safeCall(player, "getName", "Player"),
        level = safeCall(player, "getLevel", 1),
        vocation = currentVoc,
        health = safeCall(player, "getHealth", 100),
        maxHealth = safeCall(player, "getMaxHealth", 100),
        mana = safeCall(player, "getMana", 100),
        maxMana = safeCall(player, "getMaxMana", 100),
        capacity = safeCall(player, "getFreeCapacity", safeCall(player, "getCapacity", 0)),
        position = playerPos and { x = playerPos.x, y = playerPos.y, z = playerPos.z } or { x = 0, y = 0, z = 0 },
        targetId = targetId,
        isHasted = false,
        hasMagicShield = false,
        isPoisoned = false,
        isParalyzed = false,
        config = {
          vocation = currentVoc,
          healingSpell = customHeal,
          attackSpell = customAtk
        }
      },
      monsters = monsters,
      corpses = corpses,
      nextWaypoint = nextWp,
      waypointIndex = currentWaypointIndex,
      totalWaypoints = #waypoints,
      patrolMode = patrolMode,
      cooldowns = {
        spellCooldownRemainingMs = spellCdRem,
        healCooldownRemainingMs = healCdRem,
        attackCooldownRemainingMs = attackCdRem,
        itemCooldownRemainingMs = itemCdRem,
      },
      inventory = {
        healingPotions = 20,
        manaPotions = 100,
        sdRunes = 50,
        areaRunes = 30
      }
    }

    if not HTTP or not HTTP.postJSON then
      print("[JevBot] Error: HTTP.postJSON is not available in this client build.")
      stopBot()
      return
    end

    isWaitingResponse = true
    requestTimestamp = os.time()

    HTTP.postJSON(serverUrl, payload, function(data, err)
      isWaitingResponse = false
      if not isBotEnabled then return end

      local res = data
      if type(res) == "string" and json and json.decode then
        pcall(function() res = json.decode(data) end)
      end

      if err then
        pcall(function()
          if statusLbl then statusLbl:setText(tr('Jev Error: %s', tostring(err))) end
        end)
      elseif res and res.actions then
        pcall(function()
          if statusLbl then
            statusLbl:setText(tr('Status: Live (Jev: %dms)', res.decision and res.decision.latencyMs or 0))
          end
          if macroLbl and res.decision and res.decision.macroState then
            macroLbl:setText(tr('State: %s', tostring(res.decision.macroState)))
          end
          if decisionLbl and res.decision then
            decisionLbl:setText(tr('Move: %s | Target: %s', res.decision.tacticalMovement or 'none', res.decision.selectedTargetName or 'none'))
          end
        end)
        updateWaypointLabel()
        executeActions(res.actions)
      end

      tickEvent = scheduleEvent(runTick, 250)
    end)
  end)

  if not ok then
    print("[JevBot] Tick execution error: " .. tostring(err))
    tickEvent = scheduleEvent(runTick, 1000)
  end
end

function executeActions(actions)
  if not actions then return end
  for _, action in ipairs(actions) do
    pcall(function()
      if action.type == "say" and action.text then
        local text = action.text:lower()
        local isSpell = text:find("^ex") or text:find("^ut") or text:find("^ad")
        if isSpell then
          local t = nowMs()
          local isHeal = text:find("exura") or text:find("ico") or text:find("san") or text:find("vita") or text:find("gran")
          if t - lastSpellCastTime < 1000 then
            -- Global spell cooldown active: drop packet to avoid exhaustion
            return
          end
          if isHeal and (t - lastHealCastTime < 1000) then
            return
          end
          if not isHeal and (t - lastAttackCastTime < 2000) then
            return
          end

          g_game.talk(action.text)
          lastSpellCastTime = t
          if isHeal then
            lastHealCastTime = t
          else
            lastAttackCastTime = t
          end
        else
          g_game.talk(action.text)
        end
      elseif action.type == "attack" and action.targetId then
        local creature = g_map.getCreatureById(action.targetId)
        if creature then
          g_game.attack(creature)
        end
      elseif action.type == "walk" and action.direction then
        safeWalk(action)
      elseif action.type == "auto_walk" and action.destination then
        autoWalkTo(action.destination)
      elseif action.type == "loot_corpse" and action.position then
        lootCorpseAt(action.position)
      elseif action.type == "hold" then
        -- Maintain position
      elseif action.type == "use_item" and action.itemId then
        local t = nowMs()
        if t - lastItemUseTime < 1000 then
          -- Item cooldown active: drop packet to avoid exhaustion
          return
        end
        if action.targetId then
          local creature = g_map.getCreatureById(action.targetId)
          if creature then
            g_game.useInventoryItemWith(action.itemId, creature)
            lastItemUseTime = t
          end
        else
          local player = g_game.getLocalPlayer()
          if player then
            g_game.useInventoryItemWith(action.itemId, player)
            lastItemUseTime = t
          end
        end
      end
    end)
  end
end

-- Export module functions
modules.jev_bot = {
  show = showWindow,
  hide = hideWindow,
  toggle = toggleWindow,
  start = startBot,
  stop = stopBot,
  toggleBot = toggleBot,
  addCurrentWaypoint = addCurrentWaypoint,
  skipWaypoint = skipWaypoint,
  clearWaypoints = clearWaypoints,
  cycleVocation = cycleVocation,
  cyclePatrolMode = cyclePatrolMode,
  advanceWaypoint = advanceWaypoint,
}
