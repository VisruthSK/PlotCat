const PYTHON_RUNNER = `
import ast, contextlib, io, json, sys, traceback

def plotcat_render(code, width, height):
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        plt.close("all")
    console = io.StringIO()
    namespace = {"__builtins__": __builtins__}
    try:
        with contextlib.redirect_stdout(console), contextlib.redirect_stderr(console):
            tree = ast.parse(code)
            last = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = ast.Expression(tree.body.pop().value)
            exec(compile(tree, "<plotcat>", "exec"), namespace)
            result = eval(compile(last, "<plotcat>", "eval"), namespace) if last else None
            if result is not None:
                print(repr(result))
    except Exception:
        return json.dumps({"type": "error", "message": traceback.format_exc(), "output": console.getvalue()})
    if result is None:
        result = next((value for value in reversed(tuple(namespace.values())) if type(value).__module__.startswith("plotnine") and hasattr(value, "draw")), None)
    if result is not None and type(result).__module__.startswith("plotly") and hasattr(result, "to_json"):
        return '{"type":"plotly","data":' + result.to_json() + '}'
    plt = sys.modules.get("matplotlib.pyplot")
    if hasattr(result, "savefig"):
        figure = result
    elif type(result).__module__.startswith("plotnine") and hasattr(result, "draw"):
        figure = result.draw()
    elif plt is not None and plt.get_fignums():
        figure = plt.gcf()
    else:
        figure = None
    if figure is None:
        return json.dumps({"type": "no-plot", "output": console.getvalue()})
    figure.set_size_inches(width, height)
    buffer = io.StringIO()
    figure.savefig(buffer, format="svg")
    if plt is not None:
        plt.close("all")
    return buffer.getvalue()
`;

export const python = {
  label: 'Pyodide',
  example: 'plt.plot(), ggplot(), go.Figure()',
  setup: runtime => runtime.runPythonAsync(PYTHON_RUNNER),
  evaluate: (runtime, call) => runtime.runPythonAsync(call)
};
