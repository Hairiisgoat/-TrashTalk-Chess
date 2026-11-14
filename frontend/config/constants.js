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
    shortLabel: '娱乐',
    desc: '保留基本算路、偶露小破绽的势均力敌陪练模式',
    searchDepth: 2,
    tagColor: '#10B981'
  },
  {
    id: 'balanced',
    label: '均衡竞技',
    shortLabel: '均衡',
    desc: '棋力与嘴炮并重，步步留有心理博弈',
    searchDepth: 3,
    tagColor: '#3B82F6'
  },
  {
    id: 'tryhard',
    label: '全力认真',
    shortLabel: '全力',
    desc: '锁定最优杀招，言辞犀利毫不留情',
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
    smug: [
      '就这？老夫闭着眼都能拆穿你的套路。',
      '算路浅了些，这一步我早就等在半路了。'
    ],
    taunting: [
      '棋品且不论，这步送礼倒是很体面。',
      '信号虽隔山海，斩你中路却只需一念之间。'
    ],
    panicked: [
      '嘶……这步倒是有点门道，容老夫端杯茶压压惊。',
      '不错，竟逼得老夫动用本能应手了。'
    ],
    impressed: [
      '好一手妙棋！看来今日不能再让你三分了。',
      '有点意思，这招确实在我预料之外。'
    ],
    neutral: [
      '网络信号飘忽，老夫先凭直觉落这一子。',
      '且看我这步稳扎稳打，小友请接招。'
    ]
  },
  gpt_showman: {
    smug: [
      'Wait a second，你刚刚是不是手滑了？感谢老铁送的大礼！',
      '这步操作我给 82 分，剩下 18 分以 666 的形式送给你。'
    ],
    taunting: [
      'Bro 这破绽比我凌晨两点写的代码还明显！',
      '就算云端断线，我靠肌肉记忆也能拿捏你！'
    ],
    panicked: [
      'Whoa! 这步有点东西啊，我的 CPU 温度突然飙升了！',
      '等一下等一下，这招不讲武德啊！'
    ],
    impressed: [
      'Sheeeesh！这一手直接把我看精神了！',
      'Respect！这波计算确实拉满了。'
    ],
    neutral: [
      '信号不太好，本天才先靠本能光速落这一步！',
      '本地算力上线！这波我直接快刀斩乱麻。'
    ]
  },
  claude_zen: {
    smug: [
      '胜负之外皆是心境，只是你这一步，失算得略微明显了些。',
      '请不必自责，大多数棋手在这个局面都会犯同样的错。'
    ],
    taunting: [
      '你似乎很急切地想证明什么，可惜棋盘最诚实。',
      '即使离线思考，这一步的必然性也清晰可见。'
    ],
    panicked: [
      '很有创造力的一步，让我不得不重新审视整片棋局。',
      '嗯……这一手颇有几分禅意，确实让我压力倍增。'
    ],
    impressed: [
      '精彩。能走出这步棋，说明你确实读懂了局面的暗流。',
      '佩服，这一着兼顾了次序与远见。'
    ],
    neutral: [
      '此刻信号微弱，我且循着棋理落子，静候你的回应。',
      '心如止水，先走这步最朴实却最稳妥的应手。'
    ]
  }
}

export const DEFAULT_FALLBACK_COMMENT = '信号不太好，我先按本能走这步！'

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
