import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import { allocateNextVersion, normalizeDocument, refillCompareIds, sameTokens, validateVersionName } from '../domain/versioning'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import { INITIAL_TOKENS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type SavedVersion } from '../models/brandMirrorModels'

type Listener = () => void

interface ViewState {
  tokens: BrandDocument['tokens']
  theme: BrandTheme
  versions: SavedVersion[]
  versionSequence: number
  compareMode: boolean
  compareVersionIds: string[]
  activeVersionId: string | null
}

export class BrandMirrorViewModel {
  private snapshot: BrandMirrorSnapshot = this.compose({ ...this.initialDocument(), compareMode: false, compareVersionIds: [], activeVersionId: null })
  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter

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
      this.snapshot = this.compose(this.viewStateFromDocument(normalizeDocument(stored)), '已恢复最近一次工作状态')
    } else {
      const state: ViewState = { ...this.initialDocument(), compareMode: false, compareVersionIds: [], activeVersionId: null }
      this.snapshot = this.compose(state, '从 Studio warm 开始探索')
    }
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    this.commit({ tokens: themeTokens(theme), theme }, '已切换基础主题')
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    const color = normalizeColor(value)
    this.commit({ tokens: { ...this.snapshot.tokens, [field]: color } }, '令牌已更新')
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    const values = [...this.snapshot.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    this.commit({ tokens: clampTokenValues({ ...this.snapshot.tokens, [field]: values }) }, '令牌已更新')
  }

  reset(): void {
    this.commit({ tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio' }, '已恢复默认令牌')
  }

  saveVersion(): void {
    const validationError = validateTokens(this.snapshot.tokens)
    if (validationError) {
      this.snapshot = { ...this.snapshot, status: 'error', message: validationError }
      this.emit()
      return
    }
    const allocated = allocateNextVersion(this.snapshot.versionSequence, this.snapshot.versions)
    const nextVersion: SavedVersion = {
      id: allocated.id,
      label: allocated.label,
      tokens: cloneTokens(this.snapshot.tokens),
      createdAt: new Date().toISOString(),
    }
    const versions = [...this.snapshot.versions, nextVersion]
    const next: ViewState = {
      ...this.currentState(),
      versions,
      versionSequence: allocated.sequence,
      activeVersionId: nextVersion.id,
      // 保存后默认对比最新两个版本；用户显式选择只来自 setCompareSlot
      compareVersionIds: versions.slice(-2).map((version) => version.id),
    }
    this.persistState(next, `版本已保存为 ${nextVersion.label}`, 'ready')
  }

  renameVersion(id: string, label: string): boolean {
    const target = this.snapshot.versions.find((version) => version.id === id)
    if (!target) return false
    const error = validateVersionName(label, this.snapshot.versions, id)
    if (error) {
      this.snapshot = { ...this.snapshot, status: 'error', message: error }
      this.emit()
      return false
    }
    const versions = this.snapshot.versions.map((version) =>
      version.id === id ? { ...version, label: label.trim().replace(/\s+/g, ' ') } : version,
    )
    this.persistState({ ...this.currentState(), versions }, '版本已重命名', 'ready')
    return true
  }

  deleteVersion(id: string): void {
    if (!this.snapshot.versions.some((version) => version.id === id)) return
    const wasCompared = this.snapshot.compareVersionIds.includes(id)
    const versions = this.snapshot.versions.filter((version) => version.id !== id)
    const activeVersionId = this.snapshot.activeVersionId === id ? null : this.snapshot.activeVersionId
    const next: ViewState = {
      ...this.currentState(),
      versions,
      activeVersionId,
      // 被删除的版本正在对比时退出对比视图，避免静默换卡看错对象
      compareMode: this.snapshot.compareMode && !wasCompared,
      compareVersionIds: refillCompareIds(this.snapshot.compareVersionIds, versions),
    }
    this.persistState(next, versions.length === 0 ? '版本已删除，当前没有保存的版本' : '版本已删除', 'ready')
  }

  restoreVersion(id: string): void {
    const target = this.snapshot.versions.find((version) => version.id === id)
    if (!target) return
    this.commit({ tokens: cloneTokens(target.tokens), activeVersionId: target.id }, `工作区已恢复为 ${target.label}`)
  }

  setCompareSlot(slot: 0 | 1, versionId: string): void {
    if (!this.snapshot.versions.some((version) => version.id === versionId)) return
    const ids = this.snapshot.compareVersionIds.length === 2 ? [...this.snapshot.compareVersionIds] : refillCompareIds(this.snapshot.compareVersionIds, this.snapshot.versions)
    ids[slot] = versionId
    if (ids[0] === ids[1]) ids[slot === 0 ? 1 : 0] = ''
    this.snapshot = this.compose({ ...this.currentState(), compareVersionIds: ids.filter(Boolean) }, this.snapshot.message || '已更新对比版本')
    this.emit()
  }

  toggleCompare(): void {
    const ready = this.snapshot.compareVersionIds.length === 2
    this.snapshot = {
      ...this.snapshot,
      compareMode: ready ? !this.snapshot.compareMode : false,
      message: ready
        ? this.snapshot.compareMode ? '已退出对比模式' : '正在对比选中的两个版本'
        : '请先从版本列表中选择两个版本',
    }
    this.emit()
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.snapshot)
      this.snapshot = { ...this.snapshot, message: '品牌规范已导出' }
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '导出失败，请稍后重试' }
    }
    this.emit()
  }

  private commit(partial: Partial<Pick<ViewState, 'tokens' | 'theme' | 'activeVersionId'>>, message: string): void {
    const state: ViewState = {
      ...this.currentState(),
      tokens: partial.tokens ?? this.snapshot.tokens,
      theme: partial.theme ?? this.snapshot.theme,
      activeVersionId: partial.activeVersionId === undefined ? this.snapshot.activeVersionId : partial.activeVersionId,
    }
    this.snapshot = this.compose(state, message, 'editing')
    this.persistCurrent()
  }

  private currentState(): ViewState {
    return {
      tokens: this.snapshot.tokens,
      theme: this.snapshot.theme,
      versions: this.snapshot.versions,
      versionSequence: this.snapshot.versionSequence,
      compareMode: this.snapshot.compareMode,
      compareVersionIds: this.snapshot.compareVersionIds,
      activeVersionId: this.snapshot.activeVersionId,
    }
  }

  private initialDocument(): Omit<BrandDocument, 'version'> {
    return { tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio', versions: [], versionSequence: 0 }
  }

  private viewStateFromDocument(document: BrandDocument): ViewState {
    const versions = document.versions
    return {
      tokens: cloneTokens(document.tokens),
      theme: document.theme,
      versions,
      versionSequence: document.versionSequence,
      compareMode: false,
      compareVersionIds: refillCompareIds([], versions),
      activeVersionId: versions[versions.length - 1]?.id ?? null,
    }
  }

  private persistCurrent(): void {
    try {
      this.repository.save(this.toDocument())
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '本地保存失败，但当前编辑仍保留在页面中' }
    }
    this.emit()
  }

  private persistState(state: ViewState, message: string, status: BrandMirrorSnapshot['status']): void {
    try {
      this.repository.save(this.documentFromState(state))
      this.snapshot = this.compose(state, message, status)
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '版本保存失败，请稍后重试' }
    }
    this.emit()
  }

  private toDocument(): BrandDocument {
    return this.documentFromState(this.currentState())
  }

  private documentFromState(state: ViewState): BrandDocument {
    return {
      version: 1,
      tokens: cloneTokens(state.tokens),
      theme: state.theme,
      versions: state.versions.map((version) => ({ ...version, tokens: cloneTokens(version.tokens) })),
      versionSequence: state.versionSequence,
    }
  }

  private compose(state: ViewState, message = '', status: BrandMirrorSnapshot['status'] = 'ready'): BrandMirrorSnapshot {
    const ratio = contrastRatio(state.tokens.primary, state.tokens.secondary)
    const active = state.versions.find((version) => version.id === state.activeVersionId) ?? null
    const dirty = active ? !sameTokens(active.tokens, state.tokens) : false
    return {
      status,
      tokens: cloneTokens(state.tokens),
      theme: state.theme,
      versions: state.versions,
      versionSequence: state.versionSequence,
      compareMode: state.compareMode && state.compareVersionIds.length === 2,
      compareVersionIds: state.compareVersionIds,
      activeVersionId: state.activeVersionId,
      dirty,
      contrastRatio: ratio,
      contrastWarning: ratio < 3,
      message,
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
