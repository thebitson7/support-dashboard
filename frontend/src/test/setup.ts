// Loaded before every test file (see vitest.config.mts).

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only unmounts automatically when test globals are on; they
// aren't here (tests import describe/it/expect explicitly), so do it by hand.
afterEach(() => {
  cleanup();
});
