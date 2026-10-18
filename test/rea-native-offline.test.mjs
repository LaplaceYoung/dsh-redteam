import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createServices, inputSchemas } from '../src/rea-native/vendor/runtime.mjs';

const directory = await mkdtemp(join(tmpdir(), 'rea-native-offline-'));
const services = createServices();
after(async () => {
  await Promise.all(Object.values(services).map(service => service.close?.()));
  await rm(directory, { recursive: true, force: true });
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function sample(name, bytes) {
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { path, bytes };
}

// Minimal PE32+ image: DOS header, COFF header, optional header and one section.
function pe(sectionName = '.data', payload = Buffer.alloc(256), characteristics = 0xc0000040) {
  const bytes = Buffer.alloc(512 + payload.length);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60);
  bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(240, 148);
  const optional = 152;
  bytes.writeUInt16LE(0x20b, optional); bytes.writeBigUInt64LE(0x140000000n, optional + 24);
  bytes.writeUInt32LE(4096, optional + 32); bytes.writeUInt32LE(512, optional + 36);
  bytes.writeUInt32LE(8192, optional + 56); bytes.writeUInt32LE(512, optional + 60);
  bytes.writeUInt32LE(16, optional + 108);
  const section = optional + 240;
  bytes.write(sectionName, section); bytes.writeUInt32LE(payload.length, section + 8);
  bytes.writeUInt32LE(4096, section + 12); bytes.writeUInt32LE(payload.length, section + 16);
  bytes.writeUInt32LE(512, section + 20); bytes.writeUInt32LE(characteristics, section + 36);
  payload.copy(bytes, 512);
  return bytes;
}

function uvarint(value) {
  const bytes = [];
  while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; }
  return Buffer.from([...bytes, value]);
}
const moduleText = 'path\texample.org/demo\nmod\texample.org/demo\tv1.2.3\th1:demo\ndep\texample.org/lib\tv2.0.0\th1:lib\nbuild\tGOOS=windows\n';
function goPayload() {
  const header = Buffer.alloc(32);
  Buffer.from('ff20476f206275696c64696e663a', 'hex').copy(header);
  header[14] = 8; header[15] = 2;
  const version = Buffer.from('go1.23.4');
  const module = Buffer.concat([Buffer.from('3077af0c9274080241e1c107e6d618e6', 'hex'), Buffer.from(moduleText), Buffer.from('f932433186182072008242104116d8f2', 'hex')]);
  return Buffer.concat([header, uvarint(version.length), version, uvarint(module.length), module]);
}

// ELF64 section table: null, .shstrtab and a read-only .dep-v0 section.
function rustElf(compressed) {
  const names = Buffer.from('\0.shstrtab\0.dep-v0\0');
  const bytes = Buffer.alloc(512 + compressed.length);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(2, 16); bytes.writeUInt16LE(62, 18); bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(128n, 40); bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(3, 60); bytes.writeUInt16LE(1, 62);
  bytes.writeUInt32LE(1, 192); bytes.writeUInt32LE(3, 196);
  bytes.writeBigUInt64LE(384n, 216); bytes.writeBigUInt64LE(BigInt(names.length), 224);
  bytes.writeUInt32LE(11, 256); bytes.writeUInt32LE(1, 260);
  bytes.writeBigUInt64LE(2n, 264); bytes.writeBigUInt64LE(512n, 280);
  bytes.writeBigUInt64LE(BigInt(compressed.length), 288);
  names.copy(bytes, 384); compressed.copy(bytes, 512);
  return bytes;
}
const dependencyJson = Buffer.from(JSON.stringify({ format: 0, packages: [
  { name: 'demo', version: '1.2.3', source: 'local', root: true, dependencies: [1] },
  { name: 'serde', version: '1.0.0', source: 'crates.io', kind: 'runtime' },
] }));
const compressed = deflateSync(dependencyJson);
function resourcePe() {
  const payload = Buffer.alloc(128);
  for (const [offset, id, target] of [[0, 10, 0x80000018], [24, 7, 0x80000030], [48, 1033, 72]]) {
    payload.writeUInt16LE(1, offset + 14); payload.writeUInt32LE(id, offset + 16);
    payload.writeUInt32LE(target, offset + 20);
  }
  payload.writeUInt32LE(4096 + 96, 72); payload.writeUInt32LE(5, 76);
  payload.writeUInt32LE(65001, 80); Buffer.from('HELLO').copy(payload, 96);
  const bytes = pe('.rsrc', payload, 0x40000040);
  bytes.writeUInt32LE(4096, 280); bytes.writeUInt32LE(128, 284);
  return bytes;
}
const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const go = await sample('go.exe', pe('.data', goPayload()));
const rust = await sample('rust.elf', rustElf(compressed));
const resources = await sample('resources.exe', resourcePe());
const electron = await sample('electron.exe', pe('.rdata', Buffer.concat([sentinel, Buffer.from([1, 6, 49, 48, 114, 49, 49, 48])]), 0x40000040));
const absent = await sample('no-metadata.exe', pe());
const truncatedHeader = Buffer.alloc(64);
truncatedHeader.write('MZ'); truncatedHeader.writeUInt32LE(128, 60);
const malformed = await sample('truncated-header.exe', truncatedHeader);

async function inspect(command, fixture, extra = {}) {
  const result = await services[command].inspect({ path: fixture.path, ...extra });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const evidence = result.value;
  assert.equal(evidence.subject.digest.sha256, sha256(fixture.bytes));
  assert.equal(evidence.operation, command);
  assert.equal(evidence.normalized_result.artifact.bytes, fixture.bytes.length);
  return evidence.normalized_result;
}

test('Go PE inline build information preserves exact bytes, module text and offsets', async () => {
  const report = await inspect('inspect_go_binary', go);
  assert.equal(report.format, 'pe'); assert.equal(report.architecture, 'amd64');
  assert.equal(report.build_info.header_offset, 512);
  assert.equal(report.build_info.encoding, 'inline');
  assert.equal(report.build_info.go_version, 'go1.23.4');
  assert.equal(report.build_info.go_version_bytes_base64, 'Z28xLjIzLjQ=');
  assert.equal(report.build_info.module_text, moduleText);
  assert.equal(report.build_info.version_location.offset, 545);
  assert.equal(report.build_info.version_location.bytes, 8);
});
test('Rust ELF zlib dependency graph recovers packages, edge, root and byte bounds', async () => {
  const report = await inspect('inspect_rust_binary', rust);
  assert.equal(report.format, 'elf'); assert.equal(report.architecture, 'amd64');
  const metadata = report.auditable_metadata;
  assert.equal(metadata.section_name, '.dep-v0'); assert.equal(metadata.file_offset, 512);
  assert.equal(metadata.compressed_bytes, compressed.length);
  assert.equal(metadata.uncompressed_bytes, dependencyJson.length);
  assert.equal(metadata.root_package_index, 0);
  assert.deepEqual(metadata.dependency_edges, [{ from_index: 0, to_index: 1 }]);
  assert.deepEqual(metadata.packages.map(pkg => [pkg.name, pkg.version]), [['demo', '1.2.3'], ['serde', '1.0.0']]);
  assert.deepEqual(metadata.cyclic_dependency_indices, []);
});
test('PE resource tree maps numeric identities and independently known payload digest', async () => {
  const report = await inspect('inspect_pe_resources', resources);
  assert.equal(report.format, 'pe32-plus'); assert.equal(report.machine, 0x8664);
  assert.deepEqual(report.coverage, { status: 'complete', examined_entries: 3, resources: 1 });
  const resource = report.resources[0];
  assert.deepEqual([resource.type.id, resource.name.id, resource.language.id], [10, 7, 1033]);
  assert.equal(resource.code_page, 65001);
  assert.deepEqual(resource.payload.location, { offset: 608, bytes: 5 });
  assert.equal(resource.payload.sha256, '3733cd977ff8eb18b987357e22ced99f46097f31ecb239e878ae63760e83e4d5');
});
test('Electron PE sentinel decodes enabled, disabled and removed fuse bytes', async () => {
  const report = await inspect('inspect_electron_fuses', electron);
  const wire = report.slices[0].sentinels[0];
  assert.equal(wire.sentinel_offset, 512); assert.equal(wire.wire_version, 1);
  assert.equal(wire.declared_length, 6); assert.equal(wire.complete, true);
  assert.deepEqual(wire.fuses.map(fuse => fuse.state), ['enabled', 'disabled', 'removed', 'enabled', 'enabled', 'disabled']);
  assert.equal(wire.fuses[0].name, 'RunAsNode');
});

for (const command of Object.keys(services)) {
  test(`${command}: schema, absolute path and cancellation failures retain typed errors`, async () => {
    assert.equal(inputSchemas[command].properties.path.type, 'string');
    for (const input of [{}, { path: 123 }, { path: 'relative.exe' }, { path: absent.path, bogus: true }]) {
      const result = await services[command].inspect(input);
      assert.equal(result.ok, false); assert.equal(result.error._tag, 'AnalysisInputError');
    }
    const controller = new AbortController(); controller.abort();
    const result = await services[command].inspect({ path: absent.path }, { signal: controller.signal });
    assert.equal(result.ok, false); assert.equal(result.error._tag, 'AnalysisCancelledError');
  });
}
test('absence remains successful observed metadata, with no invented values', async () => {
  assert.equal((await inspect('inspect_go_binary', absent)).build_info, null);
  assert.equal((await inspect('inspect_rust_binary', absent)).auditable_metadata, null);
  assert.equal((await inspect('inspect_pe_resources', absent)).directory, null);
  const fuse = await inspect('inspect_electron_fuses', absent);
  assert.equal(fuse.slices[0].sentinel_count, 0);
  assert.ok(fuse.limitations.some(value => value.includes('unknown')));
});
test('malformed Go inline length, Rust zlib and PE resource RVA fail instead of partial success', async () => {
  const goBytes = Buffer.from(go.bytes); goBytes[544] = 127;
  const peBytes = Buffer.from(resources.bytes); peBytes.writeUInt32LE(0xffffff00, 584);
  for (const [command, name, bytes] of [
    ['inspect_go_binary', 'bad-go.exe', goBytes],
    ['inspect_rust_binary', 'bad-rust.elf', rustElf(Buffer.from('not zlib'))],
    ['inspect_pe_resources', 'bad-resource.exe', peBytes],
  ]) {
    const fixture = await sample(name, bytes);
    const result = await services[command].inspect({ path: fixture.path });
    assert.equal(result.ok, false); assert.equal(result.error._tag, 'AnalysisInputError');
  }
});
test('truncated Electron wire retains observed bytes and explicitly marks incomplete', async () => {
  const fixture = await sample('truncated-electron.exe', pe('.rdata', Buffer.concat([sentinel, Buffer.from([1, 6, 49])]), 0x40000040));
  const report = await inspect('inspect_electron_fuses', fixture);
  assert.equal(report.slices[0].sentinels[0].complete, false);
  assert.equal(report.slices[0].sentinels[0].fuses.length, 1);
  assert.ok(report.limitations.some(value => value.includes('truncated')));
});
test('all four commands reject a truncated declared PE header', async () => {
  for (const command of Object.keys(services)) {
    const result = await services[command].inspect({ path: malformed.path });
    assert.equal(result.ok, false, command);
    // The pinned fuse reader identifies container signatures before parsing;
    // without a PE signature it deliberately reports an unsupported target.
    assert.equal(result.error._tag, command === 'inspect_electron_fuses' ? 'AnalysisUnsupportedTargetError' : 'AnalysisInputError', command);
  }
});
test('PE entry budget fails completely when only two of three entries fit', async () => {
  const result = await services.inspect_pe_resources.inspect({ path: resources.path, max_entries: 2 });
  assert.equal(result.ok, false); assert.equal(result.error._tag, 'AnalysisResourceConstraintError');
});

test('optional REA 6.5.0 direct Service/Provider differential comparison', { skip: !process.env.REA_UPSTREAM_ROOT }, async () => {
  const root = process.env.REA_UPSTREAM_ROOT;
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'rea-agents'); assert.equal(pkg.version, '6.5.0');
  const cases = [
    ['inspect_go_binary', 'GoBinaryService', 'application/go/GoBinaryService', 'GoBinaryProvider', 'go/GoBinaryProvider', go],
    ['inspect_rust_binary', 'RustBinaryService', 'application/rust/RustBinaryService', 'RustBinaryProvider', 'rust/RustBinaryProvider', rust],
    ['inspect_pe_resources', 'PeResourcesService', 'application/binaryDiagnostics/PeResourcesService', 'PeResourcesProvider', 'native/pe/PeResourcesProvider', resources],
    ['inspect_electron_fuses', 'ElectronFuseService', 'application/electron/ElectronFuseService', 'ElectronFuseProvider', 'electron/ElectronFuseProvider', electron],
  ];
  for (const [command, serviceName, servicePath, providerName, providerPath, fixture] of cases) {
    const serviceModule = await import(pathToFileURL(join(root, 'dist', `${servicePath}.js`)));
    const providerModule = await import(pathToFileURL(join(root, 'dist', `${providerPath}.js`)));
    const upstream = new serviceModule[serviceName](new providerModule[providerName]());
    try {
      for (const selected of [fixture, absent]) {
        const input = { path: selected.path };
        const local = await services[command].inspect(input);
        const original = await upstream.inspect(input);
        assert.equal(local.ok, true); assert.equal(original.ok, true);
        assert.deepEqual(local.value.normalized_result, original.value.normalized_result);
        assert.equal(local.value.evidence_id, original.value.evidence_id);
      }
      const input = { path: malformed.path };
      const localFailure = await services[command].inspect(input);
      const originalFailure = await upstream.inspect(input);
      assert.equal(localFailure.ok, false); assert.equal(originalFailure.ok, false);
      assert.equal(localFailure.error._tag, originalFailure.error._tag);
      assert.equal(localFailure.error.message, originalFailure.error.message);
      assert.deepEqual(localFailure.error.issues, originalFailure.error.issues);
    } finally { await upstream.close?.(); }
  }
});
