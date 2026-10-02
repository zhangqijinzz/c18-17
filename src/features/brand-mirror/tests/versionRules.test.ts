import { describe, expect, it } from 'vitest'
import {
  bySequenceDesc,
  defaultVersionLabel,
  isLabelTaken,
  pruneCompareSelection,
  resolveComparePair,
  tokensEqual,
  uniqueLabel,
} from '../domain/versionRules'
import { INITIAL_TOKENS, type SavedVersion } from '../models/brandMirrorModels'

function version(id: string, sequence: number, label?: string): SavedVersion {
  return {
    id,
    sequence,
    label: label ?? defaultVersionLabel(sequence),
    tokens: { ...INITIAL_TOKENS, primary: `#${sequence}00000`.slice(0, 7), radiusScale: [...INITIAL_TOKENS.radiusScale], spacingScale: [...INITIAL_TOKENS.spacingScale], typeScale: [...INITIAL_TOKENS.typeScale] },
    createdAt: `2024-01-0${sequence}T00:00:00.000Z`,
  }
}

describe('version rules', () => {
  it('generates letter labels for sequences 1-26 and numbers beyond', () => {
    expect(defaultVersionLabel(1)).toBe('Version A')
    expect(defaultVersionLabel(26)).toBe('Version Z')
    expect(defaultVersionLabel(27)).toBe('Version 27')
  })

  it('detects duplicate labels case-sensitively after trim and can exclude self', () => {
    const versions = [version('v1', 1)]
    expect(isLabelTaken('  Version A  ', versions)).toBe(true)
    expect(isLabelTaken('Version A', versions, 'v1')).toBe(false)
    expect(isLabelTaken('  ', versions)).toBe(true)
    expect(isLabelTaken('Version B', versions)).toBe(false)
  })

  it('appends numeric suffixes when the desired label is taken', () => {
    const versions = [version('v1', 1, '终稿')]
    expect(uniqueLabel('终稿', versions)).toBe('终稿 2')
    const more = [...versions, version('v2', 2, '终稿 2')]
    expect(uniqueLabel('终稿', more)).toBe('终稿 3')
    expect(uniqueLabel('新名字', versions)).toBe('新名字')
  })

  it('falls back to the next default label when given an empty name', () => {
    const versions = [version('v1', 1)]
    expect(uniqueLabel('   ', versions)).toBe('Version B')
  })

  it('compares tokens structurally', () => {
    expect(tokensEqual({ ...INITIAL_TOKENS }, { ...INITIAL_TOKENS, typeScale: [...INITIAL_TOKENS.typeScale] })).toBe(true)
    expect(tokensEqual(INITIAL_TOKENS, { ...INITIAL_TOKENS, primary: '#123456' })).toBe(false)
  })

  it('sorts by descending sequence', () => {
    expect([version('a', 1), version('b', 3), version('c', 2)].sort(bySequenceDesc).map((v) => v.id)).toEqual(['b', 'c', 'a'])
  })

  it('resolves the compare pair from explicit selections and fills missing slots with recent versions', () => {
    const versions = [version('a', 1), version('b', 2), version('c', 3)]
    const [first, second] = resolveComparePair(versions, [null, null])
    expect(first?.id).toBe('c')
    expect(second?.id).toBe('b')

    const [pickedFirst, pickedSecond] = resolveComparePair(versions, ['a', 'c'])
    expect(pickedFirst?.id).toBe('a')
    expect(pickedSecond?.id).toBe('c')
  })

  it('dedupes when both compare slots select the same version', () => {
    const versions = [version('a', 1), version('b', 2), version('c', 3)]
    const [first, second] = resolveComparePair(versions, ['b', 'b'])
    expect(first?.id).toBe('b')
    expect(second?.id).toBe('c')
  })

  it('ignores dangling selections after deletion and falls back to recent versions', () => {
    const versions = [version('a', 1), version('b', 2)]
    const [first, second] = resolveComparePair(versions, ['deleted-id', 'a'])
    expect(first?.id).toBe('b')
    expect(second?.id).toBe('a')
  })

  it('prunes dangling compare selections against remaining versions', () => {
    const versions = [version('a', 1)]
    expect(pruneCompareSelection(['a', 'gone'], versions)).toEqual(['a', null])
  })

  it('returns null slots when fewer than two versions exist', () => {
    const only = [version('a', 1)]
    const [first, second] = resolveComparePair(only, [null, null])
    expect(first?.id ?? null).toBe('a')
    expect(second).toBeNull()
  })
})
