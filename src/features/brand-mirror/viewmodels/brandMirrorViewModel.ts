import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import {
  defaultVersionLabel,
  isLabelTaken,
  normalizeVersionLabel,
  pruneCompareSelection,
  tokensEqual,
  uniqueLabel,
} from '../domain/versionRules'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import { INITIAL_TOKENS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type SavedVersion } from '../models/brandMirrorModels'

type Listener = () => void

function createVersionId(sequence: number): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `version-${sequence}-${Date.now().toString(36)}-${random}`
}

export class BrandMirrorViewModel {
  private snapshot: BrandMirrorSnapshot = this.makeSnapshot(
    { tokens: INITIAL_TOKENS, theme: 'studio', versions: [] },
    '',
    'loading',
    { compareMode: false, compareVersionIds: [null, null] },
  )
  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter
  /** 单调递增的版本序号，删除不回退，随文档持久化 */
  private versionSequence = 0

  constructor(repository: BrandRepository, exporter?: BrandGuidelinesExporter) {
    this.repository = repository
    this.exporter = exporter
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): BrandMirrorSnapshot {
    return this.snapshot
  }

  initialize(): void {
    const stored = this.repository.load()
    if (stored) {
      this.versionSequence = stored.versionSequence ?? maxSequence(stored.versions)
      this.snapshot = this.makeSnapshot(stored, '已恢复最近一次工作状态', 'ready', {
        compareMode: false,
        compareVersionIds: [null, null],
      })
    } else {
      this.snapshot = this.makeSnapshot(
        { tokens: INITIAL_TOKENS, theme: 'studio', versions: [] },
        '从 Studio warm 开始探索',
        'ready',
        { compareMode: false, compareVersionIds: [null, null] },
      )
    }
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    this.update({ tokens: themeTokens(theme), theme }, '已切换基础主题')
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    const color = normalizeColor(value)
    this.update({ tokens: { ...this.snapshot.tokens, [field]: color } }, '令牌已更新')
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    const values = [...this.snapshot.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    this.update({ tokens: clampTokenValues({ ...this.snapshot.tokens, [field]: values }) }, '令牌已更新')
  }

  reset(): void {
    this.update({ tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio' }, '已恢复默认令牌')
  }

  saveVersion(): void {
    const validationError = validateTokens(this.snapshot.tokens)
    if (validationError) {
      this.fail(validationError)
      return
    }
    const sequence = this.versionSequence + 1
    const versions = this.snapshot.versions
    const nextVersion: SavedVersion = {
      id: createVersionId(sequence),
      sequence,
      // 序号永不复用；若默认名与用户自定义名撞车，自动追加后缀
      label: uniqueLabel(defaultVersionLabel(sequence), versions),
      tokens: cloneTokens(this.snapshot.tokens),
      createdAt: new Date().toISOString(),
    }
    this.versionSequence = sequence
    this.persist(
      { tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions: [...versions, nextVersion] },
      `版本 ${nextVersion.label} 已保存`,
    )
  }

  renameVersion(versionId: string, label: string): void {
    const target = this.snapshot.versions.find((version) => version.id === versionId)
    if (!target) return
    const normalized = normalizeVersionLabel(label)
    if (!normalized) {
      this.fail('版本名称不能为空')
      return
    }
    if (isLabelTaken(normalized, this.snapshot.versions, versionId)) {
      this.fail('版本名称已存在，请换一个名字')
      return
    }
    const versions = this.snapshot.versions.map((version) =>
      version.id === versionId ? { ...version, label: normalized } : version,
    )
    this.persist({ tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions }, `版本已重命名为 ${normalized}`)
  }

  deleteVersion(versionId: string): void {
    const target = this.snapshot.versions.find((version) => version.id === versionId)
    if (!target) return
    const versions = this.snapshot.versions.filter((version) => version.id !== versionId)
    // 版本号只增不补，被删名称（含默认名）以后不会再出现；对比选择里的悬空引用由 makeSnapshot 清理
    this.persist(
      { tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions },
      `版本 ${target.label} 已删除`,
    )
  }

  restoreVersion(versionId: string): void {
    const target = this.snapshot.versions.find((version) => version.id === versionId)
    if (!target) return
    this.persist(
      { tokens: cloneTokens(target.tokens), theme: this.snapshot.theme, versions: this.snapshot.versions },
      `工作区已恢复为 ${target.label}`,
    )
  }

  toggleCompare(): void {
    if (this.snapshot.compareMode) {
      this.patchUi({ compareMode: false }, '已退出对比模式')
      return
    }
    if (this.snapshot.versions.length < 2) return
    this.patchUi({ compareMode: true }, '正在对比选中的两个版本')
  }

  setCompareVersion(slot: 0 | 1, versionId: string | null): void {
    const current = this.snapshot.compareVersionIds
    const compareVersionIds: [string | null, string | null] =
      slot === 0 ? [versionId, current[1]] : [current[0], versionId]
    const distinct = compareVersionIds[0] && compareVersionIds[1] && compareVersionIds[0] !== compareVersionIds[1]
    this.patchUi(
      { compareVersionIds, compareMode: distinct ? true : this.snapshot.compareMode },
      distinct ? '正在对比选中的两个版本' : '请再选择一个版本进行对比',
    )
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.snapshot)
      this.patchUi({}, '品牌规范已导出')
    } catch {
      this.fail('导出失败，请稍后重试')
    }
  }

  private update(partial: Partial<Pick<BrandDocument, 'tokens' | 'theme'>>, message: string): void {
    const tokens = partial.tokens ?? this.snapshot.tokens
    this.snapshot = this.makeSnapshot(
      { tokens, theme: partial.theme ?? this.snapshot.theme, versions: this.snapshot.versions },
      message,
      'editing',
    )
    this.persistCurrent()
  }

  private persistCurrent(): void {
    try {
      this.repository.save(this.toDocument())
    } catch {
      this.fail('本地保存失败，但当前编辑仍保留在页面中')
      return
    }
    this.emit()
  }

  private persist(
    document: Omit<BrandDocument, 'version' | 'versionSequence'>,
    message: string,
    status: BrandMirrorSnapshot['status'] = 'ready',
    ui?: { compareMode?: boolean; compareVersionIds?: BrandMirrorSnapshot['compareVersionIds'] },
  ): void {
    try {
      this.repository.save({ version: 1, versionSequence: this.versionSequence, ...document })
      this.snapshot = this.makeSnapshot(document, message, status, ui)
    } catch {
      this.fail('版本保存失败，请稍后重试')
      return
    }
    this.emit()
  }

  private patchUi(ui: Partial<Pick<BrandMirrorSnapshot, 'compareMode' | 'compareVersionIds'>>, message: string): void {
    this.snapshot = this.makeSnapshot(
      { tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions: this.snapshot.versions },
      message,
      this.snapshot.status === 'error' ? 'ready' : this.snapshot.status,
      {
        compareMode: ui.compareMode ?? this.snapshot.compareMode,
        compareVersionIds: ui.compareVersionIds ?? this.snapshot.compareVersionIds,
      },
    )
    this.emit()
  }

  private fail(message: string): void {
    this.snapshot = { ...this.snapshot, status: 'error', message }
    this.emit()
  }

  private toDocument(): BrandDocument {
    return {
      version: 1,
      tokens: this.snapshot.tokens,
      theme: this.snapshot.theme,
      versions: this.snapshot.versions,
      versionSequence: this.versionSequence,
    }
  }

  private makeSnapshot(
    document: Omit<BrandDocument, 'version' | 'versionSequence'>,
    message = '',
    status: BrandMirrorSnapshot['status'] = 'ready',
    ui?: { compareMode?: boolean; compareVersionIds?: BrandMirrorSnapshot['compareVersionIds'] },
  ): BrandMirrorSnapshot {
    const ratio = contrastRatio(document.tokens.primary, document.tokens.secondary)
    const compareVersionIds = pruneCompareSelection(
      ui?.compareVersionIds ?? this.snapshot.compareVersionIds,
      document.versions,
    )
    const requestedCompare = ui?.compareMode ?? this.snapshot.compareMode
    const hasTwoVersions = document.versions.length >= 2
    const activeVersion = document.versions.find((version) => tokensEqual(version.tokens, document.tokens))
    return {
      status,
      tokens: cloneTokens(document.tokens),
      theme: document.theme,
      versions: document.versions,
      compareMode: requestedCompare && hasTwoVersions,
      compareVersionIds,
      activeVersionId: activeVersion?.id ?? null,
      contrastRatio: ratio,
      contrastWarning: ratio < 3,
      message,
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}

function maxSequence(versions: SavedVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.sequence ?? 0), 0)
}
