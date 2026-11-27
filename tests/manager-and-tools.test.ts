import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SandboxManager } from '../src/manager.ts'
import { isLoopbackAddress } from '../src/routes.ts'
import { sandboxTools } from '../src/tools.ts'

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-sandbox-per-test-'))
}

function manager(homeRoot: string): SandboxManager {
  return new SandboxManager({
    homeRoot,
    harnessRoot: join(homeRoot, 'missing-harness'),
    basePort: 41000,
    buildOnStart: false,
    inheritHostApi: true,
    inheritHostModel: true,
    readyTimeoutMs: 100,
    stopTimeoutMs: 100,
  })
}

test('create writes an atomic, valid state file', () => {
  const root = fixture()
  try {
    const m = manager(root)
    const state = m.create('atomic')
    const file = join(root, 'atomic', 'sandbox-state.json')
    assert.equal(existsSync(file), true)
    const { resourceUsage: _ignored, ...persisted } = state
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), persisted)
    assert.equal(readFileSync(file, 'utf8').includes('\n'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('corrupt state files are ignored rather than propagated', () => {
  const root = fixture()
  try {
    const m = manager(root)
    m.create('corrupt')
    const file = join(root, 'corrupt', 'sandbox-state.json')
    writeFileSync(file, '{ "name": "corrupt" ')
    assert.equal(m.get('corrupt'), null)
    assert.deepEqual(m.list(), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sandbox_* tools compile against the DSH 2.3 value-schema DSL', () => {
  const root = fixture()
  try {
    const m = manager(root)
    // defineTool validates schemas eagerly. If any output schema uses a
    // keyword outside the DSL (e.g. root-level `required`), this throws.
    const tools = sandboxTools(m)
    assert.equal(tools.length, 8)
    const names = tools.map(tool => (tool as unknown as { name: string }).name)
    assert.deepEqual(names, [
      'sandbox_list', 'sandbox_status', 'sandbox_start', 'sandbox_stop',
      'sandbox_destroy', 'sandbox_logs', 'sandbox_verify', 'sandbox_build',
    ])
    for (const tool of tools) {
      const schema = (tool as unknown as { output: { schema: Record<string, unknown> } }).output.schema
      assert.equal(schema.type, 'object', `${tool.name} must compile to an object output schema`)
      assert.ok('properties' in schema, `${tool.name} must compile output properties`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify uses a sanitized environment (no DEEPSEEK_API_KEY in child)', async () => {
  const root = fixture()
  try {
    const m = manager(root)
    // No harness is configured: verify must fail fast, but sanitization leaves
    // no credential leakage in logs and cleans up its temporary sandbox.
    const result = await m.verify(join(root, 'not-a-plugin'), { profileMode: 'clean' })
    assert.equal(result.result, 'failed')
    assert.equal(result.profileMode, 'clean')
    assert.equal(result.logs.includes('DEEPSEEK_API_KEY='), false)
    assert.deepEqual(m.list(), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loopback guard rejects remote and undefined peers', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('10.0.0.1'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})
