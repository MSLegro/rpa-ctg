import { readdirSync, statSync, createHash, createReadStream } from 'fs';
import { join, relative } from 'path';

const DEFAULT_DIR = process.platform === 'win32'
  ? 'Z:\\'
  : `${process.env.HOME}/Monitoreo_Fetal`;

const root = process.argv[2] || DEFAULT_DIR;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(p);
  }
  return out;
}

function sha1(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const files = walk(root);
console.log(`Total PDFs en ${root}: ${files.length}`);

const bySize = new Map();
for (const f of files) {
  const size = statSync(f).size;
  if (!bySize.has(size)) bySize.set(size, []);
  bySize.get(size).push(f);
}

const duplicateGroups = [];
for (const list of bySize.values()) {
  if (list.length < 2) continue;

  const byHash = new Map();
  for (const f of list) {
    const hash = await sha1(f);
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(f);
  }

  for (const [hash, same] of byHash) {
    if (same.length > 1) {
      duplicateGroups.push({ hash, files: same });
    }
  }
}

if (duplicateGroups.length === 0) {
  console.log('✅ Sin duplicados: no hay dos PDFs con el mismo contenido (mismo hash SHA1).');
} else {
  console.log(`\n⚠️ Se encontraron ${duplicateGroups.length} grupo(s) de PDFs idénticos:`);
  for (const group of duplicateGroups) {
    console.log(`\n  sha1=${group.hash.slice(0, 16)}…`);
    for (const f of group.files) {
      console.log(`    - ${relative(root, f)}`);
    }
  }
}
