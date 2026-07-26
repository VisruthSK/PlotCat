function CodeBlock(block)
  if block.classes:includes("plotcat-live-cell") then
    error(
      "PlotCat requires Quarto Live. " ..
      "Install it with `quarto add r-wasm/quarto-live` " ..
      "and use `format: live-html`."
    )
  end
end

return {
  { CodeBlock = CodeBlock }
}
