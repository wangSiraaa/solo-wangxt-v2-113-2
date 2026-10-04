<script lang="ts">
  import {
    activeAnchorFor,
    anchorSelected,
    deleteSelected,
    detachAnchor,
    editor,
    fixAnchor,
    updateSelectedObject
  } from '../lib/stores';
  import { requestLocateOriginal } from '../lib/ui';
  import { elementsForGroup, offsetRuleLabel, referencePoint } from '../lib/anchors';
  import type { AnchorOffsetRule, AnchorRefKind, SymmetryAnchor } from '../types';

  const styleFields = [
    { key: 'fill', label: '填充', type: 'color' },
    { key: 'stroke', label: '描边', type: 'color' },
    { key: 'strokeWidth', label: '线宽', type: 'number' },
    { key: 'opacity', label: '不透明度', type: 'range' }
  ] as const;

  function patch(key: string, value: string | number) {
    updateSelectedObject((item) => ({ ...item, [key]: value }) as typeof item);
  }

  let chosenElement = '';
  let chosenRef: AnchorRefKind = 'bounds-center';
  let chosenRule: AnchorOffsetRule = 'pin';
  let chosenOffset = 0;
  let repairElement = '';

  $: project = $editor.project;
  $: elements = elementsForGroup(project.group);
  $: selectedItem = project.objects.find((object) => object.id === $editor.selectedId) ?? null;
  $: anchor = selectedItem ? activeAnchorFor(project, selectedItem.id) : null;
  $: brokenAnchors = (project.anchors ?? []).filter((item) => item.status === 'broken');

  $: defaultRule = (() => {
    const element = elements.find((item) => item.id === chosenElement);
    if (element && element.kind !== 'rotation') chosenRule = 'on';
    else if (element && element.kind === 'rotation') chosenRule = 'pin';
    return null;
  })();

  function anchorNow() {
    if (!chosenElement) return;
    anchorSelected({
      elementId: chosenElement,
      ref: chosenRef,
      rule: chosenRule,
      offset: chosenOffset
    });
  }

  function detach(anchorId: string) {
    detachAnchor(anchorId);
  }

  function repair(anchor: SymmetryAnchor) {
    const elementId = repairElement || elements[0]?.id;
    if (!elementId) return;
    const element = elements.find((item) => item.id === elementId);
    const rule: AnchorOffsetRule = element?.kind === 'rotation' ? 'pin' : 'on';
    fixAnchor(anchor.id, elementId, rule, 0);
  }

  function refPointPreview() {
    if (!selectedItem) return null;
    return referencePoint(selectedItem.path, chosenRef);
  }
  $: refPreview = refPointPreview();
</script>

<aside class="inspector">
  <h3>对象 / 实例身份</h3>
  {#if $editor.selectedId}
    {#if selectedItem}
      <p class="id">原始对象 ID<br /><code>{selectedItem.id}</code></p>
      <input class="name" value={selectedItem.name} on:change={(event) => patch('name', event.currentTarget.value)} />
      <p class="instance">当前选中实例：<code>{$editor.selectedInstance ?? '原始基本单元'}</code></p>
      <button on:click={requestLocateOriginal}>定位到原始对象</button>

      <div class="anchor-block">
        <h4>对称元素锚定</h4>
        {#if anchor}
          <div class="anchor-card active">
            <span class="badge">{anchor.originGroup} · {anchor.elementLabel}</span>
            <p>
              参考点：{anchor.ref === 'bounds-center' ? '包围盒中心' : '首个节点'} ｜
              规则：{offsetRuleLabel(anchor.rule)}
              {#if anchor.rule === 'offset'}（{anchor.offset}px）{/if}
            </p>
            <p class="hint">拖动任一实例都会映射回该源对象并投影到此约束；改单元尺寸后保持。</p>
            <button class="warning" on:click={() => detach(anchor.id)}>解除锚定</button>
          </div>
        {:else}
          <label>
            对称元素
            <select bind:value={chosenElement}>
              <option value="" disabled>选择旋转中心 / 镜线 / 滑移轴</option>
              {#each elements as element}
                <option value={element.id}>
                  {element.kind === 'rotation' ? `◍ ${element.order}重中心` : element.kind === 'mirror' ? '▎镜线' : '⇄ 滑移轴'}
                  · {element.label}
                </option>
              {/each}
            </select>
          </label>
          <label>
            可编辑参考点
            <select bind:value={chosenRef}>
              <option value="bounds-center">包围盒中心</option>
              <option value="first-point">首个路径节点</option>
            </select>
          </label>
          {#if elements.find((e) => e.id === chosenElement)?.kind !== 'rotation'}
            <label>
              偏移规则
              <select bind:value={chosenRule}>
                <option value="on">落在轴上（可沿轴滑动）</option>
                <option value="offset">固定法向距离</option>
              </select>
            </label>
            {#if chosenRule === 'offset'}
              <label>
                法向偏移
                <input type="number" bind:value={chosenOffset} step="1" />
              </label>
            {/if}
          {/if}
          <button class="primary" disabled={!chosenElement || elements.length === 0} on:click={anchorNow}>
            锚定到该对称元素
          </button>
          {#if refPreview}
            <p class="hint">参考点坐标：({Math.round(refPreview[0])}, {Math.round(refPreview[1])})</p>
          {/if}
        {/if}
      </div>

      <div class="styles">
        {#each styleFields as field}
          <label>
            {field.label}
            {#if field.type === 'color'}
              <input type="color" value={selectedItem[field.key]} on:input={(e) => patch(field.key, e.currentTarget.value)} />
            {:else if field.type === 'number'}
              <input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={selectedItem[field.key]}
                on:input={(e) => patch(field.key, Number(e.currentTarget.value))}
              />
            {:else}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={selectedItem[field.key]}
                on:input={(e) => patch(field.key, Number(e.currentTarget.value))}
              />
            {/if}
          </label>
        {/each}
      </div>
      <button class="danger" on:click={deleteSelected}>删除原始对象（所有实例同步）</button>
    {/if}
  {:else}
    <p class="empty">点选任意图案实例。双击实例可把镜头移回它唯一的原始基本单元。编辑原始路径或样式时，全部由矩阵生成的实例立即同步。</p>
  {/if}

  {#if brokenAnchors.length > 0}
    <div class="repair">
      <h4>⚠ 待修复锚定（{brokenAnchors.length}）</h4>
      {#each brokenAnchors as broken (broken.id)}
        <div class="anchor-card broken">
          <p>
            <strong>{broken.elementLabel}</strong>
            <br />
            <small>原群 {broken.originGroup} · {broken.brokenReason ?? '无法重映射'}</small>
          </p>
          <select bind:value={repairElement}>
            <option value="" disabled>在当前群 {project.group} 中选择替代元素</option>
            {#each elements as element}
              <option value={element.id}>{element.label}</option>
            {/each}
          </select>
          <div class="row">
            <button class="primary" disabled={elements.length === 0} on:click={() => repair(broken)}>修复</button>
            <button class="warning" on:click={() => detach(broken.id)}>解除</button>
          </div>
        </div>
      {/each}
    </div>
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
    margin: 0 0 4px;
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
  .anchor-block,
  .repair {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 9px;
    display: grid;
    gap: 7px;
    background: #f8fafc;
  }
  .repair {
    border-color: #fcd34d;
    background: #fffbeb;
  }
  .anchor-card {
    border-radius: 7px;
    padding: 8px;
    display: grid;
    gap: 6px;
  }
  .anchor-card.active {
    background: #ecfdf5;
    border: 1px solid #6ee7b7;
  }
  .anchor-card.broken {
    background: #fff;
    border: 1px solid #fcd34d;
  }
  .anchor-card p {
    margin: 0;
    font-size: 12px;
    color: #334155;
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    background: #059669;
    color: white;
    border-radius: 5px;
    padding: 2px 6px;
  }
  .hint {
    color: #64748b;
    font-size: 11px;
    line-height: 1.4;
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
  .anchor-block label {
    grid-template-columns: 1fr;
    gap: 3px;
  }
  input[type='color'] {
    height: 30px;
    padding: 0;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row button {
    flex: 1;
  }
  .empty {
    color: #64748b;
    font-size: 13px;
    line-height: 1.5;
  }
  .danger {
    background: #fee2e2;
    color: #991b1b;
    border-color: #fecaca;
  }
  .warning {
    background: #fff7ed;
    color: #9a3412;
    border-color: #fdba74;
  }
  .primary {
    background: #1d4ed8;
    color: white;
    border-color: #1d4ed8;
  }
</style>
