import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'artifacts/**', 'coverage/**', 'node_modules/**', '.superpowers/**', '.claude/**'],
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        ...globals.jest,
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        game: 'readonly',
        canvas: 'readonly',
        ui: 'readonly',
        Hooks: 'readonly',
        foundry: 'readonly',
        CONFIG: 'readonly',
        Handlebars: 'readonly',
        Dialog: 'readonly',
        fromUuid: 'readonly',
        fromUuidSync: 'readonly',
        renderTemplate: 'readonly',
        ChatMessage: 'readonly',
        Actor: 'readonly',
        $: 'readonly',
        CONST: 'readonly',
        createMockToken: 'readonly',
        createMockActor: 'readonly',
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
