import { useMemo, useState } from 'react'
import { cloneTokens } from '../domain/brandRules'
import { allocateNextVersion, validateVersionName, VERSION_LABEL_MAX_LENGTH } from '../domain/versioning'
import type { BrandMirrorSnapshot, SavedVersion } from '../models/brandMirrorModels'

interface VersionCompareProps {
  snapshot: BrandMirrorSnapshot
  onSave: () => void
  onToggle: () => void
  onExport: () => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onSetCompareSlot: (slot: 0 | 1, versionId: string) => void
}

export function VersionCompare({ snapshot, onSave, onToggle, onExport, onRename, onDelete, onRestore, onSetCompareSlot }: VersionCompareProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const nextLabel = allocateNextVersion(snapshot.versionSequence, snapshot.versions).label
  const filtered = useMemo(() => filterVersions(snapshot.versions, query), [snapshot.versions, query])
  const [leftId, rightId] = snapshot.compareVersionIds
  const comparedVersions = snapshot.compareMode
    ? [leftId, rightId].map((id) => snapshot.versions.find((version) => version.id === id)).filter((version): version is SavedVersion => Boolean(version))
    : []

  // 正在重命名的版本被删除后，退出编辑态
  if (editingId && !snapshot.versions.some((version) => version.id === editingId)) {
    setEditingId(null)
    setDraftLabel('')
  }

  const startRename = (version: SavedVersion) => {
    setEditingId(version.id)
    setDraftLabel(version.label)
  }

  const cancelRename = () => {
    setEditingId(null)
    setDraftLabel('')
  }

  const submitRename = (id: string) => {
    if (validateVersionName(draftLabel, snapshot.versions, id) === null) {
      onRename(id, draftLabel)
      setEditingId(null)
      setDraftLabel('')
    }
  }

  return (
    <section className="version-section">
      <div className="showcase-heading">
        <div>
          <span className="eyebrow">04 / VERSIONS</span>
          <h2>版本管理</h2>
        </div>
        <div className="version-actions">
          <button className="export-button" type="button" onClick={onExport}>↓ 导出品牌规范</button>
          <button className="secondary-button" type="button" onClick={onSave} title={`自动命名为 ${nextLabel}，删除后的编号不会重复`}>＋ 保存当前版本</button>
          <button className="primary-button" type="button" disabled={snapshot.versions.length < 2} onClick={onToggle}>{snapshot.compareMode ? '退出对比' : '打开对比视图'} <span>↗</span></button>
        </div>
      </div>

      {snapshot.versions.length === 0 ? (
        <div className="version-empty">
          <div className="empty-icon">A/B</div>
          <div><strong>保存第一个版本，开始对照</strong><p>调整令牌后保存为 {nextLabel}，之后可以重命名、删除或随时恢复到任意版本。</p></div>
          <span className="empty-arrow">→</span>
        </div>
      ) : (
        <div className="version-manager">
          <div className="version-toolbar">
            <label className="version-search">
              <span>⌕</span>
              <input aria-label="搜索历史版本" placeholder="搜索版本名称、颜色或日期，早期版本也能找到" value={query} onChange={(event) => setQuery(event.target.value)} />
              {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}>×</button>}
            </label>
            <span className="version-count">共 {snapshot.versions.length} 个版本</span>
          </div>

          <ul className="version-list">
            {filtered.length === 0 && <li className="version-no-result">没有匹配「{query}」的版本</li>}
            {filtered.map((version) => {
              const isActive = version.id === snapshot.activeVersionId
              const slot = version.id === leftId ? 0 : version.id === rightId ? 1 : null
              return (
                <li className={`version-row ${isActive ? 'active' : ''}`} key={version.id}>
                  {editingId === version.id ? (
                    <div className="version-rename">
                      <input
                        aria-label="新版本名称"
                        autoFocus
                        maxLength={VERSION_LABEL_MAX_LENGTH}
                        value={draftLabel}
                        onChange={(event) => setDraftLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') submitRename(version.id)
                          if (event.key === 'Escape') cancelRename()
                        }}
                      />
                      <span className="version-rename-error">{validateVersionName(draftLabel, snapshot.versions, version.id) ?? (snapshot.status === 'error' ? snapshot.message : '')}</span>
                      <button className="text-button" type="button" onClick={() => submitRename(version.id)}>确认</button>
                      <button className="text-button" type="button" onClick={cancelRename}>取消</button>
                    </div>
                  ) : (
                    <>
                      <div className="version-row-main">
                        <strong>{version.label}</strong>
                        <small>{version.createdAt.slice(0, 10)} · 主色 {version.tokens.primary}</small>
                        {isActive && <span className="version-tag current">{snapshot.dirty ? '当前版本 · 有未保存改动' : '当前版本'}</span>}
                        {slot !== null && <span className="version-tag slot">对比{slot === 0 ? '左' : '右'}</span>}
                      </div>
                      <div className="version-row-actions">
                        <button type="button" className={slot === 0 ? 'mini-button selected' : 'mini-button'} onClick={() => onSetCompareSlot(0, version.id)}>对比左</button>
                        <button type="button" className={slot === 1 ? 'mini-button selected' : 'mini-button'} onClick={() => onSetCompareSlot(1, version.id)}>对比右</button>
                        <button type="button" className="mini-button" onClick={() => onRestore(version.id)} disabled={isActive && !snapshot.dirty} title={isActive && !snapshot.dirty ? '工作区已是该版本' : '把工作区令牌恢复为该版本'}>恢复</button>
                        <button type="button" className="mini-button" onClick={() => startRename(version)}>重命名</button>
                        <button type="button" className="mini-button danger" onClick={() => confirmDelete(version) && onDelete(version.id)}>删除</button>
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="compare-slots">
            <span className={leftId ? 'filled' : ''}>对比左：{snapshot.versions.find((version) => version.id === leftId)?.label ?? '未选择'}</span>
            <span className="compare-slots-sep">⇄</span>
            <span className={rightId ? 'filled' : ''}>对比右：{snapshot.versions.find((version) => version.id === rightId)?.label ?? '未选择'}</span>
          </div>

          {comparedVersions.length === 2 && (
            <div className="version-cards">
              <VersionCard label={comparedVersions[0].label} tokens={comparedVersions[0].tokens} active={comparedVersions[0].id === snapshot.activeVersionId} slot="对比左" />
              <VersionCard label={comparedVersions[1].label} tokens={comparedVersions[1].tokens} active={comparedVersions[1].id === snapshot.activeVersionId} slot="对比右" />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function confirmDelete(version: SavedVersion): boolean {
  return window.confirm(`确定删除版本「${version.label}」吗？删除后该编号不会被再次使用。`)
}

function filterVersions(versions: SavedVersion[], query: string): SavedVersion[] {
  const keyword = query.trim().toLowerCase()
  const ordered = [...versions].reverse()
  if (!keyword) return ordered
  return ordered.filter((version) =>
    `${version.label} ${version.createdAt} ${version.tokens.primary} ${version.tokens.secondary}`.toLowerCase().includes(keyword),
  )
}

function VersionCard({ label, tokens, active, slot }: { label: string; tokens: BrandMirrorSnapshot['tokens']; active: boolean; slot: string }) {
  const preview = cloneTokens(tokens)
  return (
    <div className={`version-card ${active ? 'active' : ''}`}>
      <div className="version-card-head">
        <span>{label}</span>
        <small>{slot} · {active ? '当前版本' : '历史版本'}</small>
      </div>
      <div className="version-preview" style={{ background: preview.secondary, borderRadius: preview.radiusScale[2] }}>
        <div className="version-preview-top" style={{ background: preview.primary }} />
        <div className="version-preview-copy"><i /><i /><i /></div>
        <span className="version-preview-button" style={{ background: preview.primary, borderRadius: preview.radiusScale[0] }} />
      </div>
      <div className="version-swatch-row">
        <span style={{ background: preview.primary }} /><span style={{ background: preview.secondary }} />
        <span>圆角 {preview.radiusScale[1]}px</span>
        <span>字号 {preview.typeScale[2]}px</span>
      </div>
    </div>
  )
}
