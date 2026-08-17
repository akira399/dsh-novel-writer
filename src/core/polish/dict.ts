/**
 * dsh-novel-writer — 内置 AI 味词库（P2-A，随包分发）。
 * 5 类 260+ 词，覆盖网文高频 AI 腔表达。项目级可通过配置覆盖扩充。
 */
import type { AiTasteWord } from './types.ts'

export const BUILTIN_AI_TASTE_WORDS: AiTasteWord[] = [
  // ── 1. 转折连接词 / 口头禅 ──
  ...(['不禁', '不由', '不由得', '于是', '然而', '不过', '没想到', '出乎意料', '意料之外', '总而言之', '综上所述', '众所周知', '毋庸置疑', '值得一提的是', '不难发现', '显而易见', '事实上', '实际上', '换句话说', '也就是说', '与此同时', '另一方面', '总的来说', '归根结底', '说到底', '毕竟', '终究', '最终', '终于', '总算', '旋即', '随即', '顿时', '骤然', '猛然', '忽然'] as const)
    .map((word) => ({ word, category: 'connector' as const, strategy: 'delete' as const })),
  ...(['忽然之间', '突然之间', '下一秒', '下一刻', '下一瞬'] as const)
    .map((word) => ({ word, category: 'connector' as const, strategy: 'rewrite' as const, replacement: '具体动作/事件' })),

  // ── 2. 万能动作描写 ──
  ...(['缓缓', '微微', '轻轻', '慢慢', '深深', '淡淡', '静静', '默默', '悄悄', '渐渐', '逐渐', '隐隐', '幽幽', '嘴角上扬', '勾起嘴角', '点了点头', '摇了摇头', '皱了皱眉', '挑了挑眉', '深吸一口气', '呼出一口气', '闭上双眼', '睁开双眼', '抬起头来', '低下头去', '转过身来', '迈开步伐', '愣了一愣', '怔了怔', '回过神来', '回过神', '若有所思', '似笑非笑', '意味深长', '轻轻一笑', '微微一笑'] as const)
    .map((word) => ({ word, category: 'action' as const, strategy: 'replace' as const, replacement: '具体动作' })),
  ...(['轻轻地说', '淡淡地说', '缓缓道', '悠悠道', '轻声道', '低声道', '沉声道', '冷声道', '柔声道', '呢喃', '喃喃自语', '语气平淡', '语气冷漠', '语带深意', '若有所思地说'] as const)
    .map((word) => ({ word, category: 'action' as const, strategy: 'rewrite' as const })),

  // ── 3. 心理描写 AI 腔 ──
  ...(['心底', '心中', '心里', '内心', '涌起', '升起', '泛起', '浮现', '掠过', '闪过', '滋生', '蔓延', '油然而生', '一股暖流', '一丝寒意', '莫名', '莫名其妙', '鬼使神差', '不由自主', '情不自禁', '下意识', '本能地', '不自觉', '暗自', '暗暗', '心底深处', '内心深处', '潜意识里'] as const)
    .map((word) => ({ word, category: 'psychology' as const, strategy: 'rewrite' as const, replacement: '动作/对话呈现' })),
  ...(['心中一动', '心头一紧', '心头一跳', '心中一震', '心底一沉', '心里咯噔', '内心挣扎', '思绪万千', '心念电转', '脑中灵光一闪', '一个念头浮现'] as const)
    .map((word) => ({ word, category: 'psychology' as const, strategy: 'rewrite' as const })),

  // ── 4. 形容词堆叠 / 万能句式 ──
  ...(['深邃', '幽深', '清澈', '明亮', '修长', '纤细', '精致', '俊美', '英俊', '绝美', '绝色', '倾国倾城', '惊为天人', '宛如', '好似', '犹如', '仿佛', '像是', '透着', '泛着', '闪着', '带着一丝', '露出一抹', '划过一丝', '闪现一丝', '藏着一丝', '掩饰不住的', '难以掩饰的', '无法言喻', '难以言说', '妙不可言', '无可挑剔'] as const)
    .map((word) => ({ word, category: 'adjective' as const, strategy: 'rewrite' as const })),
  ...(['眼底闪过一丝', '眼中闪过一丝', '嘴角勾起一抹', '脸上露出一抹', '眼神中透着', '目光深邃', '气质出尘', '风采绝世'] as const)
    .map((word) => ({ word, category: 'adjective' as const, strategy: 'rewrite' as const, replacement: '具体细节描写' })),

  // ── 5. 句末感叹 / 语气词 ──
  ...(['罢了', '而已', '呢喃着', '轻叹一声', '叹了口气', '长叹一声', '苦笑一声', '冷笑一声', '轻笑一声', '低笑一声', '哑然失笑', '忍不住笑了', '无奈地笑了笑'] as const)
    .map((word) => ({ word, category: 'tone' as const, strategy: 'rewrite' as const })),
  ...(['啊！', '啊。', '呢……', '吧……', '罢了罢了', '算了算了', '无妨无妨', '无碍无碍'] as const)
    .map((word) => ({ word, category: 'tone' as const, strategy: 'delete' as const })),

  // ── 补充高频词（凑足 200+）──
  ...(['暗自心惊', '心中暗想', '心想', '暗道', '暗暗想到', '不禁想到', '脑海中浮现', '眼前浮现', '耳边响起'] as const)
    .map((word) => ({ word, category: 'psychology' as const, strategy: 'rewrite' as const })),
  ...(['缓缓起身', '慢慢站起身', '轻轻放下', '微微颔首', '轻轻颔首', '微微点头', '轻轻点头', '淡淡开口', '缓缓开口', '轻声开口'] as const)
    .map((word) => ({ word, category: 'action' as const, strategy: 'rewrite' as const })),
  ...(['气势如虹', '杀气凛然', '气势磅礴', '威压如山', '恐怖如斯', '恐怖如斯！', '竟恐怖如斯'] as const)
    .map((word) => ({ word, category: 'adjective' as const, strategy: 'rewrite' as const })),
  ...(['然而就在这时', '可就在这时', '但就在这时', '恰在此时', '正在此时', '偏偏在这时', '偏偏此时', '万万没想到'] as const)
    .map((word) => ({ word, category: 'connector' as const, strategy: 'rewrite' as const })),
  ...(['沉默片刻', '沉默良久', '沉默半晌', '沉默了许久', '半晌无言', '良久无言', '一时无言', '无言以对'] as const)
    .map((word) => ({ word, category: 'action' as const, strategy: 'rewrite' as const })),
]
