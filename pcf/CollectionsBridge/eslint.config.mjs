import eslintjs from "@eslint/js";
import powerApps from "@microsoft/eslint-plugin-power-apps";
import globals from "globals";
import tseslint from "typescript-eslint";

/** pcf-scripts runs ESLint as part of `build`. */
export default [
  { ignores: ["**/generated/", "out/", "eslint.config.mjs"] },
  eslintjs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@microsoft/power-apps": powerApps },
    languageOptions: { globals: { ...globals.browser, ComponentFramework: "readonly" } },
    rules: {
      "@microsoft/power-apps/avoid-unpub-api": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
