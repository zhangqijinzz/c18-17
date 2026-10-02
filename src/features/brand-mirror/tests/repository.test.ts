import { describe, expect, it } from 'vitest'
import { LocalBrandRepository } from '../repositories/brandRepository'
import type { StorageService } from '../services/storageService'
import { INITIAL_TOKENS } from '../models/brandMirrorModels'

class MemoryStorage implements StorageService {
  value: string | null = null
  read(): string | null { return this.value }
  write(next: string): void { this.value = next }
}

describe('LocalBrandRepository migration', () => {
  it('backfills sequence and versionSequence for documents saved before versioning', () => {
    const storage = new MemoryStorage()
    storage.value = JSON.stringify({
      version: 1,
      theme: 'studio',
      tokens: INITIAL_TOKENS,
      versions: [
        { id: 'old-a', label: 'Version A', tokens: INITIAL_TOKENS, createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'old-b', label: 'Version B', tokens: INITIAL_TOKENS, createdAt: '2024-01-02T00:00:00.000Z' },
      ],
    })
    const document = new LocalBrandRepository(storage).load()
    expect(document?.versions.map((version) => version.sequence)).toEqual([1, 2])
    expect(document?.versionSequence).toBe(2)
  })

  it('never rolls the counter back below the highest sequence after deletions', () => {
    const storage = new MemoryStorage()
    storage.value = JSON.stringify({
      version: 1,
      theme: 'studio',
      tokens: INITIAL_TOKENS,
      versionSequence: 5,
      versions: [
        { id: 'v2', sequence: 2, label: 'Version B', tokens: INITIAL_TOKENS, createdAt: '2024-01-02T00:00:00.000Z' },
        { id: 'v5', sequence: 5, label: 'Version E', tokens: INITIAL_TOKENS, createdAt: '2024-01-05T00:00:00.000Z' },
      ],
    })
    const document = new LocalBrandRepository(storage).load()
    expect(document?.versionSequence).toBe(5)
  })

  it('returns null for unreadable or malformed documents', () => {
    const storage = new MemoryStorage()
    storage.value = '{ not json'
    expect(new LocalBrandRepository(storage).load()).toBeNull()
    storage.value = JSON.stringify({ version: 9, tokens: null, versions: [], theme: 'studio' })
    expect(new LocalBrandRepository(storage).load()).toBeNull()
  })

  it('round-trips the counter through save and load', () => {
    const storage = new MemoryStorage()
    const repository = new LocalBrandRepository(storage)
    repository.save({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [], versionSequence: 7 })
    expect(repository.load()?.versionSequence).toBe(7)
  })
})
