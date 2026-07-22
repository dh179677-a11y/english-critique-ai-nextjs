import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const relaxedNextConfig = nextCoreWebVitals.map((config) =>
  config.plugins?.react || config.plugins?.["react-hooks"] || config.plugins?.["@next/next"]
    ? {
        ...config,
        rules: {
          ...config.rules,
          ...(config.plugins?.["@next/next"]
            ? { "@next/next/no-assign-module-variable": "warn" }
            : {}),
          ...(config.plugins?.react ? { "react/display-name": "warn" } : {}),
          ...(config.plugins?.["react-hooks"]
            ? {
                "react-hooks/immutability": "warn",
                "react-hooks/purity": "warn",
                "react-hooks/set-state-in-effect": "warn",
              }
            : {}),
        },
      }
    : config
);

const relaxedTypescriptConfig = nextTypescript.map((config) =>
  config.plugins?.["@typescript-eslint"] ||
  config.rules?.["@typescript-eslint/no-explicit-any"] ||
  config.rules?.["@typescript-eslint/no-require-imports"]
    ? {
        ...config,
        rules: {
          ...config.rules,
          "@typescript-eslint/no-explicit-any": "warn",
          "@typescript-eslint/no-require-imports": "off",
        },
      }
    : config
);

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...relaxedNextConfig,
  ...relaxedTypescriptConfig,
  {
    rules: {
      "prefer-const": "warn",
    },
  },
];

export default eslintConfig;
