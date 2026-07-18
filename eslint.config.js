import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/dist-electron/**", "**/release/**", "**/node_modules/**"],
  },
  ...tseslint.configs.recommended
);
