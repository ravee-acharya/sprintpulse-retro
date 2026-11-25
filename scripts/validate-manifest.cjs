// Offline manifest validation using the globally-installed Forge CLI's own validator
// (the same one `forge lint` runs), so it works without `forge login`.
const { execSync } = require('node:child_process');
const path = require('node:path');

const globalRoot = execSync('npm root -g').toString().trim();
const { validate } = require(path.join(globalRoot, '@forge/cli/node_modules/@forge/manifest'));

validate(false, path.resolve(__dirname, '..', 'manifest.yml')).then((res) => {
  const errors = res.errors ?? [];
  for (const e of errors) console.log(`${e.level ?? 'error'}: ${e.message}${e.reference ? ` (${e.reference})` : ''}`);
  const hard = errors.filter((e) => (e.level ?? 'error') === 'error');
  console.log(hard.length ? `Manifest invalid (${hard.length} error(s)).` : `Manifest valid (${errors.length - hard.length} warning(s)).`);
  process.exit(hard.length ? 1 : 0);
});
