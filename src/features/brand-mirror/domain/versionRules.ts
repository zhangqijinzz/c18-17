import type { BrandTokens, SavedVersion } from '../models/brandMirrorModels'

/**
 * 版本默认名称：Version A、Version B …… 序号超过 26 后回退为数字（Version 27）。
 * 序号来自单调递增计数器，删除版本不回退，因此默认名称永不复用。
 */
export function defaultVersionLabel(sequence: number): string {
  return `Version ${sequence <= 26 ? String.fromCharCode(64 + sequence) : sequence}`
}

/** 名称按 trim 后判重，空名称不允许 */
export function normalizeVersionLabel(label: string): string {
  return label.trim()
}

export function isLabelTaken(label: string, versions: SavedVersion[], excludeVersionId?: string): boolean {
  const normalized = normalizeVersionLabel(label)
  if (!normalized) return true
  return versions.some((version) => version.id !== excludeVersionId && version.label === normalized)
}

/**
 * 在期望名称冲突时自动追加数字后缀，直到唯一。
 * 例如「方案一」已存在时，建议「方案一 2」。
 */
export function uniqueLabel(desired: string, versions: SavedVersion[], excludeVersionId?: string): string {
  const base = normalizeVersionLabel(desired)
  if (!base) {
    // 空名称兜底：取下一个可用默认名
    const nextSequence = versions.reduce((max, version) => Math.max(max, version.sequence), 0) + 1
    return uniqueLabel(defaultVersionLabel(nextSequence), versions, excludeVersionId)
  }
  if (!isLabelTaken(base, versions, excludeVersionId)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`
    if (!isLabelTaken(candidate, versions, excludeVersionId)) return candidate
  }
}

/** 两个版本的令牌是否完全一致，用于判断当前工作区对应哪个历史版本 */
export function tokensEqual(first: BrandTokens, second: BrandTokens): boolean {
  return (
    first.primary === second.primary &&
    first.secondary === second.secondary &&
    scalesEqual(first.radiusScale, second.radiusScale) &&
    scalesEqual(first.spacingScale, second.spacingScale) &&
    scalesEqual(first.typeScale, second.typeScale)
  )
}

function scalesEqual(first: number[], second: number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

/**
 * 计算对比视图应展示的两个版本：
 * - 优先使用用户选择的两个版本（含已删除的悬空选择时视为未选）；
 * - 缺失的槽位按保存时间倒序取最近版本补齐；
 * - 两个槽位指向同一版本时，保留第一选择并为第二槽位另取最近版本；
 * - 不足两个版本时槽位为 null。
 */
export function resolveComparePair(
  versions: SavedVersion[],
  selected: [string | null, string | null],
): [SavedVersion | null, SavedVersion | null] {
  const ordered = [...versions].sort(bySequenceDesc)
  const findById = (id: string | null): SavedVersion | null => (id ? versions.find((version) => version.id === id) ?? null : null)
  const fallback = (takenIds: Array<string | undefined>): SavedVersion | null =>
    ordered.find((version) => !takenIds.includes(version.id)) ?? null

  let first = findById(selected[0])
  let second = findById(selected[1])
  if (first && second && first.id === second.id) {
    second = fallback([first.id])
  }
  if (!first) first = fallback([second?.id])
  if (!second) second = fallback([first?.id])
  return [first, second]
}

/** 删除指定版本后，清掉对比选择中的悬空引用 */
export function pruneCompareSelection(
  selected: [string | null, string | null],
  remainingVersions: SavedVersion[],
): [string | null, string | null] {
  const ids = new Set(remainingVersions.map((version) => version.id))
  return [
    selected[0] && ids.has(selected[0]) ? selected[0] : null,
    selected[1] && ids.has(selected[1]) ? selected[1] : null,
  ]
}

export function bySequenceDesc(first: SavedVersion, second: SavedVersion): number {
  return second.sequence - first.sequence
}
