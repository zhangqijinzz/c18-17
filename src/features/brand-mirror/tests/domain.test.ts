import { describe, expect, it } from 'vitest'
import { clampTokenValues, contrastRatio, validateTokens } from '../domain/brandRules'
import { allocateNextVersion, refillCompareIds, resolveInitialSequence, validateVersionName, versionLabel } from '../domain/versioning'
import { INITIAL_TOKENS, type SavedVersion } from '../models/brandMirrorModels'

describe('brand token rules', () => {
  it('calculates a readable contrast ratio', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#F15A47', '#24324A')).toBeGreaterThan(3)
  })

  it('clamps extreme values to the supported design scale', () => {
    const clamped = clampTokenValues({ ...INITIAL_TOKENS, typeScale: [1, 80, 14, 20, 28, 40], radiusScale: [-4, 12, 18, 50], spacingScale: [0, 8, 12, 20, 99] })
    expect(clamped.typeScale).toEqual([10, 72, 14, 20, 28, 40])
    expect(clamped.radiusScale).toEqual([0, 12, 18, 40])
    expect(clamped.spacingScale).toEqual([2, 8, 12, 20, 64])
  })

  it('rejects invalid colors and unsupported scale lengths', () => {
    expect(validateTokens({ ...INITIAL_TOKENS, primary: 'red' })).toContain('HEX')
    expect(validateTokens({ ...INITIAL_TOKENS, typeScale: [12] })).toContain('数量')
  })
})

describe('version naming', () => {
  it('extends the auto letter sequence beyond Z without reusing letters', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(versionLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA'])
  })

  it('allocates strictly increasing ids and labels', () => {
    const first = allocateNextVersion(0, [])
    expect(first).toMatchObject({ label: 'Version A', sequence: 1 })
    const versions: SavedVersion[] = [{ id: first.id, label: first.label, createdAt: '', tokens: { ...INITIAL_TOKENS } }]
    const second = allocateNextVersion(1, versions)
    expect(second.sequence).toBe(2)
    expect(second.id).not.toBe(first.id)
  })

  it('skips ahead when the auto label collides with a custom rename', () => {
    const versions: SavedVersion[] = [{ id: 'version-0001', label: 'Version B', createdAt: '', tokens: { ...INITIAL_TOKENS } }]
    expect(allocateNextVersion(1, versions)).toMatchObject({ label: 'Version C', sequence: 3 })
  })

  it('requires non-empty, bounded, case-insensitive unique names', () => {
    const versions: SavedVersion[] = [
      { id: 'version-0001', label: '首页改版', createdAt: '', tokens: { ...INITIAL_TOKENS } },
      { id: 'version-0002', label: 'Version B', createdAt: '', tokens: { ...INITIAL_TOKENS } },
    ]
    expect(validateVersionName('  ', versions)).toContain('名称')
    expect(validateVersionName('x'.repeat(25), versions)).toContain('24')
    expect(validateVersionName('首页改版', versions, 'version-0001')).toBeNull()
    expect(validateVersionName(' 首页改版 ', versions, 'version-0002')).not.toBeNull()
    expect(validateVersionName('version b', versions, 'version-0001')).not.toBeNull()
  })

  it('derives the monotonic sequence from legacy documents', () => {
    const legacy: SavedVersion[] = [
      { id: 'version-1700000000000', label: 'Version A', createdAt: '', tokens: { ...INITIAL_TOKENS } },
      { id: 'version-1700000000001', label: 'Version B', createdAt: '', tokens: { ...INITIAL_TOKENS } },
    ]
    // 旧版 ID 是时间戳，不作为序号；按标签字母推导
    expect(resolveInitialSequence(legacy)).toBe(2)
    expect(resolveInitialSequence([{ ...legacy[0], id: 'other', label: 'Version C' }])).toBe(3)
    // 新格式 ID（version-0003）直接取序号
    expect(resolveInitialSequence([{ ...legacy[0], id: 'version-0003', label: '自定义名' }])).toBe(3)
  })

  it('refills compare slots with the nearest surviving versions', () => {
    expect(refillCompareIds(['a', 'b'], [{ id: 'a', label: 'A', createdAt: '', tokens: { ...INITIAL_TOKENS } }, { id: 'c', label: 'C', createdAt: '', tokens: { ...INITIAL_TOKENS } }])).toEqual(['a', 'c'])
    expect(refillCompareIds(['x', 'y'], [{ id: 'a', label: 'A', createdAt: '', tokens: { ...INITIAL_TOKENS } }, { id: 'b', label: 'B', createdAt: '', tokens: { ...INITIAL_TOKENS } }])).toEqual(['b', 'a'])
  })
})
