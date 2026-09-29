import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve(import.meta.dirname, '..');
const sourceName = 'src/AgreementRegistry.sol';
const testName = 'test/AgreementRegistry.t.sol';
const input = {
  language: 'Solidity',
  sources: {
    [sourceName]: {content: fs.readFileSync(path.join(root, sourceName), 'utf8')},
    [testName]: {content: fs.readFileSync(path.join(root, testName), 'utf8')},
  },
  settings: {
    optimizer: {enabled: true, runs: 200},
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}},
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), {
  import(importPath) {
    const resolved = path.resolve(root, 'node_modules', importPath);
    return fs.existsSync(resolved)
      ? {contents: fs.readFileSync(resolved, 'utf8')}
      : {error: `Missing import: ${importPath}`};
  },
}));
for (const issue of output.errors ?? []) {
  if (issue.severity === 'error') process.stderr.write(`${issue.formattedMessage}\n`);
}
if (output.errors?.some(issue => issue.severity === 'error')) process.exit(1);
const artifact = output.contracts[sourceName].AgreementRegistry;
const abiPath = path.resolve(root, '../blockchain/abi/AgreementRegistry.json');
const buildPath = path.join(root, 'build/AgreementRegistry.bytecode.json');
fs.mkdirSync(path.dirname(abiPath), {recursive: true});
fs.mkdirSync(path.dirname(buildPath), {recursive: true});
fs.writeFileSync(abiPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
fs.writeFileSync(buildPath, `${JSON.stringify({bytecode: `0x${artifact.evm.bytecode.object}`}, null, 2)}\n`);
process.stdout.write(`Compiled AgreementRegistry with solc ${solc.version()}\n`);
