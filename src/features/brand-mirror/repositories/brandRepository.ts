import type { BrandDocument, SavedVersion } from '../models/brandMirrorModels'
import { clampTokenValues, validateTokens } from '../domain/brandRules'
import type { StorageService } from '../services/storageService'

export interface BrandRepository {
  load(): BrandDocument | null
  save(document: BrandDocument): void
}

export class LocalBrandRepository implements BrandRepository {
  constructor(private readonly storage: StorageService) {}

  load(): BrandDocument | null {
    const raw = this.storage.read()
    if (!raw) return null
    try {
      const candidate: unknown = JSON.parse(raw)
      if (!isDocument(candidate)) return null
      return migrate(candidate)
    } catch {
      return null
    }
  }

  save(document: BrandDocument): void {
    const validationError = validateTokens(document.tokens)
    if (validationError) throw new Error(validationError)
    this.storage.write(JSON.stringify(document))
  }
}

/**
 * 旧文档没有 sequence / versionSequence：
 * 按保存顺序补齐序号，并把计数器初始化为历史版本数；
 * 已有计数器时（删过版本，计数器大于版本数）保持不回退。
 */
function migrate(candidate: BrandDocument): BrandDocument {
  const versions: SavedVersion[] = candidate.versions.map((version, index) =>
    typeof version.sequence === 'number' && Number.isFinite(version.sequence)
      ? version
      : { ...version, sequence: index + 1 },
  )
  const maxSequence = versions.reduce((max, version) => Math.max(max, version.sequence), 0)
  const versionSequence = Math.max(
    typeof candidate.versionSequence === 'number' ? candidate.versionSequence : versions.length,
    maxSequence,
  )
  return {
    ...candidate,
    tokens: clampTokenValues(candidate.tokens),
    versions,
    versionSequence,
  }
}

function isDocument(value: unknown): value is BrandDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrandDocument>
  return candidate.version === 1 && !!candidate.tokens && Array.isArray(candidate.versions) && typeof candidate.theme === 'string'
}
