/* dsh-novel-writer 诊断探针 —— 在 DSH 客户端按 F12 打开 DevTools，切到 Console，整段粘贴回车。
   只读检查，不修改任何东西。然后把输出复制给我。 */
(() => {
  const out = {};
  const EMOJI = String.fromCodePoint(0x1F41F);

  // 1) 侧边栏入口：有几个？哪个是 slot 版、哪个是 DOM 回退版？
  const domEntries = [...document.querySelectorAll('[data-dsh-novel-writer-entry]')];
  out.domFallbackEntries = domEntries.length;

  const btns = [...document.querySelectorAll('button')]
    .filter((b) => (b.textContent || '').includes('大肥鱼的小说工坊'));
  out.buttonsWithLabel = btns.length;
  out.buttons = btns.map((b) => {
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return {
      uiVersion: b.getAttribute('data-nw-ui'),          // 'v3' 说明已加载新代码
      hasEmoji: (b.textContent || '').includes(EMOJI),  // true 说明还是旧图标
      hasSvg: !!b.querySelector('svg'),                 // true 说明是新内联图标
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      cursor: cs.cursor,
      pointerEvents: cs.pointerEvents,
      parentClass: b.parentElement ? b.parentElement.className : null,
    };
  });

  // 2) 抽屉：是否挂载、描边与盒模型实际值
  const drawer = [...document.querySelectorAll('body > div')].find((d) => {
    const cs = getComputedStyle(d);
    return cs.position === 'fixed' && cs.zIndex === '2147483647' && d.querySelector('[data-action]');
  });
  if (drawer) {
    const cs = getComputedStyle(drawer);
    out.drawer = {
      borderLeft: cs.borderLeft,          // 期望 1px solid rgb(208, 213, 221)
      boxSizing: cs.boxSizing,            // 期望 border-box
      width: cs.width,
      right: cs.right,
      transform: cs.transform,
      leftEdgeX: Math.round(drawer.getBoundingClientRect().left),
    };
  } else {
    out.drawer = 'not mounted';
  }

  // 3) 宿主是否把入口包在自己的 button 里（若是，说明 slot 版生效）
  out.slotEntryInFooter = !![...document.querySelectorAll('*')]
    .find((el) => typeof el.className === 'string' && el.className.includes('footerActions'));

  console.log('=== dsh-novel-writer 诊断 ===');
  console.log(JSON.stringify(out, null, 2));
  return out;
})()
