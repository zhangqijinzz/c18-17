import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import { INITIAL_TOKENS, type BrandDocument } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { buildBrandGuidelinesMarkdown, type BrandGuidelinesExporter } from '../services/exportService'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  shouldFail = false
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void {
    if (this.shouldFail) throw new Error('offline')
    // 深拷贝模拟真实存储，避免测试误以为快照与存储共享引用
    this.document = JSON.parse(JSON.stringify(document)) as BrandDocument
  }
}

class MemoryExporter implements BrandGuidelinesExporter {
  received: string | null = null
  export(snapshot: Parameters<BrandGuidelinesExporter['export']>[0]): void { this.received = buildBrandGuidelinesMarkdown(snapshot) }
}

function createViewModel(): { repository: MemoryRepository; viewModel: BrandMirrorViewModel } {
  const repository = new MemoryRepository()
  const viewModel = new BrandMirrorViewModel(repository)
  viewModel.initialize()
  return { repository, viewModel }
}

describe('BrandMirrorViewModel', () => {
  it('initializes, updates tokens and persists the latest state', () => {
    const { repository, viewModel } = createViewModel()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateScale('typeScale', 0, 18)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(18)
    expect(repository.document?.tokens.primary).toBe('#123456')
  })

  it('saves two versions and enters comparison mode', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version A', 'Version B'])
    expect(viewModel.getSnapshot().compareMode).toBe(true)
  })

  it('keeps editing usable when persistence fails', () => {
    const { repository, viewModel } = createViewModel()
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
    const exporter = new MemoryExporter()
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.exportBrandGuidelines()
    expect(exporter.received).toContain('# BrandMirror 品牌规范')
    expect(exporter.received).toContain('`primary`')
    expect(viewModel.getSnapshot().message).toContain('导出')
  })

  it('renames a version with a unique trimmed label and rejects empty or duplicate names', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.renameVersion(viewModel.getSnapshot().versions[0].id, '  首页方案  ')
    expect(viewModel.getSnapshot().versions[0].label).toBe('首页方案')

    viewModel.renameVersion(viewModel.getSnapshot().versions[1].id, '首页方案')
    expect(viewModel.getSnapshot().status).toBe('error')
    expect(viewModel.getSnapshot().message).toContain('已存在')
    expect(viewModel.getSnapshot().versions[1].label).toBe('Version B')

    viewModel.renameVersion(viewModel.getSnapshot().versions[1].id, '   ')
    expect(viewModel.getSnapshot().message).toContain('不能为空')
  })

  it('deletes an early trial version and never reuses its name or sequence', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion() // Version A（早期试错）
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion() // Version B
    viewModel.updateColor('primary', '#A98BFF')
    viewModel.saveVersion() // Version C
    const versionA = viewModel.getSnapshot().versions[0]
    viewModel.deleteVersion(versionA.id)

    const labels = viewModel.getSnapshot().versions.map((version) => version.label)
    expect(labels).toEqual(['Version B', 'Version C'])
    expect(viewModel.getSnapshot().versions.some((version) => version.id === versionA.id)).toBe(false)

    // 再保存一个版本：计数器只增不补，得到 Version D 而不是 Version A
    viewModel.updateColor('secondary', '#191829')
    viewModel.saveVersion()
    const allVersions = viewModel.getSnapshot().versions
    expect(allVersions[allVersions.length - 1].label).toBe('Version D')
    expect(allVersions[allVersions.length - 1].sequence).toBe(4)
  })

  it('restores the workspace to any historical version and marks it active everywhere', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion() // Version A，主色为初始色
    const versionA = viewModel.getSnapshot().versions[0]
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion() // Version B
    expect(viewModel.getSnapshot().tokens.primary).toBe('#238B73')
    expect(viewModel.getSnapshot().activeVersionId).not.toBe(versionA.id)

    viewModel.restoreVersion(versionA.id)
    expect(viewModel.getSnapshot().tokens.primary).toBe(INITIAL_TOKENS.primary)
    expect(viewModel.getSnapshot().activeVersionId).toBe(versionA.id)
    // 恢复不新增版本
    expect(viewModel.getSnapshot().versions).toHaveLength(2)
    expect(viewModel.getSnapshot().message).toContain('Version A')
  })

  it('updates compare selection when the selected version is deleted', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#A98BFF')
    viewModel.saveVersion()
    const [a, b, c] = viewModel.getSnapshot().versions
    viewModel.setCompareVersion(0, a.id)
    viewModel.setCompareVersion(1, c.id)
    expect(viewModel.getSnapshot().compareVersionIds).toEqual([a.id, c.id])
    expect(viewModel.getSnapshot().compareMode).toBe(true)

    viewModel.deleteVersion(a.id)
    expect(viewModel.getSnapshot().compareVersionIds).toEqual([null, c.id])
    // 悬空槽位回退到最近的可用版本 B
    expect(viewModel.getSnapshot().versions.map((v) => v.id)).toEqual([b.id, c.id])
  })

  it('marks the active version in the export checklist and removes deleted versions from it', () => {
    const exporter = new MemoryExporter()
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    const [a] = viewModel.getSnapshot().versions
    viewModel.restoreVersion(a.id)
    viewModel.exportBrandGuidelines()
    const lines = exporter.received?.split('\n') ?? []
    const lineA = lines.find((line) => line.startsWith('- Version A'))
    expect(lineA).toContain('工作区当前版本')

    viewModel.deleteVersion(a.id)
    viewModel.exportBrandGuidelines()
    expect(exporter.received).not.toContain('Version A')
    expect(exporter.received).toContain('Version B')
  })

  it('avoids default-name collisions when a custom rename already used the next letter', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion() // Version A
    viewModel.renameVersion(viewModel.getSnapshot().versions[0].id, 'Version B')
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion() // 默认名 Version B 冲突，自动变为 Version B 2
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version B', 'Version B 2'])
  })
})
