// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'video/*'],
  },
  {
    // С SDK 57 eslint-config-expo включает правила подготовки к React Compiler
    // (eslint-plugin-react-hooks 7). Компилятор мы не используем, а по этим
    // правилам набегает 250 ошибок в рабочем коде, где ничего не сломано.
    // Выключены только они; rules-of-hooks и exhaustive-deps работают как раньше.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/unsupported-syntax': 'off',
    },
  },
]);
