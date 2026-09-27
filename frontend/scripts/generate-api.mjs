import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.resolve(frontendRoot, '..', 'contracts', 'openapi.json');
const outputDirectory = path.resolve(frontendRoot, 'src', 'generated');
const outputPath = path.join(outputDirectory, 'api.ts');

try {
  await access(schemaPath);
} catch {
  console.error(
    'contracts/openapi.json이 없습니다. Backend B0가 OpenAPI 계약을 생성한 뒤 다시 실행해 주세요.',
  );
  process.exit(1);
}

await mkdir(outputDirectory, { recursive: true });

const executable = path.join(
  frontendRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'openapi-typescript.cmd' : 'openapi-typescript',
);
const result = spawnSync(executable, [schemaPath, '-o', outputPath], {
  cwd: frontendRoot,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
