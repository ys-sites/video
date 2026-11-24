/** Runs in the top frame before Studio: a WebMCP host whose registered tools `window[name]` can check and call. */
export function installWebMcpHost(name) {
  if (window.top !== window) return;
  const tools = new Map();
  const calls = [], registrations = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: async (tool) => { registrations.push(tool.name); tools.set(tool.name, tool); } },
  });
  window[name] = {
    names: () => [...tools.keys()],
    activity: () => ({ calls: [...calls], registrations: [...registrations] }),
    has: (tool) => tools.has(tool),
    call: (tool, input) => {
      if (!tools.has(tool)) throw new Error(`${tool} is not registered`);
      calls.push(tool);
      return tools.get(tool).execute(input, { signal: new AbortController().signal });
    },
  };
}
