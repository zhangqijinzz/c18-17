import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import type { BrandDocument, SavedVersion } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { buildBrandGuidelinesMarkdown, type BrandGuidelinesExporter } from '../services/exportService'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  shouldFail = false
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void { if (this.shouldFail) throw new Error('offline'); this.document = document }
}

class MemoryExporter implements BrandGuidelinesExporter {
  received: string | null = null
  export(snapshot: Parameters<BrandGuidelinesExporter['export']>[0]): void { this.received = buildBrandGuidelinesMarkdown(snapshot) }
}

function makeVersion(label: string, primary: string, id?: string): SavedVersion {
  return { id: id ?? `legacy-${label}`, label, createdAt: '2024-01-01T00:00:00.000Z', tokens: { primary, secondary: '#24324A', radiusScale: [8, 12, 18, 28], spacingScale: [4, 8, 12, 20, 32], typeScale: [12, 14, 16, 20, 28, 40] } }
}

describe('BrandMirrorViewModel', () => {
  it('initializes, updates tokens and persists the latest state', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateScale('typeScale', 0, 18)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(18)
    expect(repository.document?.tokens.primary).toBe('#123456')
  })

  it('saves two versions and enters comparison mode', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version A', 'Version B'])
    expect(viewModel.getSnapshot().compareMode).toBe(true)
  })

  it('keeps editing usable when persistence fails', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    repository.shouldFail = true
    viewModel.updateColor('secondary', '#FFFFFF')
    expect(viewModel.getSnapshot().status).toBe('error')
    expect(viewModel.getSnapshot().tokens.secondary).toBe('#FFFFFF')
  })

  it('recovers a previously persisted document on initialization', () => {
    const repository = new MemoryRepository()
    repository.document = { version: 1, theme: 'night', tokens: { primary: '#A98BFF', secondary: '#191829', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38] }, versions: [], versionSequence: 0 }
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    expect(viewModel.getSnapshot().theme).toBe('night')
    expect(viewModel.getSnapshot().message).toContain('恢复')
  })

  it('exports the current token system as brand guidelines', () => {
    const repository = new MemoryRepository()
    const exporter = new MemoryExporter()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.exportBrandGuidelines()
    expect(exporter.received).toContain('# BrandMirror 品牌规范')
    expect(exporter.received).toContain('`primary`')
    expect(viewModel.getSnapshot().message).toContain('导出')
  })

  it('keeps auto names moving forward and never reuses a deleted letter', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.saveVersion()
    const [versionA, versionB] = viewModel.getSnapshot().versions
    viewModel.deleteVersion(versionA.id)
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version B'])
    viewModel.saveVersion()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version B', 'Version C'])
    expect(repository.document?.versionSequence).toBe(3)
    expect(versionB.id).not.toBe(versionA.id)
  })

  it('renames a version and rejects empty, too long or duplicated names', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.saveVersion()
    const first = viewModel.getSnapshot().versions[0]
    expect(viewModel.renameVersion(first.id, '  首页改版终稿  ')).toBe(true)
    expect(viewModel.getSnapshot().versions[0].label).toBe('首页改版终稿')

    expect(viewModel.renameVersion(first.id, 'Version B')).toBe(false)
    expect(viewModel.getSnapshot().status).toBe('error')
    expect(viewModel.getSnapshot().versions[0].label).toBe('首页改版终稿')
    expect(viewModel.renameVersion(first.id, '   ')).toBe(false)
    expect(viewModel.renameVersion(first.id, 'a'.repeat(25))).toBe(false)
  })

  it('skips a custom name when it would collide with the next auto name', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.renameVersion(viewModel.getSnapshot().versions[0].id, 'Version B')
    viewModel.saveVersion()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version B', 'Version C'])
  })

  it('restores the workspace tokens from a historical version and marks it active', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    const first = viewModel.getSnapshot().versions[0]
    viewModel.restoreVersion(first.id)
    const snapshot = viewModel.getSnapshot()
    expect(snapshot.tokens.primary).toBe(first.tokens.primary)
    expect(snapshot.activeVersionId).toBe(first.id)
    expect(snapshot.dirty).toBe(false)
    expect(snapshot.message).toContain(first.label)
    expect(repository.document?.tokens.primary).toBe(first.tokens.primary)

    viewModel.updateColor('primary', '#ABCDEF')
    expect(viewModel.getSnapshot().dirty).toBe(true)
  })

  it('updates active mark, compare selection and export list after deletion', () => {
    const repository = new MemoryRepository()
    const exporter = new MemoryExporter()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.saveVersion()
    viewModel.saveVersion()
    viewModel.toggleCompare()
    const [a, b, c] = viewModel.getSnapshot().versions
    expect(viewModel.getSnapshot().compareVersionIds).toEqual([b.id, c.id])

    viewModel.deleteVersion(b.id)
    const snapshot = viewModel.getSnapshot()
    expect(snapshot.compareVersionIds).toEqual([a.id, c.id])
    expect(snapshot.versions.map((version) => version.id)).not.toContain(b.id)
    expect(snapshot.activeVersionId).toBe(c.id)

    viewModel.exportBrandGuidelines()
    expect(exporter.received).not.toContain(b.label)
    expect(exporter.received).toContain(c.label)
    expect(exporter.received).toContain('当前工作区版本')
  })

  it('marks restored versions as current in the export list', () => {
    const repository = new MemoryRepository()
    const exporter = new MemoryExporter()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    const first = viewModel.getSnapshot().versions[0]
    viewModel.restoreVersion(first.id)
    viewModel.exportBrandGuidelines()
    const currentLine = exporter.received?.split('\n').find((line) => line.includes(first.label))
    expect(currentLine).toContain('当前工作区版本')
  })

  it('lets the user pick any two versions for comparison and exits when one is deleted', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.saveVersion()
    viewModel.saveVersion()
    const [a, b, c] = viewModel.getSnapshot().versions
    viewModel.setCompareSlot(0, a.id)
    viewModel.setCompareSlot(1, c.id)
    expect(viewModel.getSnapshot().compareVersionIds).toEqual([a.id, c.id])
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().compareMode).toBe(true)
    viewModel.deleteVersion(a.id)
    expect(viewModel.getSnapshot().compareMode).toBe(false)
    expect(viewModel.getSnapshot().compareVersionIds).toEqual([b.id, c.id])
    void b
  })

  it('migrates documents written before versionSequence existed', () => {
    const repository = new MemoryRepository()
    const legacy = {
      version: 1 as const,
      theme: 'studio' as const,
      tokens: { primary: '#F15A47', secondary: '#24324A', radiusScale: [8, 12, 18, 28], spacingScale: [4, 8, 12, 20, 32], typeScale: [12, 14, 16, 20, 28, 40] },
      versions: [makeVersion('Version A', '#111111'), makeVersion('Version B', '#222222')],
    }
    repository.document = legacy as unknown as BrandDocument
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version A', 'Version B', 'Version C'])
  })
})
