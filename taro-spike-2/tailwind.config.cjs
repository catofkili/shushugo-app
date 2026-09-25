const path = require('node:path');

module.exports = {
  content: [path.resolve(__dirname, '../frontend/src/**/*.{html,js,ts,jsx,tsx}')],
  theme: { extend: {} },
  plugins: []
};
