const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pdfjs содержит необязательный Node-only require('canvas'). На телефоне и в
// браузере он не выполняется, но Metro всё равно требует разрешить модуль.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  canvas: path.resolve(__dirname, 'shims/canvas.js'),
};

module.exports = config;
