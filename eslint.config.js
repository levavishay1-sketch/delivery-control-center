import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.pgdata*/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo",
      "openspec/**",
      ".tmp-perf.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Unused names are usually leftovers, but `_x` marks one kept on purpose.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // `cond ? a() : b();` and `ok && fn();` as statements are used on purpose here;
      // comma-sequence statements (`(a++, b())`) are too, but the rule cannot allow them.
      "@typescript-eslint/no-unused-expressions": ["warn", { allowTernary: true, allowShortCircuit: true }],
      // A non-breaking space inside a regex or string is deliberate (Hebrew UI text).
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipStrings: true }],
      // Leftovers worth fixing when the line is next touched, not worth failing on.
      "prefer-const": "warn",
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
