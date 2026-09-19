/** @type {import('next').NextConfig} */
// Дашборд работает на собственном сервере. Standalone собирает сервер вместе
// с необходимыми зависимостями в переносимый каталог, который сервер забирает
// из выпуска.
//
// Корень сборки указан явно. В репозитории два package-lock.json — свой у
// приложения и свой у панели, — и Next иначе выбрал бы верхний.
const path = require('path')

const nextConfig = {
  output: 'standalone',
  // Next 16 сам кладёт в проект AGENTS.md и CLAUDE.md с описанием своих
  // новых правил. Файлы никто не просил, а CLAUDE.md в этом каталоге ещё
  // и подхватывается как указания для агента и спорит с корневым.
  agentRules: false,
  turbopack: { root: __dirname },
  outputFileTracingRoot: path.join(__dirname),
}

module.exports = nextConfig
