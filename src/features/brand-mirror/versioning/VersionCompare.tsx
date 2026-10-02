import { useEffect, useState } from 'react'
import { cloneTokens } from '../domain/brandRules'
import { bySequenceDesc, resolveComparePair } from '../domain/versionRules'
import type { BrandMirrorSnapshot, BrandTokens, SavedVersion } from '../models/brandMirrorModels'

interface VersionCompareProps {
  snapshot: BrandMirrorSnapshot
  onSave: () => void
  onToggle: () => void
  onExport: () => void
  onRename: (versionId: string, label: string) => void
  onDelete: (versionId: string) => void
  onRestore: (versionId: string) => void
  onSelectCompare: (slot: 0 | 1, versionId: string | null) => void
}

export function VersionCompare({
  snapshot,
  onSave,
  onToggle,
  onExport,
  onRename,
  onDelete,
  onRestore,
  onSelectCompare,
}: VersionCompareProps) {
  const orderedVersions = [...snapshot.versions].sort(bySequenceDesc)
  const [firstVersion, secondVersion] = resolveComparePair(snapshot.versions, snapshot.compareVersionIds)
  const hasCompare = firstVersion && secondVersion

  return (
    <section className="version-section">
      <div className="showcase-heading">
        <div>
          <span className="eyebrow">04 / VERSIONS</span>
          <h2>版本管理</h2>
        </div>
        <div className="version-actions">
          <button className="export-button" type="button" onClick={onExport}>↓ 导出品牌规范</button>
          <button className="secondary-button" type="button" onClick={onSave}>＋ 保存当前版本</button>
          <button className="primary-button" type="button" disabled={!hasCompare} onClick={onToggle}>
            {snapshot.compareMode ? '退出对比' : '打开对比视图'} <span>↗</span>
          </button>
        </div>
      </div>

      {orderedVersions.length === 0 ? (
        <div className="version-empty">
          <div className="empty-icon">A/B</div>
          <div>
            <strong>保存两个版本，开始对照</strong>
            <p>先保存当前状态作为 Version A，再调整令牌并保存 Version B。版本号只增不复用，历史版本都可以在这里找到。</p>
          </div>
          <span className="empty-arrow">→</span>
        </div>
      ) : (
        <>
          <div className="version-picker">
            <CompareSelect label="左侧版本" versions={orderedVersions} selectedId={firstVersion?.id ?? null} onChange={(id) => onSelectCompare(0, id)} />
            <span className="version-picker-vs">VS</span>
            <CompareSelect label="右侧版本" versions={orderedVersions} selectedId={secondVersion?.id ?? null} onChange={(id) => onSelectCompare(1, id)} />
          </div>

          {snapshot.compareMode && hasCompare ? (
            <div className="version-cards">
              <VersionCard version={firstVersion} active={snapshot.activeVersionId === firstVersion.id} />
              <VersionCard version={secondVersion} active={snapshot.activeVersionId === secondVersion.id} />
            </div>
          ) : null}

          <ul className="version-list">
            {orderedVersions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                active={snapshot.activeVersionId === version.id}
                compared={version.id === firstVersion?.id || version.id === secondVersion?.id}
                onRename={onRename}
                onDelete={onDelete}
                onRestore={onRestore}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function CompareSelect({ label, versions, selectedId, onChange }: { label: string; versions: SavedVersion[]; selectedId: string | null; onChange: (id: string | null) => void }) {
  return (
    <label className="version-select">
      <span>{label}</span>
      <select value={selectedId ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        {selectedId ? null : <option value="">最近版本</option>}
        {versions.map((version) => (
          <option key={version.id} value={version.id}>{version.label} · {formatDate(version.createdAt)}</option>
        ))}
      </select>
    </label>
  )
}

function VersionRow({
  version,
  active,
  compared,
  onRename,
  onDelete,
  onRestore,
}: {
  version: SavedVersion
  active: boolean
  compared: boolean
  onRename: (versionId: string, label: string) => void
  onDelete: (versionId: string) => void
  onRestore: (versionId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(version.label)

  useEffect(() => {
    setDraft(version.label)
  }, [version.label])

  const startEditing = () => {
    setDraft(version.label)
    setEditing(true)
  }

  const commitRename = () => {
    if (draft.trim() && draft.trim() !== version.label) onRename(version.id, draft)
    setEditing(false)
  }

  return (
    <li className={`version-row ${active ? 'active' : ''}`}>
      <span className="version-row-swatches">
        <i style={{ background: version.tokens.primary }} />
        <i style={{ background: version.tokens.secondary }} />
      </span>
      {editing ? (
        <input
          className="version-name-input"
          value={draft}
          autoFocus
          maxLength={30}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <div className="version-row-name">
          <strong>{version.label}</strong>
          {active ? <span className="version-badge current">工作区当前版本</span> : null}
          {compared ? <span className="version-badge compare">对比中</span> : null}
          <small>{formatDate(version.createdAt)}</small>
        </div>
      )}
      <div className="version-row-actions">
        <button type="button" className="row-button" onClick={startEditing} disabled={editing}>重命名</button>
        <button type="button" className="row-button" onClick={() => onRestore(version.id)} disabled={active}>恢复到工作区</button>
        <button
          type="button"
          className="row-button danger"
          onClick={() => {
            if (window.confirm(`确定删除版本「${version.label}」吗？删除后名称和序号都不会再次使用。`)) onDelete(version.id)
          }}
        >
          删除
        </button>
      </div>
    </li>
  )
}

function VersionCard({ version, active }: { version: SavedVersion; active: boolean }) {
  const preview: BrandTokens = cloneTokens(version.tokens)
  return (
    <div className={`version-card ${active ? 'active' : ''}`}>
      <div className="version-card-head">
        <span>{version.label}</span>
        <small>{active ? '当前版本' : '历史版本'} · {formatDate(version.createdAt)}</small>
      </div>
      <div className="version-preview" style={{ background: preview.secondary, borderRadius: preview.radiusScale[2] }}>
        <div className="version-preview-top" style={{ background: preview.primary }} />
        <div className="version-preview-copy"><i /><i /><i /></div>
        <span className="version-preview-button" style={{ background: preview.primary, borderRadius: preview.radiusScale[0] }} />
      </div>
      <div className="version-swatch-row">
        <span style={{ background: preview.primary }} />
        <span style={{ background: preview.secondary }} />
        <span>圆角 {preview.radiusScale[1]}px</span>
        <span>字号 {preview.typeScale[2]}px</span>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
