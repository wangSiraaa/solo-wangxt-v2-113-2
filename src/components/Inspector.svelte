<script lang="ts">
  import {
    beginAnchorPick,
    editor,
    deleteSelected,
    removeAnchor,
    repairAnchorById,
    updateSelectedObject
  } from '../lib/stores';
  import { requestLocateOriginal } from '../lib/ui';
  import { anchorReferencePoint, elementLabel, resolveElement } from '../lib/anchors';

  const styleFields = [
    { key: 'fill', label: '填充', type: 'color' },
    { key: 'stroke', label: '描边', type: 'color' },
    { key: 'strokeWidth', label: '线宽', type: 'number' },
    { key: 'opacity', label: '不透明度', type: 'range' }
  ] as const;

  function patch(key: string, value: string | number) {
    updateSelectedObject((item) => ({ ...item, [key]: value }) as typeof item);
  }

  $: project = $editor.project;
  $: selected = project.objects.find((object) => object.id === $editor.selectedId) ?? null;
  $: anchors = selected?.anchors ?? [];
  $: brokenCount = anchors.filter((anchor) => anchor.status === 'broken').length;
  $: anchorInfo = anchors.map((anchor) => {
    const ref = selected ? anchorReferencePoint(selected, anchor) : null;
    const resolved = anchor.status === 'active' ? resolveElement(project, anchor.elementKey) : null;
    return {
      anchor,
      present: !!ref,
      world: ref ? ([ref.x, ref.y] as [number, number]) : ([anchor.pointX, anchor.pointY] as [number, number]),
      resolved
    };
  });
</script>

<aside class="inspector">
  <h3>对象 / 实例身份</h3>
  {#if selected}
    <p class="id">原始对象 ID<br /><code>{selected.id}</code></p>
    <input class="name" value={selected.name} on:change={(event) => patch('name', event.currentTarget.value)} />
    <p class="instance">当前选中实例：<code>{$editor.selectedInstance ?? '原始基本单元'}</code></p>
    <button on:click={requestLocateOriginal}>定位到原始对象</button>

    <div class="anchor-section">
      <div class="anchor-head">
        <h4>对称元素锚定</h4>
        {#if $editor.anchorPickPending}
          <button class="pick active" disabled>拾取中…（Esc 取消）</button>
        {:else}
          <button class="pick" on:click={beginAnchorPick}>＋ 锚定到对称元素</button>
        {/if}
      </div>
      <p class="note">
        点按后在画布上点击参考点附近的旋转中心、镜线或滑移轴。旋转中心不允许偏移；
        镜线/滑移轴仅允许沿轴移动。锚定随撤销/重做与工程一起保存。
      </p>
      {#if anchors.length === 0}
        <p class="empty">该对象尚未锚定。</p>
      {:else}
        <ul class="anchor-list">
          {#each anchorInfo as info (info.anchor.id)}
            <li class:broken={info.anchor.status === 'broken'}>
              <div class="anchor-row">
                <span class="badge {info.anchor.elementKind}">
                  {info.anchor.elementKind === 'rotation' ? '旋' : info.anchor.elementKind === 'mirror' ? '镜' : '滑'}
                </span>
                <div class="anchor-meta">
                  <strong>{elementLabel(project.group, info.anchor.elementKey)}</strong>
                  <code>{info.anchor.elementKey}</code>
                  <small>
                    参考点 #{info.anchor.pointSegment}·{info.anchor.pointRole} ·
                    ({Math.round(info.world[0])}, {Math.round(info.world[1])})
                    {#if !info.present} · 参考点已失效{/if}
                  </small>
                </div>
              </div>
              {#if info.anchor.status === 'active' && info.resolved}
                <p class="rule">
                  {info.resolved.axisDir
                    ? '允许沿轴偏移；垂直偏差会被自动投影回轴上'
                    : '参考点锁定在旋转中心，不允许偏移'}
                </p>
              {/if}
              {#if info.anchor.status === 'broken'}
                <p class="reason">⚠ 待修复：{info.anchor.brokenReason}</p>
                <div class="anchor-actions">
                  <button on:click={() => repairAnchorById(info.anchor.id)}>重新匹配修复</button>
                  <button class="danger" on:click={() => removeAnchor(info.anchor.id)}>解除锚定</button>
                </div>
              {:else}
                <div class="anchor-actions">
                  <button class="danger" on:click={() => removeAnchor(info.anchor.id)}>解除锚定</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if brokenCount > 0}
        <p class="broken-note">有 {brokenCount} 个锚定待修复；它们仍被保留，不会静默脱离，可随时解除或撤销。</p>
      {/if}
    </div>

    <div class="styles">
      {#each styleFields as field}
        <label>
          {field.label}
          {#if field.type === 'color'}
            <input type="color" value={selected[field.key]} on:input={(e) => patch(field.key, e.currentTarget.value)} />
          {:else if field.type === 'number'}
            <input
              type="number"
              min="0"
              max="20"
              step="0.5"
              value={selected[field.key]}
              on:input={(e) => patch(field.key, Number(e.currentTarget.value))}
            />
          {:else}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selected[field.key]}
              on:input={(e) => patch(field.key, Number(e.currentTarget.value))}
            />
          {/if}
        </label>
      {/each}
    </div>
    <button class="danger" on:click={deleteSelected}>删除原始对象（所有实例同步）</button>
  {:else}
    <p class="empty">点选任意图案实例。双击实例可把镜头移回它唯一的原始基本单元。编辑原始路径或样式时，全部由矩阵生成的实例立即同步。选中对象后可把它的可编辑参考点锚定到旋转中心、镜线或滑移轴。</p>
  {/if}
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
  }
  h4 {
    margin: 0;
    font-size: 13px;
  }
  .id,
  .instance {
    margin: 0;
    color: #475569;
    font-size: 12px;
    word-break: break-all;
  }
  code {
    color: #0f172a;
  }
  .name {
    width: 100%;
  }
  .anchor-section {
    border-top: 1px solid #e2e8f0;
    padding-top: 8px;
    display: grid;
    gap: 8px;
  }
  .anchor-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .pick {
    background: #fffbeb;
    border-color: #f59e0b;
    color: #92400e;
  }
  .pick.active {
    background: #f59e0b;
    border-color: #f59e0b;
    color: white;
  }
  .anchor-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .anchor-list li {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 6px;
    background: #f8fafc;
  }
  .anchor-list li.broken {
    border-color: #fca5a5;
    background: #fef2f2;
  }
  .anchor-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
  }
  .badge {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: white;
    font-size: 13px;
  }
  .badge.rotation {
    background: #dc2626;
  }
  .badge.mirror {
    background: #059669;
  }
  .badge.glide {
    background: #db2777;
  }
  .anchor-meta {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .anchor-meta code,
  .anchor-meta small {
    font-size: 11px;
    color: #64748b;
    word-break: break-all;
  }
  .rule,
  .reason {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
  }
  .rule {
    color: #92400e;
  }
  .reason {
    color: #b91c1c;
  }
  .anchor-actions {
    display: flex;
    gap: 6px;
  }
  .anchor-actions button {
    flex: 1;
  }
  .broken-note {
    margin: 0;
    font-size: 11px;
    color: #b91c1c;
  }
  .styles {
    display: grid;
    gap: 8px;
  }
  label {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  input[type='color'] {
    height: 30px;
    padding: 0;
  }
  .empty,
  .note {
    color: #64748b;
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
  }
  .danger {
    background: #fee2e2;
    color: #991b1b;
    border-color: #fecaca;
  }
</style>
