local seen_ids = {}

local function fail(message)
  error("PlotCat: " .. message, 0)
end

local function engine_of(block)
  local engine = block.classes[1]
  if engine ~= "r" and engine ~= "python" then
    fail("unsupported engine '" .. (engine or "") .. "'; use r or python")
  end
  return engine
end

local function escape_html(value)
  return value:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
end

local function json_string(value)
  return '"' .. value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\r", "\\r"):gsub("\n", "\\n"):gsub("</", "<\\/") .. '"'
end

local function svg_from(div)
  local captured = nil
  div:walk({Image = function(image)
    if captured or not image.src:lower():match("%.svg$") then return nil end
    local ok, contents = pcall(function()
      local _, value = pandoc.mediabag.fetch(image.src)
      return value
    end)
    if ok and contents then captured = contents end
  end})
  if captured then return captured end
  for _, block in ipairs(div.content) do
    if block.t == "RawBlock" and block.format:match("html") then
      local svg = block.text:match("(<svg[%s%S]*</svg>)")
      if svg then return svg end
    end
  end
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="Target plot"><rect width="640" height="400" fill="none"/></svg>'
end

local function packages_for(engine, code)
  local packages, found = {}, {}
  local function add(name) if not found[name] then found[name] = true; table.insert(packages, name) end end
  if engine == "r" then
    for name in code:gmatch("([%w%.]+)%s*::") do add(name) end
    for name in code:gmatch("library%s*%(%s*['\"]?([%w%.]+)") do add(name) end
  else
    for name in code:gmatch("import%s+([%w_]+)") do add(name) end
    for name in code:gmatch("from%s+([%w_]+)") do add(name) end
  end
  return packages
end

local function clean_starter(code)
  return code:gsub("^#|[^\n]*\n", ""):gsub("\n#|[^\n]*", "")
end

local function widget(div, id, engine, target, starter)
  local dom_id = "plotcat-" .. id:gsub("[^%w_-]", "-")
  local package_json = {}
  for _, package in ipairs(packages_for(engine, target)) do table.insert(package_json, json_string(package)) end
  local manifest = '{"id":' .. json_string(id) .. ',"engine":' .. json_string(engine) .. ',"packages":[' .. table.concat(package_json, ",") .. ']}'
  local html = [[
<section class="plotcat plotcat--side-by-side" id="]] .. escape_html(dom_id) .. [[" data-plotcat-manifest="]] .. escape_html(manifest) .. [[">
  <header class="plotcat__header"><span>Recreate this plot</span><output class="plotcat__score" aria-live="polite"></output></header>
  <div class="plotcat__body">
    <figure class="plotcat__plot plotcat__target" data-plotcat-target>]] .. svg_from(div) .. [[</figure>
    <figure class="plotcat__plot plotcat__student" data-plotcat-student aria-label="Your plot"></figure>
  </div>
  <label for="]] .. escape_html(dom_id) .. [[-editor">Code</label>
  <textarea class="plotcat__editor plotcat__textarea" id="]] .. escape_html(dom_id) .. [[-editor" spellcheck="false">]] .. escape_html(starter) .. [[</textarea>
  <div class="plotcat__actions">
    <button class="plotcat__button" type="button" data-plotcat-run>Run</button>
    <fieldset class="plotcat__compare plotcat__controls"><legend>Compare</legend>
      <label><input type="radio" name="]] .. escape_html(dom_id) .. [[-mode" value="side-by-side" checked> Side by side</label>
      <label><input type="radio" name="]] .. escape_html(dom_id) .. [[-mode" value="overlay"> Overlay</label>
      <label><input type="radio" name="]] .. escape_html(dom_id) .. [[-mode" value="wipe"> Wipe</label>
      <label class="plotcat__slider">Wipe <input type="range" min="0" max="100" value="50" data-plotcat-wipe></label>
      <button class="plotcat__button" type="button" data-plotcat-toggle>Show student</button>
    </fieldset>
  </div>
  <div class="plotcat__status" role="status" aria-live="polite">Ready.</div>
  <div class="plotcat__feedback"></div>
</section>]]
  return pandoc.RawBlock("html", html)
end

function Div(div)
  if not div.classes:includes("plotcat") then return nil end
  for key, _ in pairs(div.attributes) do
    if key ~= "id" then fail("attribute '" .. key .. "' is not supported; only id is allowed") end
  end
  local id = div.identifier
  if id == "" then fail("an id is required") end
  if seen_ids[id] then fail("duplicate id '" .. id .. "'") end
  seen_ids[id] = true

  local chunks = {}
  for _, cell in ipairs(div.content) do
    if cell.t == "Div" and cell.classes:includes("cell") then
      local pieces, engine = {}, nil
      cell:walk({CodeBlock = function(block)
        if block.classes:includes("cell-code") then
          table.insert(pieces, block.text)
          if block.classes:includes("r") then engine = "r" end
          if block.classes:includes("python") then engine = "python" end
        end
      end})
      if #pieces > 0 then table.insert(chunks, pandoc.CodeBlock(table.concat(pieces, "\n"), pandoc.Attr("", engine and {engine} or {}))) end
    end
  end
  if #chunks == 0 then fail("'" .. id .. "' needs one target chunk") end
  if #chunks > 2 then fail("'" .. id .. "' has more than two executable chunks") end
  local engine = engine_of(chunks[1])
  if #chunks == 2 and engine_of(chunks[2]) ~= engine then fail("'" .. id .. "' mixes engines") end
  local starter = #chunks == 2 and clean_starter(chunks[2].text) or ""

  if not quarto.doc.is_format("html") then
    return pandoc.Div({pandoc.Para("Target plot"), pandoc.Para("The interactive PlotCat exercise is available in HTML.")}, pandoc.Attr(id, {"plotcat"}))
  end
  quarto.doc.add_html_dependency({name="plotcat", version="0.1.0", scripts={{path="plotcat.js", attribs={type="module"}}}, stylesheets={"plotcat.css"}, resources={"svg.js", "runtime-manager.js", "webr-adapter.js", "pyodide-adapter.js"}})
  return widget(div, id, engine, chunks[1].text, starter)
end
