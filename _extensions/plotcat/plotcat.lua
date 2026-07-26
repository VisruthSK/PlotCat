local seen_ids = {}
local validation_errors = {}
local exercise_counter = 0

local function fail(message)
  table.insert(validation_errors, "PlotCat: " .. message)
end

local function engine_of(block)
  local engine = (block.classes[1] or ""):gsub("^{", ""):gsub("}$", "")
  if engine == "webr" or engine == "r" then
    return "r"
  elseif engine == "pyodide" or engine == "python" then
    return "python"
  else
    fail("unsupported engine '" .. (engine or "") .. "'; use webr, pyodide, r, or python")
    return nil
  end
end

local function escape_html(value)
  return value:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
end

local function packages_for(engine, code)
  local packages, found = {}, {}
  local function add(name) if not found[name] then found[name] = true; table.insert(packages, name) end end
  if engine == "r" then
    for name in code:gmatch("([%w%.]+)%s*::") do add(name) end
    for name in code:gmatch("library%s*%(%s*['\"]?([%w%.]+)") do add(name) end
  else
    for line in code:gmatch("[^\r\n]+") do
      local from_pkg = line:match("^%s*from%s+([%w_]+)") or line:match("%s+from%s+([%w_]+)")
      if from_pkg then
        add(from_pkg)
      else
        local import_pkg = line:match("^%s*import%s+([%w_]+)") or line:match("%s+import%s+([%w_]+)")
        if import_pkg then
          add(import_pkg)
        end
      end
    end
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

local function widget(id, engine, target, starter, extra_classes)
  local dom_id = "plotcat-" .. id:gsub("[^%w_-]", "-")
  local packages = {}
  local seen = {}
  local function add_packages(code)
    for _, package in ipairs(packages_for(engine, code)) do
      if not seen[package] then
        seen[package] = true
        table.insert(packages, package)
      end
    end
  end
  add_packages(target)
  add_packages(starter)
  local manifest = quarto.json.encode({
    id = id,
    engine = engine,
    packages = packages
  })
  local encoded_target = quarto.base64.encode(target)

  local live_engine = engine == "r" and "webr" or "pyodide"
  local html_before = [[
<section class="plotcat plotcat--side-by-side]] .. escape_html(extra_classes or "") .. [[" id="]] .. escape_html(dom_id) .. [[" data-plotcat-manifest="]] .. escape_html(manifest) .. [[" data-plotcat-target-code="]] .. escape_html(encoded_target) .. [[">
  <header class="plotcat__header"><span>Recreate this plot</span><output class="plotcat__score" aria-live="polite"></output></header>
  <div class="plotcat__body">
    <figure class="plotcat__plot plotcat__target" data-plotcat-target><div class="plotcat__target-loading"><span class="plotcat__spinner"></span>Loading plot…</div></figure>
    <figure class="plotcat__plot plotcat__student" data-plotcat-student aria-label="Your plot"></figure>
    <button class="plotcat__wipe-handle" type="button" data-plotcat-wipe-handle role="slider" aria-label="Wipe comparison boundary" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></button>
  </div>
  <label for="]] .. escape_html(dom_id) .. [[-editor">Code</label>
  <div class="plotcat-editor-container"><div class="plotcat__editor" id="]] .. escape_html(dom_id) .. [[-editor">
]]
  local html_after = [[
  </div></div>
  <div class="plotcat__actions">
    <button class="plotcat__button" type="button" data-plotcat-run>Run</button>
    <div class="plotcat__compare plotcat__controls"><span class="plotcat__compare-label">Compare</span>
      <div class="plotcat__compare-options">
        <label><input type="radio" name="]] .. escape_html(dom_id) .. [[-mode" value="side-by-side" checked> Side by side</label>
        <label><input type="radio" name="]] .. escape_html(dom_id) .. [[-mode" value="overlay"> Overlay</label>
        <label><input type="radio" name="]] .. escape_html(dom_id) .. [[-mode" value="wipe"> Wipe</label>
      </div>
    </div>
  </div>
  <div class="plotcat__status" role="status" aria-live="polite"></div>
  <div class="plotcat__feedback"></div>
</section>]]
  local cell_options = "#| completion: true\n#| output: false\n#| runbutton: false\n"
  return {
    pandoc.RawBlock("html", html_before),
    pandoc.CodeBlock(cell_options .. starter, pandoc.Attr("", {live_engine})),
    pandoc.RawBlock("html", html_after)
  }
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
    elseif cell.t == "CodeBlock" then
      local engine = nil
      for _, class in ipairs(cell.classes) do
        if class ~= "cell-code" and class ~= "sourceCode" then engine = engine or class end
      end
      table.insert(chunks, {
        block = cell,
        cell = pandoc.Div({cell}),
        produced_output = false
      })
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
    local target = chunks[1].cell:walk({
      CodeBlock = function()
        return {}
      end
    })

    return pandoc.Div(
      {
        target,
        pandoc.Para("The interactive PlotCat exercise is available in HTML.")
      },
      pandoc.Attr(id, {"plotcat"})
    )
  end


  quarto.doc.add_html_dependency({name="plotcat", version="0.2.0", scripts={{path="plotcat.js", attribs={type="module"}}}, stylesheets={"plotcat.css"}, resources={"svg.js", "runtime-manager.js", "webr-adapter.js", "pyodide-adapter.js"}})
  local extra_classes = {}
  for _, class in ipairs(div.classes) do
    if class ~= "plotcat" then
      table.insert(extra_classes, class)
    end
  end
  local extra_class_str = #extra_classes > 0 and (" " .. table.concat(extra_classes, " ")) or ""
  return widget(id, engine, chunks[1].block.text, starter, extra_class_str)
end

function Pandoc(doc)
  if #validation_errors > 0 then assert(false, table.concat(validation_errors, "\n")) end
  return doc
end

return {
  { Div = Div, Pandoc = Pandoc }
}
