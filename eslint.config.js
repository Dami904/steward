import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // contracts/lib is a fetched, gitignored third-party dependency (forge-std,
    // OpenZeppelin — see contracts/setup.sh), not our code; lint has no business scanning it.
    // apps/** (Next.js, Phase 5) manages its own eslint config (React/JSX/Next-specific
    // rules this bare TS config doesn't have) and lints its own build output
    // (apps/*/.next/**) — run `pnpm --filter web lint`, not the root `pnpm lint`, for it.
    ignores: ["node_modules/**", "packages/engine-py/**", "fixtures/**", ".claude/**", "contracts/lib/**", "apps/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
