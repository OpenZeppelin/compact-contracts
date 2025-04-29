module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    jest: true,
  },
  extends: [
    'plugin:prettier/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  overrides: [],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['tsconfig.json'],
  },
  rules: {
    '@typescript-eslint/no-misused-promises': 'off', // https://github.com/typescript-eslint/typescript-eslint/issues/5807
    '@typescript-eslint/no-floating-promises': 'warn',
    '@typescript-eslint/promise-function-async': 'off',
    '@typescript-eslint/no-redeclare': 'off',
  },
};
