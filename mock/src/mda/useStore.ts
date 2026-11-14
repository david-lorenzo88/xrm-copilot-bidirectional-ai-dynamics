import * as React from "react";
import type { Store } from "@collections/pcf-bridge/bridge";

export function useStore<S extends object>(store: Store<S>): S {
  const [state, setState] = React.useState(store.get());
  React.useEffect(() => store.subscribe(setState), [store]);
  return state;
}
