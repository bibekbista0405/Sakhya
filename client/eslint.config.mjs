import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next@15.x still exports the legacy `{ extends: [...] }`
// shape rather than a flat-config array (that only landed in the 16.x line).
// FlatCompat is Next.js's own supported bridge for using it under ESLint 9's
// flat config — this is the same pattern `create-next-app` scaffolds for
// Next 15.x projects.
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
