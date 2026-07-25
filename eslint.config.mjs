// Flat ESLint config. `withNuxt` pulls in the base config @nuxt/eslint generates
// into .nuxt/ — it already knows this project's auto-imports, component dirs and
// Vue/TS plugins, so nothing here has to redeclare parsers or globals.
//
// Rules below are deliberately about CORRECTNESS, not formatting: this repo has
// no Prettier, and a formatter that fights the existing style would produce a
// giant diff for no safety gain. `stylistic: false` in nuxt.config keeps the
// generated config out of that business too.
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    name: 'ptank/typescript-strict',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    rules: {
      // `any` defeats the point of strict mode. Warn rather than error so it
      // surfaces without blocking work on the existing code.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Catch the genuinely dangerous ones as errors.
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off', // needs type-aware linting
      '@typescript-eslint/no-unused-vars': ['warn', {
        // Allow the `_` convention for intentionally-unused bindings.
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // A floating `await`-less promise silently swallows failures.
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'warn',
      'no-implicit-coercion': ['warn', { boolean: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    name: 'ptank/vue-strict',
    files: ['**/*.vue'],
    rules: {
      // Correctness in templates — each of these is a real runtime bug class.
      // NOTE: vue/no-undef-components is deliberately OFF. Nuxt auto-imports
      // everything in app/components/**, which the rule can't see, so it flagged
      // every local component (<AppHeader>, <PostCard>, …) as undefined. Keeping
      // it would mean maintaining an ignore list that mirrors the components dir.
      'vue/no-undef-components': 'off',
      'vue/no-undef-properties': 'warn',
      'vue/no-unused-refs': 'warn',
      'vue/no-useless-v-bind': 'warn',
      'vue/no-template-shadow': 'error',
      'vue/require-v-for-key': 'error',
      'vue/no-use-v-if-with-v-for': 'error',
      'vue/valid-v-slot': ['error', { allowModifiers: true }],
      // Accessibility of the club site matters (nuxt-a11y only runs in dev).
      'vue/require-explicit-emits': 'warn',
      'vue/prefer-separate-static-class': 'warn',
      // Component API hygiene.
      'vue/define-macros-order': ['warn', { order: ['defineProps', 'defineEmits'] }],
      'vue/no-required-prop-with-default': 'error',
      'vue/multi-word-component-names': 'off', // pages are single-word by design
    },
  },
  {
    // Build/scripts are plain Node ESM, not app code. The a11y plugin is
    // dev-only (stripped from prod) and its whole job is logging axe violations
    // to the console.
    name: 'ptank/node-scripts',
    files: ['scripts/**/*.mjs', 'build/**/*.mjs', 'app/plugins/a11y.client.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    name: 'ptank/ignores',
    ignores: ['.output/**', '.nuxt/**', '.wrangler/**', 'dist/**', 'image-sources/**'],
  },
)
