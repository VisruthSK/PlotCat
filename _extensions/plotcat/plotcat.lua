local seen_ids = {}
local validation_errors = {}
local exercise_counter = 0

local function fail(message)
  table.insert(validation_errors, "PlotCat: " .. message)
end

local function engine_of(block)
  local engine = block.classes[1]
  if engine ~= "r" and engine ~= "python" then
    fail("unsupported engine '" .. (engine or "") .. "'; use r or python")
    return nil
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
  local rendered_format = nil
  div:walk({Image = function(image)
    local extension = image.src:lower():match("%.([%w]+)$")
    rendered_format = rendered_format or extension
    if captured or extension ~= "svg" then return nil end
    local ok, contents = pcall(function()
      local _, value = pandoc.mediabag.fetch(image.src)
      return value
    end)
    if ok and contents then captured = contents end
  end})
  if captured then return captured end
  div:walk({RawBlock = function(block)
    if not captured and block.format:match("html") then
      local svg = block.text:match("(<svg[%s%S]*</svg>)")
      if svg then captured = svg end
    end
  end})
  if captured then return captured end
  if rendered_format then
    fail("target rendered as " .. rendered_format:upper() .. "; set format.html.fig-format: svg")
  else
    fail("target chunk did not produce an SVG plot")
  end
  return nil
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

local function has_output(cell)
  for _, block in ipairs(cell.content) do
    if block.t == "Div" and (block.classes:includes("cell-output") or block.classes:includes("cell-output-display")) then
      return true
    end
  end
  return false
end

local function widget(id, engine, target, starter, target_svg)
  local dom_id = "plotcat-" .. id:gsub("[^%w_-]", "-")
  local package_json = {}
  for _, package in ipairs(packages_for(engine, target)) do table.insert(package_json, json_string(package)) end
  local manifest = '{"id":' .. json_string(id) .. ',"engine":' .. json_string(engine) .. ',"packages":[' .. table.concat(package_json, ",") .. ']}'
  local html = [[
<section class="plotcat plotcat--side-by-side" id="]] .. escape_html(dom_id) .. [[" data-plotcat-manifest="]] .. escape_html(manifest) .. [[">
  <header class="plotcat__header"><span>Recreate this plot</span><output class="plotcat__score" aria-live="polite"></output></header>
  <div class="plotcat__body">
    <figure class="plotcat__plot plotcat__target" data-plotcat-target>]] .. target_svg .. [[</figure>
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
      <button class="plotcat__button" type="button" data-plotcat-toggle>Hide student</button>
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
    if key ~= "id" then
      fail("attribute '" .. key .. "' is not supported; only id is allowed")
      return div
    end
  end
  exercise_counter = exercise_counter + 1
  local id = div.identifier ~= "" and div.identifier or ("exercise-" .. exercise_counter)
  if seen_ids[id] then fail("duplicate id '" .. id .. "'"); return div end
  seen_ids[id] = true

  local chunks = {}
  for _, cell in ipairs(div.content) do
    if cell.t == "Div" and cell.classes:includes("cell") then
      local pieces, engine = {}, nil
      cell:walk({CodeBlock = function(block)
        if block.classes:includes("cell-code") then
          table.insert(pieces, block.text)
          for _, class in ipairs(block.classes) do
            if class ~= "cell-code" and class ~= "sourceCode" then engine = engine or class end
          end
        end
      end})
      if #pieces > 0 then
        table.insert(chunks, {
          block = pandoc.CodeBlock(table.concat(pieces, "\n"), pandoc.Attr("", engine and {engine} or {})),
          cell = cell,
          produced_output = has_output(cell)
        })
      end
    end
  end
  if #chunks == 0 then fail("'" .. id .. "' needs one target chunk"); return div end
  if #chunks > 2 then fail("'" .. id .. "' has more than two executable chunks"); return div end
  local engine = engine_of(chunks[1].block)
  if not engine then return div end
  if #chunks == 2 and engine_of(chunks[2].block) ~= engine then fail("'" .. id .. "' mixes engines"); return div end
  if #chunks == 2 and chunks[2].produced_output then fail("'" .. id .. "' starter chunk executed; add #| eval: false to the starter chunk"); return div end
  local starter = #chunks == 2 and clean_starter(chunks[2].block.text) or ""

  if not quarto.doc.is_format("html") then
    local target = chunks[1].cell:walk({CodeBlock = function() return {} end})
    return pandoc.Div({target, pandoc.Para("The interactive PlotCat exercise is available in HTML.")}, pandoc.Attr(id, {"plotcat"}))
  end
  local target_svg = svg_from(div)
  if not target_svg then return div end
  quarto.doc.add_html_dependency({name="plotcat", version="0.1.0", scripts={{path="plotcat.js", attribs={type="module"}}}, stylesheets={"plotcat.css"}, resources={"svg.js", "runtime-manager.js", "webr-adapter.js", "pyodide-adapter.js"}})
  return widget(id, engine, chunks[1].block.text, starter, target_svg)
end

function Pandoc(doc)
  if #validation_errors > 0 then assert(false, table.concat(validation_errors, "\n")) end
  return doc
end
