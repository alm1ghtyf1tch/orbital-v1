/** Keep the shipped WASM loader as a native module in either worker format. */
export function loadWasmModule(url: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}
