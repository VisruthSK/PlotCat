local seen_ids = {}
local validation_errors = {}
local validation_error_set = {}
local exercise_counter = 0

local function fail(message)
  local full_message = "PlotCat: " .. message
  if validation_error_set[full_message] then
    return
  end
  validation_error_set[full_message] = true
  table.insert(validation_errors, full_message)
end

local ENGINE_MAP = {
  webr = "r",
  r = "r",
  pyodide = "python",
  python = "python"
}

local function engine_of(block)
  local raw = block.classes[1]
  local engine = raw and ENGINE_MAP[raw]
  if engine then
    return engine
  end
  fail("unsupported engine '" .. (raw or "") .. "'; use webr, pyodide, r, or python")
  return nil
end

local ATTR_SPEC = {
  ["svg-geometry"] = {"svg", "geometry"},
  ["svg-text"] = {"svg", "text"},
  ["svg-style"] = {"svg", "style"},
  ["svg-frame"] = {"svg", "frame"},
  ["plotly-trace"] = {"plotly", "trace"},
  ["plotly-data"] = {"plotly", "data"},
  ["plotly-style"] = {"plotly", "style"},
  ["plotly-layout"] = {"plotly", "layout"},
  ["plotcat-width"] = "width",
  ["plotcat-height"] = "height",
  ["plotcat-heading"] = "heading"
}

local DEFAULT_WEIGHTS = {
  svg = {geometry = 0.6, text = 0.15, style = 0.1, frame = 0.15},
  plotly = {trace = 0.3, data = 0.4, style = 0.2, layout = 0.1}
}

local function extract_engine(block)
  for _, class in ipairs(block.classes) do
    if class ~= "cell-code" and class ~= "sourceCode" then
      return class
    end
  end
  return nil
end

local function parse_attributes(attrs, yaml_meta)
  local weights = {
    svg = {
      geometry = DEFAULT_WEIGHTS.svg.geometry,
      text = DEFAULT_WEIGHTS.svg.text,
      style = DEFAULT_WEIGHTS.svg.style,
      frame = DEFAULT_WEIGHTS.svg.frame
    },
    plotly = {
      trace = DEFAULT_WEIGHTS.plotly.trace,
      data = DEFAULT_WEIGHTS.plotly.data,
      style = DEFAULT_WEIGHTS.plotly.style,
      layout = DEFAULT_WEIGHTS.plotly.layout
    }
  }

  local yaml_overrides = yaml_meta and yaml_meta.weights
  if yaml_overrides then
    for cat, fields in pairs(yaml_overrides) do
      if weights[cat] then
        for field, val in pairs(fields) do
          if weights[cat][field] ~= nil then
            local raw = type(val) == "number" and tostring(val) or (type(val) == "string" and val or pandoc.utils.stringify(val))
            local num = tonumber(raw)
            if num then weights[cat][field] = num end
          end
        end
      end
    end
  end

  local yaml_dims = (yaml_meta and yaml_meta.dimensions) or {}
  local dims = {
    width = tonumber(yaml_dims.width),
    height = tonumber(yaml_dims.height)
  }

  local heading = yaml_meta and yaml_meta.heading and pandoc.utils.stringify(yaml_meta.heading) or nil

  for key, value in pairs(attrs) do
    local spec = ATTR_SPEC[key]
    if type(spec) == "table" then
      local num = tonumber(value)
      if num then
        weights[spec[1]][spec[2]] = num
      else
        fail("weight '" .. key .. "' must be a number, got '" .. value .. "'")
      end
    elseif spec == "width" then
      dims.width = tonumber(value) or dims.width
    elseif spec == "height" then
      dims.height = tonumber(value) or dims.height
    elseif spec == "heading" then
      heading = value
    end
  end

  return weights, dims, heading
end

local function escape_html(value)
  return value:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
end

local function widget(id, engine, target, starter, extra_classes, weights_json, dimensions, heading)
  local dom_id = "plotcat-" .. id:gsub("[^%w_-]", "-")
  local manifest = quarto.json.encode({
    id = id,
    engine = engine,
    width = dimensions and dimensions.width or nil,
    height = dimensions and dimensions.height or nil
  })
  local encoded_target = quarto.base64.encode(target)
  local encoded_weights = quarto.base64.encode(weights_json)

  local live_engine = engine == "r" and "webr" or "pyodide"
  local heading_text = escape_html(heading or "Recreate this plot")

  local html_parts = {
    '<section class="plotcat plotcat--side-by-side', escape_html(extra_classes or ""), '" id="', escape_html(dom_id),
    '" data-plotcat-manifest="', escape_html(manifest),
    '" data-plotcat-target-code="', escape_html(encoded_target),
    '" data-plotcat-weights="', escape_html(encoded_weights), '">\n',
    '  <header class="plotcat__header"><span>', heading_text, '</span><output class="plotcat__score" aria-live="polite"></output></header>\n',
    '  <div class="plotcat__body">\n',
    '    <figure class="plotcat__plot plotcat__target" data-plotcat-target><div class="plotcat__target-loading"><span class="plotcat__spinner"></span>Loading plot…</div></figure>\n',
    '    <figure class="plotcat__plot plotcat__student" data-plotcat-student aria-label="Your plot"></figure>\n',
    '    <button class="plotcat__wipe-handle" type="button" data-plotcat-wipe-handle role="slider" aria-label="Wipe comparison boundary" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></button>\n',
    '  </div>\n',
    '  <label for="', escape_html(dom_id), '-editor">Code</label>\n',
    '  <div class="plotcat-editor-container"><div class="plotcat__editor" id="', escape_html(dom_id), '-editor">\n'
  }

  local html_after_parts = {
    '  </div></div>\n',
    '  <div class="plotcat__actions">\n',
    '    <button class="plotcat__button" type="button" data-plotcat-run>Run</button>\n',
    '    <div class="plotcat__compare plotcat__controls"><span class="plotcat__compare-label">Compare</span>\n',
    '      <div class="plotcat__compare-options">\n',
    '        <label><input type="radio" name="', escape_html(dom_id), '-mode" value="side-by-side" checked> Side by side</label>\n',
    '        <label><input type="radio" name="', escape_html(dom_id), '-mode" value="overlay"> Overlay</label>\n',
    '        <label><input type="radio" name="', escape_html(dom_id), '-mode" value="wipe"> Wipe</label>\n',
    '      </div>\n',
    '    </div>\n',
    '  </div>\n',
    '  <div class="plotcat__status" role="status" aria-live="polite"></div>\n',
    '</section>'
  }

  local cell_options = "#| completion: true\n#| output: false\n"
  return {
    pandoc.RawBlock("html", table.concat(html_parts)),
    pandoc.CodeBlock(cell_options .. starter, pandoc.Attr("", {live_engine})),
    pandoc.RawBlock("html", table.concat(html_after_parts))
  }
end

function Div(div)
  if not div.classes:includes("plotcat") then return nil end
  for key, _ in pairs(div.attributes) do
    if key ~= "id" and not ATTR_SPEC[key] then
      fail("attribute '" .. key .. "' is not supported; only id, weight, and dimension attributes are allowed")
      return nil
    end
  end
  exercise_counter = exercise_counter + 1
  local id = div.identifier ~= "" and div.identifier or ("exercise-" .. exercise_counter)
  if seen_ids[id] then fail("duplicate id '" .. id .. "'"); return nil end
  seen_ids[id] = true

  local chunks = {}
  for _, cell in ipairs(div.content) do
    if cell.t == "Div" and cell.classes:includes("cell") then
      local pieces, engine, produced_output = {}, nil, false
      for _, block in ipairs(cell.content) do
        if block.t == "Div" and (block.classes:includes("cell-output") or block.classes:includes("cell-output-display")) then
          produced_output = true
        elseif block.t == "CodeBlock" and block.classes:includes("cell-code") then
          table.insert(pieces, block.text)
          engine = engine or extract_engine(block)
        end
      end
      if #pieces > 0 then
        table.insert(chunks, {
          block = pandoc.CodeBlock(table.concat(pieces, "\n"), pandoc.Attr("", engine and {engine} or {})),
          cell = cell,
          produced_output = produced_output
        })
      end
    elseif cell.t == "CodeBlock" then
      local engine = extract_engine(cell)
      table.insert(chunks, {
        block = cell,
        cell = pandoc.Div({cell}),
        produced_output = false
      })
    end
  end

  if #chunks == 0 then fail("'" .. id .. "' needs one target chunk"); return nil end
  if #chunks > 2 then fail("'" .. id .. "' has more than two executable chunks"); return nil end
  local engine = engine_of(chunks[1].block)
  if not engine then return nil end
  if #chunks == 2 and engine_of(chunks[2].block) ~= engine then fail("'" .. id .. "' mixes engines"); return nil end
  if #chunks == 2 and chunks[2].produced_output then fail("'" .. id .. "' starter chunk executed; add #| eval: false to the starter chunk"); return nil end
  local starter = #chunks == 2 and chunks[2].block.text or ""

  if not quarto.doc.is_format("html") then return nil end
  if not quarto.metadata.get("ojs-engine") then
    fail("PlotCat requires format: live-html (add `format: live-html` and install Quarto Live)")
    return nil
  end

  quarto.doc.add_html_dependency({
    name = "plotcat",
    version = "0.2.0",
    scripts = {{path = "plotcat.js", attribs = {type = "module"}}},
    stylesheets = {"plotcat.css"},
    resources = {"utils.js", "svg.js", "runtime-manager.js", "quarto-live-bridge.js", "webr-adapter.js", "pyodide-adapter.js"},
    head = '<link rel="preconnect" href="https://cdn.plot.ly" crossorigin><link rel="dns-prefetch" href="https://webr.r-wasm.org"><link rel="dns-prefetch" href="https://cdn.jsdelivr.net">'
  })

  local extra_classes = {}
  for _, class in ipairs(div.classes) do
    if class ~= "plotcat" then
      table.insert(extra_classes, class)
    end
  end
  local extra_class_str = #extra_classes > 0 and (" " .. table.concat(extra_classes, " ")) or ""
  local plotcat_meta = quarto.metadata.get("plotcat") or {}
  local weights_tbl, dims, heading = parse_attributes(div.attributes, plotcat_meta)
  local weights = quarto.json.encode(weights_tbl)
  return widget(id, engine, chunks[1].block.text, starter, extra_class_str, weights, dims, heading)
end

function Pandoc(doc)
  if #validation_errors > 0 then assert(false, table.concat(validation_errors, "\n")) end
  return doc
end

return {
  Div = Div,
  Pandoc = Pandoc
}
