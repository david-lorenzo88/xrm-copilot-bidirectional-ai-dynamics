import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// tabster (Fluent focus management) expects these DOM globals.
globalThis.NodeFilter ??= window.NodeFilter;
afterEach(() => cleanup());
