// Google Chrome installé sur l'ordinateur (les tests « Android » et « ordinateur » l'utilisent ;
// ceux de l'iPhone utilisent WebKit, installé par Playwright). Variable CHROME_PATH pour un autre
// emplacement.
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable'
];

const found = CANDIDATES.find(p => p && fs.existsSync(p));
if (!found) throw new Error('Google Chrome introuvable : installe-le, ou indique son emplacement dans CHROME_PATH.');
module.exports = found;
