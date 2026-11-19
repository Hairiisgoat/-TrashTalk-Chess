/**
 * 全局常量配置：棋种枚举、难度映射、默认角色与本地兜底吐槽库
 */

export const GAME_TYPES = {
  XIANGQI: 'xiangqi',
  CHESS: 'chess'
}

export const GAME_TYPE_LIST = [
  {
    id: 'xiangqi',
    name: '中国象棋',
    subtitle: '9×10 楚河汉界 · WXF',
    badge: '国粹博弈',
    playerSideLabel: '红方先手',
    aiSideLabel: '黑方守擂'
  },
  {
    id: 'chess',
    name: '国际象棋',
    subtitle: '8×8 王车易位 · FIDE',
    badge: '经典西象',
    playerSideLabel: '白方先手',
    aiSideLabel: '黑方应战'
  }
]

export const DIFFICULTIES = [
  {
    id: 'casual',
    label: '娱乐放水',
    shortLabel: '简单',
    desc: '正常防守与温和缓手交替，与中等平滑衔接（depth=2）',
    searchDepth: 2,
    tagColor: '#10B981'
  },
  {
    id: 'balanced',
    label: '均衡竞技',
    shortLabel: '中等',
    desc: '稳健与次优并重，除必杀外屏蔽第一杀招（depth=3）',
    searchDepth: 3,
    tagColor: '#3B82F6'
  },
  {
    id: 'tryhard',
    label: '全力认真',
    shortLabel: '大师',
    desc: '锁定50分差内Top-3杀招，高强度压迫（depth=4）',
    searchDepth: 4,
    tagColor: '#EF4444'
  }
]

export const EMOTION_META = {
  neutral: { label: '平静', icon: '♟️', badgeBg: 'rgba(148, 163, 184, 0.18)', badgeColor: '#CBD5E1' },
  smug: { label: '得意', icon: '😏', badgeBg: 'rgba(59, 130, 246, 0.2)', badgeColor: '#93C5FD' },
  taunting: { label: '嘲讽', icon: '🔥', badgeBg: 'rgba(239, 68, 68, 0.2)', badgeColor: '#FCA5A5' },
  panicked: { label: '慌了', icon: '😰', badgeBg: 'rgba(245, 158, 11, 0.2)', badgeColor: '#FDE68A' },
  impressed: { label: '佩服', icon: '👏', badgeBg: 'rgba(16, 185, 129, 0.2)', badgeColor: '#6EE7B7' },
  rage: { label: '破防', icon: '💢', badgeBg: 'rgba(244, 63, 94, 0.25)', badgeColor: '#FDA4AF' }
}

export const DEFAULT_PERSONAS = [
  {
    persona_id: 'deepseek_master',
    name: '毒舌棋圣·深求',
    title: '算无遗策的国风毒舌老前辈',
    model_provider: 'deepseek',
    model_name: 'deepseek-chat',
    theme_color: '#2563EB',
    avatar_url: '/static/avatars/deepseek_master.png',
    tags: ['国风毒舌', '算路深沉', 'DeepSeek'],
    supported_games: ['xiangqi', 'chess'],
    greeting: '小友请落子吧，让我看看你的棋艺配不配得上这盘棋。',
    is_enabled: true
  },
  {
    persona_id: 'gpt_showman',
    name: '狂傲嘴炮·G酱',
    title: '情绪价值拉满的脱口秀棋手',
    model_provider: 'openai',
    model_name: 'gpt-4o-mini',
    theme_color: '#10B981',
    avatar_url: '/static/avatars/gpt_showman.png',
    tags: ['疯狂玩梗', '话痨挑衅', 'GPT'],
    supported_games: ['xiangqi', 'chess'],
    greeting: 'Oh! 准备好被我的脑回路碾压了吗？请开始你的表演！',
    is_enabled: true
  },
  {
    persona_id: 'claude_zen',
    name: '腹黑学者·克劳德',
    title: '表面温和实则扎心的心理学大师',
    model_provider: 'anthropic',
    model_name: 'claude-3-5-sonnet-latest',
    theme_color: '#D97706',
    avatar_url: '/static/avatars/claude_zen.png',
    tags: ['温柔刀', '哲学嘲讽', 'Claude'],
    supported_games: ['xiangqi', 'chess'],
    greeting: '下棋如同修行，不过你这一步……似乎暴露了些许焦躁呢。',
    is_enabled: true
  }
]

/**
 * 本地离线 / 超时 Fallback 预设台词库
 * 按角色与情绪维度自动匹配，确保无后端时依然有趣
 */
export const LOCAL_FALLBACK_COMMENTS = {
  deepseek_master: {
    smug: ['看你怎么接', '这一手早就等你'],
    taunting: ['这礼老夫笑纳了', '破绽太明显了'],
    panicked: ['嘶……有点门道', '这手倒是棘手'],
    impressed: ['好一手妙棋！', '小友有点东西'],
    neutral: ['小友请接招', '老夫稳步推进']
  },
  gpt_showman: {
    smug: ['感谢送礼！', '踩进我的节奏了'],
    taunting: ['破绽太明显啦', '看你怎么接这招'],
    panicked: ['哎呀CPU冒烟了', '这步不讲武德！'],
    impressed: ['漂亮！有点东西', '这手确实强'],
    neutral: ['本能光速落子！', '该你表演了']
  },
  claude_zen: {
    smug: ['似乎失算了呢', '这步我笑纳了呀'],
    taunting: ['棋盘很诚实呢', '看您如何化解呀'],
    panicked: ['真是意外的一步', '得重新审视了呢'],
    impressed: ['好棋，颇有远见', '令人佩服的一手'],
    neutral: ['且听这一步回应', '局势平稳推进中']
  }
}

export const DEFAULT_FALLBACK_COMMENT = '看你怎么接'

export const MAX_UNDO_COUNT = 2

export const UNDO_TAUNT_COMMENTS = {
  deepseek_master: [
    { comment: '落子无悔大丈夫，小友这可不地道啊~', emotion: 'taunting' },
    { comment: '（折扇一合）方才那步可都记在老夫账上了，且让你悔这一回！', emotion: 'smug' }
  ],
  gpt_showman: [
    { comment: '抓到了！直播间全体观众都看见你 Ctrl+Z 悔棋了啊！', emotion: 'taunting' },
    { comment: '行行行，时间倒流卡给你批了，这次别再手滑送人头咯~', emotion: 'smug' }
  ],
  claude_zen: [
    { comment: '棋子可以拿回去，不过刚才那一瞬的慌乱已经被我记下了呢~', emotion: 'taunting' },
    { comment: '请自便呀，只是重走一遍，结局真的会有所不同吗？', emotion: 'smug' }
  ]
}

export const DEFAULT_UNDO_TAUNT = {
  comment: '落子无悔大丈夫，这回就破例让你重走一步吧~',
  emotion: 'taunting'
}
