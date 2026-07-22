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

local function json_string(value)
  return '"' .. value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\r", "\\r"):gsub("\n", "\\n"):gsub("</", "<\\/") .. '"'
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

-- Cryptographic primitives for target code obfuscation (SHA-256 and simple XOR cipher)
local sha256 = {}
local rrotate = function(x, n)
  return ((x >> n) | (x << (32 - n))) & 0xffffffff
end
local rshift = function(x, n)
  return (x >> n) & 0xffffffff
end

local h_init = {
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
}

local k_constants = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
}

local function str_to_words(str)
  local words = {}
  for i = 1, #str, 4 do
    local b1, b2, b3, b4 = string.byte(str, i, i + 3)
    b2 = b2 or 0
    b3 = b3 or 0
    b4 = b4 or 0
    words[#words + 1] = (b1 << 24) | (b2 << 16) | (b3 << 8) | b4
  end
  return words
end

local function words_to_str(words)
  local bytes = {}
  for _, w in ipairs(words) do
    bytes[#bytes + 1] = string.char(
      (w >> 24) & 0xff,
      (w >> 16) & 0xff,
      (w >> 8) & 0xff,
      w & 0xff
    )
  end
  return table.concat(bytes)
end

function sha256.sha256(msg)
  local h = { table.unpack(h_init) }
  local extra = #msg % 64
  local padding_len = 64 - extra
  if padding_len < 9 then
    padding_len = padding_len + 64
  end
  
  local padding = string.char(0x80) .. string.rep(string.char(0), padding_len - 9)
  local bit_len = #msg * 8
  local len_str = string.char(
    (bit_len >> 56) & 0xff,
    (bit_len >> 48) & 0xff,
    (bit_len >> 40) & 0xff,
    (bit_len >> 32) & 0xff,
    (bit_len >> 24) & 0xff,
    (bit_len >> 16) & 0xff,
    (bit_len >> 8) & 0xff,
    bit_len & 0xff
  )
  
  local padded_msg = msg .. padding .. len_str
  local words = str_to_words(padded_msg)
  
  for chunk_start = 1, #words, 16 do
    local w = {}
    for i = 1, 16 do w[i] = words[chunk_start + i - 1] end
    for i = 17, 64 do
      local s0 = rrotate(w[i - 15], 7) ~ rrotate(w[i - 15], 18) ~ rshift(w[i - 15], 3)
      local s1 = rrotate(w[i - 2], 17) ~ rrotate(w[i - 2], 19) ~ rshift(w[i - 2], 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xffffffff
    end
    
    local a, b, c, d, e, f, g, h_val = table.unpack(h)
    
    for i = 1, 64 do
      local S1 = rrotate(e, 6) ~ rrotate(e, 11) ~ rrotate(e, 25)
      local ch = (e & f) ~ (~e & g)
      local temp1 = (h_val + S1 + ch + k_constants[i] + w[i]) & 0xffffffff
      local S0 = rrotate(a, 2) ~ rrotate(a, 13) ~ rrotate(a, 22)
      local maj = (a & b) ~ (a & c) ~ (b & c)
      local temp2 = (S0 + maj) & 0xffffffff
      
      h_val = g
      g = f
      f = e
      e = (d + temp1) & 0xffffffff
      d = c
      c = b
      b = a
      a = (temp1 + temp2) & 0xffffffff
    end
    
    h[1] = (h[1] + a) & 0xffffffff
    h[2] = (h[2] + b) & 0xffffffff
    h[3] = (h[3] + c) & 0xffffffff
    h[4] = (h[4] + d) & 0xffffffff
    h[5] = (h[5] + e) & 0xffffffff
    h[6] = (h[6] + f) & 0xffffffff
    h[7] = (h[7] + g) & 0xffffffff
    h[8] = (h[8] + h_val) & 0xffffffff
  end
  return words_to_str(h)
end

local function hex(bytes)
  return (bytes:gsub('.', function(c) return string.format('%02x', string.byte(c)) end))
end

local opaque_counter = 0
local function opaque(prefix)
  opaque_counter = opaque_counter + 1
  return prefix .. "_" .. hex(sha256.sha256("plotcat:" .. tostring(opaque_counter) .. ":" .. tostring(os.time()) .. ":" .. tostring(math.random()))):sub(1, 24)
end

local function encode_pattern(salt, pattern)
  local key = sha256.sha256(salt)
  local bytes = {}
  for i = 1, #pattern do
    local encoded = string.byte(pattern, i) ~ string.byte(key, ((i - 1) % #key) + 1)
    bytes[#bytes + 1] = string.format("%02x", encoded)
  end
  return table.concat(bytes)
end

local function widget(id, engine, target, starter, extra_classes)
  local dom_id = "plotcat-" .. id:gsub("[^%w_-]", "-")
  local package_json = {}
  local seen = {}
  local function add_packages(code)
    for _, package in ipairs(packages_for(engine, code)) do
      if not seen[package] then
        seen[package] = true
        table.insert(package_json, json_string(package))
      end
    end
  end
  add_packages(target)
  add_packages(starter)
  local manifest = '{"id":' .. json_string(id) .. ',"engine":' .. json_string(engine) .. ',"packages":[' .. table.concat(package_json, ",") .. ']}'
  local salt = opaque("salt")
  local target_code_encrypted = encode_pattern(salt, target)

  local live_engine = engine == "r" and "webr" or "pyodide"
  local html_before = [[
<section class="plotcat plotcat--side-by-side]] .. (extra_classes or "") .. [[" id="]] .. escape_html(dom_id) .. [[" data-plotcat-manifest="]] .. escape_html(manifest) .. [[" data-plotcat-target-code="]] .. escape_html(target_code_encrypted) .. [[" data-plotcat-salt="]] .. escape_html(salt) .. [[">
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
    local target = chunks[1].cell:walk({CodeBlock = function() return {} end})
    return pandoc.Div({target, pandoc.Para("The interactive PlotCat exercise is available in HTML.")}, pandoc.Attr(id, {"plotcat"}))
  end
  quarto.doc.add_html_dependency({name="plotcat", version="0.1.0", scripts={{path="plotcat.js", attribs={type="module"}}}, stylesheets={"plotcat.css"}, resources={"svg.js", "runtime-manager.js", "webr-adapter.js", "pyodide-adapter.js"}})
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
