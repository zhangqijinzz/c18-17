import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { VersionCompare } from '../versioning/VersionCompare'
import { INITIAL_TOKENS, type BrandMirrorSnapshot, type SavedVersion } from '../models/brandMirrorModels'

function makeVersion(id: string, label: string, primary: string): SavedVersion {
  return { id, label, createdAt: '2024-03-01T00:00:00.000Z', tokens: { ...INITIAL_TOKENS, primary } }
}

const baseSnapshot: BrandMirrorSnapshot = {
  status: 'ready',
  tokens: { ...INITIAL_TOKENS },
  theme: 'studio',
  versions: [makeVersion('version-1', 'Version A', '#111111'), makeVersion('version-2', 'Version B', '#222222'), makeVersion('version-3', 'Version C', '#333333')],
  versionSequence: 3,
  compareMode: false,
  compareVersionIds: ['version-2', 'version-3'],
  activeVersionId: 'version-3',
  dirty: false,
  contrastRatio: 4,
  contrastWarning: false,
  message: '',
}

const noop = () => undefined

afterEach(() => cleanup())

describe('VersionCompare', () => {
  it('lists every saved version so early versions stay reachable', () => {
    render(<VersionCompare snapshot={baseSnapshot} onSave={noop} onToggle={noop} onExport={noop} onRename={noop} onDelete={noop} onRestore={noop} onSetCompareSlot={noop} />)
    expect(screen.getByText('Version A')).toBeTruthy()
    expect(screen.getByText('Version B')).toBeTruthy()
    expect(screen.getByText('Version C')).toBeTruthy()
    expect(screen.getByText('共 3 个版本')).toBeTruthy()
  })

  it('filters versions by name through the search box', () => {
    render(<VersionCompare snapshot={baseSnapshot} onSave={noop} onToggle={noop} onExport={noop} onRename={noop} onDelete={noop} onRestore={noop} onSetCompareSlot={noop} />)
    fireEvent.change(screen.getByPlaceholderText('搜索版本名称、颜色或日期，早期版本也能找到'), { target: { value: 'version a' } })
    expect(screen.getByText('Version A')).toBeTruthy()
    expect(screen.queryByText('Version B')).toBeNull()
  })

  it('validates duplicate names inline without calling rename', () => {
    const onRename = vi.fn()
    render(<VersionCompare snapshot={baseSnapshot} onSave={noop} onToggle={noop} onExport={noop} onRename={onRename} onDelete={noop} onRestore={noop} onSetCompareSlot={noop} />)
    fireEvent.click(screen.getAllByText('重命名')[0])
    const input = screen.getByLabelText('新版本名称')
    fireEvent.change(input, { target: { value: 'Version B' } })
    fireEvent.click(screen.getByText('确认'))
    expect(screen.getByText('已存在同名版本，请换一个名称')).toBeTruthy()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('asks for confirmation before deleting', () => {
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<VersionCompare snapshot={baseSnapshot} onSave={noop} onToggle={noop} onExport={noop} onRename={noop} onDelete={onDelete} onRestore={noop} onSetCompareSlot={noop} />)
    fireEvent.click(screen.getAllByText('删除')[0])
    expect(window.confirm).toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('wires restore and compare-slot actions to the view model callbacks', () => {
    const onRestore = vi.fn()
    const onSetCompareSlot = vi.fn()
    render(<VersionCompare snapshot={baseSnapshot} onSave={noop} onToggle={noop} onExport={noop} onRename={noop} onDelete={noop} onRestore={onRestore} onSetCompareSlot={onSetCompareSlot} />)
    const rowA = screen.getByText('Version A').closest('.version-row')
    expect(rowA).not.toBeNull()
    fireEvent.click(within(rowA as HTMLElement).getByText('恢复'))
    expect(onRestore).toHaveBeenCalledWith('version-1')
    fireEvent.click(within(rowA as HTMLElement).getByText('对比左'))
    expect(onSetCompareSlot).toHaveBeenCalledWith(0, 'version-1')
  })
})
