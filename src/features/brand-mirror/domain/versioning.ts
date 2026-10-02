import { clampTokenValues } from './brandRules'
import type { BrandDocument, SavedVersion } from '../models/brandMirrorModels'

export const VERSION_LABEL_MAX_LENGTH = 24

/**
 * 把单调递增序号映射为字母编号：1→A … 26→Z、27→AA、52→AZ、53→BA。
 * 序号只增不减，所以删除早期版本后，自动名字也不会被再次使用。
 */
export function versionLabel(sequence: number): string {
  let remaining = sequence
  let label = ''
  while (remaining > 0) {
    const offset = (remaining - 1) % 26
    label = String.fromCharCode(65 + offset) + label
    remaining = Math.floor((remaining - 1) / 26)
  }
  return label
}

export function normalizeVersionLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

/** 校验用户重命名：非空、不超长、与其他版本不区分大小写地唯一 */
export function validateVersionName(label: string, versions: SavedVersion[], selfId?: string): string | null {
  const normalized = normalizeVersionLabel(label)
  if (!normalized) return '请输入版本名称'
  if (normalized.length > VERSION_LABEL_MAX_LENGTH) return `版本名称不能超过 ${VERSION_LABEL_MAX_LENGTH} 个字符`
  const duplicated = versions.some((version) => version.id !== selfId && version.label.toLowerCase() === normalized.toLowerCase())
  if (duplicated) return '已存在同名版本，请换一个名称'
  return null
}

export interface NewVersionEntry {
  id: string
  label: string
  sequence: number
}

/**
 * 基于当前序号分配下一个版本的ID与名字。
 * 序号本身保证ID与自动名字永不复用；若用户已把某个版本手动改成接下来的自动名字，
 * 则继续向后顺延，避免与自定义名字撞名。
 */
export function allocateNextVersion(sequence: number, versions: SavedVersion[]): NewVersionEntry {
  const takenLabels = new Set(versions.map((version) => version.label.toLowerCase()))
  const takenIds = new Set(versions.map((version) => version.id))
  let next = sequence + 1
  let label = versionLabel(next)
  while (takenLabels.has(`version ${label}`.toLowerCase()) || takenIds.has(versionId(next))) {
    next += 1
    label = versionLabel(next)
  }
  return { id: versionId(next), label: `Version ${label}`, sequence: next }
}

export function versionId(sequence: number): string {
  return `version-${sequence}`
}

/** 旧文档迁移：补齐序号字段，按现存字母名字中最大的序号初始化 */
export function resolveInitialSequence(versions: SavedVersion[]): number {
  let max = 0
  for (const version of versions) {
    const match = /^version-(\d+)$/.exec(version.id)
    // 旧版 ID 是时间戳（超过字母序号的合法范围），不能作为序号，回退到标签字母
    if (match && Number(match[1]) <= 100000) {
      max = Math.max(max, Number(match[1]))
      continue
    }
    const labelMatch = /^version\s+([a-z]+)$/i.exec(version.label)
    if (labelMatch) max = Math.max(max, letterSequence(labelMatch[1].toUpperCase()))
  }
  return Math.max(max, versions.length)
}

/**
 * 规范化文档：无论仓储如何实现（旧版本地数据、测试替身），都保证序号字段存在，
 * 并对令牌做一次尺度钳制。
 */
export function normalizeDocument(raw: BrandDocument): BrandDocument {
  const versionSequence =
    typeof raw.versionSequence === 'number' && Number.isFinite(raw.versionSequence) && raw.versionSequence >= raw.versions.length
      ? Math.floor(raw.versionSequence)
      : resolveInitialSequence(raw.versions)
  return {
    ...raw,
    tokens: clampTokenValues(raw.tokens),
    versions: raw.versions.map((version) => ({ ...version, tokens: clampTokenValues(version.tokens) })),
    versionSequence,
  }
}

function letterSequence(label: string): number {
  let sequence = 0
  for (const char of label) {
    sequence = sequence * 26 + (char.charCodeAt(0) - 64)
  }
  return sequence
}

/** 深比较两份令牌，用于判断工作区相对某版本是否有未保存改动 */
export function sameTokens(first: SavedVersion['tokens'], second: SavedVersion['tokens']): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

/** 从现存版本里选出两个槽位的默认对比项；被删除的槽位按顺序回填最近版本 */
export function refillCompareIds(current: string[], versions: SavedVersion[]): string[] {
  const present = new Set(versions.map((version) => version.id))
  const slots: (string | null)[] = [current[0] ?? null, current[1] ?? null]
  const validSlots = slots.map((id) => (id && present.has(id) ? id : null))
  const candidates = versions.map((version) => version.id).reverse().filter((id) => !validSlots.includes(id))
  let cursor = 0
  for (let slot = 0; slot < 2; slot += 1) {
    if (!validSlots[slot]) {
      validSlots[slot] = candidates[cursor] ?? null
      cursor += 1
    }
  }
  return validSlots.filter((id): id is string => Boolean(id))
}
