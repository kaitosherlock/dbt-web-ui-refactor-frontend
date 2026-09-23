import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Frontend refactor (see docs/frontend-refactor-plan.md #3): import-boundary
// rules for the app/features/entities/common/server layout. Phase 7 flips
// these from "warn" to "error" now that nothing violates them (verified by
// `npm run lint` and `npm run build` both being clean before this flip).
const restrict = (groups, message) => ({
  "no-restricted-imports": [
    "error",
    { patterns: groups.map((group) => ({ group: [group], message })) },
  ],
});

const eslintConfig = [
  {
    ignores: [".next/**", "coverage/**", "next-env.d.ts", "node_modules/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/common/**"],
    rules: restrict(
      ["@/features/*", "@/entities/*", "@/server/*", "@/app/*"],
      "common/ không được biết về domain (features/entities) hay server."
    ),
  },
  {
    files: ["src/entities/**"],
    rules: restrict(
      ["@/features/*", "@/server/*", "@/app/*"],
      "entities/ chỉ được import common/, không được import features/ hay server/."
    ),
  },
  {
    files: ["src/features/**"],
    ignores: ["src/features/*/server.ts"],
    rules: restrict(
      ["@/features/*/*", "@/server/*", "@/app/*", "@prisma/client"],
      "Sang feature khác chỉ qua index.ts (@/features/<name>); code chạy server để trong <feature>/server.ts."
    ),
  },
  {
    files: ["src/**"],
    rules: {
      "import/no-cycle": ["error", { maxDepth: 5 }],
    },
  },
];

export default eslintConfig;
