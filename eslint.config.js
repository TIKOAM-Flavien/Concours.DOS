import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist-all/**",
      "dist-admin/**",
      "dist-portal/**",
      "server/uploads/**",
      "debug/**",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: "readonly",
      },
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-key": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    files: ["server/**/*.js", "scripts/**/*.{js,mjs}", "vite.config.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
