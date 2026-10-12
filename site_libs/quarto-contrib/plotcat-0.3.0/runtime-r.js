export const R_RUNNER = String.raw`
plotcat_error <- function(message, output = character()) {
  paste0('{"type":"error","message":', encodeString(message, quote = '"'),
         ',"output":', encodeString(paste(output, collapse = "\n"), quote = '"'), '}')
}

plotcat_render <- function(code, width, height) {
  if (!requireNamespace("svglite", quietly = TRUE)) {
    return(plotcat_error("PlotCat requires the R package 'svglite'. Add it under format.live-html.webr.packages."))
  }
  svg <- svglite::svgstring(width = width, height = height)
  figure <- NULL
  failure <- NULL
  output <- utils::capture.output({
    figure <- tryCatch({
      value <- withVisible(eval(parse(text = code), envir = new.env(parent = globalenv())))
      if (!value$visible) NULL
      else if (inherits(value$value, "plotly")) plotly::plotly_json(value$value, jsonedit = FALSE, pretty = FALSE)
      else { print(value$value); NULL }
    }, error = function(e) {
      failure <<- conditionMessage(e)
      NULL
    })
  })
  try(dev.off(), silent = TRUE)
  if (!is.null(failure)) return(plotcat_error(failure, output))
  if (!is.null(figure)) return(paste0('{"type":"plotly","data":', figure, '}'))
  content <- svg()
  if (!grepl("<(circle|line|path|polygon|polyline|rect|text|image|use)\\b", content, perl = TRUE)) {
    return(paste0('{"type":"no-plot","output":', encodeString(paste(output, collapse = "\n"), quote = '"'), '}'))
  }
  content
}
`;

export const r = {
  label: 'WebR',
  ojsKey: 'webROjs',
  promiseKey: 'webRPromise',
  example: 'plot(), ggplot(), tinyplot()',
  setup: runtime => runtime.evalRVoid(R_RUNNER),
  evaluate: (runtime, call) => runtime.evalRString(call)
};
