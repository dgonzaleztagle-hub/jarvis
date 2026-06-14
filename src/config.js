const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.JARVIS_DATA_DIR || path.join(ROOT_DIR, 'local_data');
const PORT = Number(process.env.PORT || 3417);

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  PORT
};
