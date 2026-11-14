import test from 'node:test'
import assert from 'node:assert/strict'

import { cpToWinRate, calcWinRateDelta } from '../engine/common/evaluator.js'
import { analyzeLineTactics } from '../engine/common/tacticsAnalyzer.js'
import { requestAiMove, testApiConnection } from '../api/ai.js'
import { useGameStore } from '../stores/game.js'
import { useSettingsStore } from '../stores/settings.js'
import { usePersonaStore } from '../stores/persona.js'
import { soundManager } from '../utils/sound.js'
import { hexWithAlpha } from '../utils/color.js'

test('Evaluator cpToWinRate and calcWinRateDelta respect bounds', () => {
  assert.equal(cpToWinRate(0), 50)
  assert.ok(cpToWinRate(300) > 70)
  assert.ok(cpToWinRate(-300) < 30)

  const deltaPos = calcWinRateDelta(0, 200)
  assert.ok(deltaPos > 0 && deltaPos <= 100)

  const deltaNeg = calcWinRateDelta(200, -200)
  assert.ok(deltaNeg < 0 && deltaNeg >= -100)
})

test('Evaluator stays locked in [0.1, 99.9] across mate scores and continuous huge advantages without jumping to 50%', () => {
  // 必杀极值校验
  assert.equal(cpToWinRate(29998), 99.9)
  assert.equal(cpToWinRate(-29998), 0.1)
  assert.equal(cpToWinRate(Infinity), 99.9)
  assert.equal(cpToWinRate(-Infinity), 0.1)
  assert.equal(cpToWinRate(NaN), 50.0)

  // |score_cp| >= 1500 稳定落在 [98.0%, 99.9%] / [0.1%, 2.0%]
  assert.ok(cpToWinRate(1500) >= 98.0 && cpToWinRate(1500) <= 99.9)
  assert.ok(cpToWinRate(-1500) >= 0.1 && cpToWinRate(-1500) <= 2.0)

  // 连续大优扩展过程（原 Bug 在 -2500cp 会舍入成 0 导致 EvalBar || 50 跳回 50%）
  const playerAdvantageSteps = [-1200, -1500, -2100, -2500, -3600, -29998]
  let prevCp = -900
  for (const cp of playerAdvantageSteps) {
    const aiWr = cpToWinRate(cp)
    const playerWr = Math.round((100 - aiWr) * 10) / 10
    assert.ok(aiWr >= 0.1 && aiWr <= 2.0, `Expected aiWr in [0.1, 2.0] for cp=${cp}, got ${aiWr}`)
    assert.ok(playerWr >= 98.0 && playerWr <= 99.9, `Expected playerWr in [98.0, 99.9] for cp=${cp}, got ${playerWr}`)
    const delta = calcWinRateDelta(prevCp, cp)
    assert.ok(delta <= 0 && delta >= -100, `Expected non-positive delta from ${prevCp} to ${cp}, got ${delta}`)
    prevCp = cp
  }

  // AI 连续大优扩展过程同样保持单调连续
  const aiAdvantageSteps = [1200, 1500, 2100, 2500, 3600, 29998]
  prevCp = 900
  for (const cp of aiAdvantageSteps) {
    const aiWr = cpToWinRate(cp)
    assert.ok(aiWr >= 98.0 && aiWr <= 99.9, `Expected aiWr in [98.0, 99.9] for cp=${cp}, got ${aiWr}`)
    const delta = calcWinRateDelta(prevCp, cp)
    assert.ok(delta >= 0 && delta <= 100, `Expected non-negative delta from ${prevCp} to ${cp}, got ${delta}`)
    prevCp = cp
  }
})

test('requestAiMove falls back cleanly to candidates[0] when backend is offline', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED 127.0.0.1:8000')
  }

  try {
    const res = await requestAiMove({
      game_type: 'xiangqi',
      fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1',
      candidates: [
        { uci: 'b9c7', score_cp: 15, notation: '马2进3', is_capture: false, is_check: false },
        { uci: 'h9g7', score_cp: 12, notation: '马8进7', is_capture: false, is_check: false }
      ],
      persona_id: 'deepseek_master',
      difficulty: 'balanced',
      recent_history: [{ side: 'player', uci: 'h2e2', notation: '炮二平五', eval_cp_after: 10 }],
      win_rate_delta: -1.8,
      move_number: 1
    })

    assert.equal(res.selected_move, 'b9c7')
    assert.equal(res.is_fallback, true)
    assert.equal(res.is_local_fallback, true)
    assert.equal(res.model_provider, 'fallback')
    assert.ok(res.comment.length >= 1 && res.comment.length <= 140)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('requestAiMove rejects illegal LLM move not in candidates and falls back', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      selected_move: 'a0a9',
      comment: 'Illegal hallucination',
      emotion: 'smug',
      persona_id: 'gpt_showman',
      model_provider: 'openai',
      model_name: 'gpt-4o-mini',
      is_fallback: false,
      fallback_reason: null,
      latency_ms: 400,
      request_id: 'req_test_1'
    })
  })

  try {
    const res = await requestAiMove({
      game_type: 'xiangqi',
      fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1',
      candidates: [
        { uci: 'b9c7', score_cp: 15, notation: '马2进3', is_capture: false, is_check: false },
        { uci: 'h9g7', score_cp: 12, notation: '马8进7', is_capture: false, is_check: false }
      ],
      persona_id: 'gpt_showman',
      difficulty: 'casual',
      recent_history: [],
      win_rate_delta: 0,
      move_number: 1
    })

    assert.equal(res.selected_move, 'b9c7')
    assert.equal(res.is_fallback, true)
    assert.equal(res.fallback_reason, 'illegal_move')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Game store supports player move, AI fallback turn, sliding recent_history (<=3), and undo', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('offline')
  }

  try {
    const store = useGameStore()
    store.startNewGame({ gameType: 'chess', difficulty: 'casual', greeting: '开局！' })

    const p1 = store.makePlayerMove('e2e4')
    assert.equal(p1.applied, true)
    assert.equal(p1.needsAiMove, true)
    assert.equal(store.state.moveLog.length, 1)
    assert.equal(store.state.undoRemaining, 2)
    assert.deepEqual(store.state.lastMove.from, { r: 6, c: 4 })
    assert.deepEqual(store.state.lastMove.to, { r: 4, c: 4 })

    await store.triggerAiTurn('gpt_showman')
    assert.equal(store.state.moveLog.length, 2)
    assert.equal(store.state.isAiThinking, false)
    assert.equal(store.state.bubble.isLocalFallback, true)

    // 再走两轮，验证 recentHistory 滑动窗口上限为 3
    store.makePlayerMove('g1f3')
    await store.triggerAiTurn('gpt_showman')
    assert.equal(store.state.moveLog.length, 4)
    assert.equal(store.recentHistory.value.length, 3)

    store.makePlayerMove('f1c4')
    await store.triggerAiTurn('gpt_showman')
    assert.equal(store.state.moveLog.length, 6)

    // 第 1 次悔棋：触发深求专属嘲讽台词与情绪切换，剩余次数变为 1
    const undone1 = store.undoLastTurn('deepseek_master')
    assert.equal(undone1, true)
    assert.equal(store.state.moveLog.length, 4)
    assert.equal(store.state.boardState.turn, 'w')
    assert.equal(store.state.undoRemaining, 1)
    assert.ok(['taunting', 'smug'].includes(store.state.bubble.emotion))
    assert.ok(store.state.bubble.comment.includes('小友') || store.state.bubble.comment.includes('老夫'))

    // 第 2 次悔棋：剩余次数耗尽，canUndo 变为 false
    const undone2 = store.undoLastTurn('deepseek_master')
    assert.equal(undone2, true)
    assert.equal(store.state.undoRemaining, 0)
    assert.equal(store.canUndo.value, false)

    // 第 3 次悔棋应被拒绝
    const undone3 = store.undoLastTurn('deepseek_master')
    assert.equal(undone3, false)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('soundManager safely degrades in non-AudioContext env, toggles mute, and synthesizes Web Audio nodes when supported', () => {
  assert.equal(hexWithAlpha('#2563EB', 0.5), 'rgba(37, 99, 235, 0.5)')
  assert.equal(hexWithAlpha('#0F0', 0.25), 'rgba(0, 255, 0, 0.25)')

  const origMuted = soundManager.isMuted()
  try {
    soundManager.setMuted(false)
    assert.equal(soundManager.isMuted(), false)
    // Node 环境无 AudioContext，应安全降级返回 false 而不抛错
    assert.equal(soundManager.playMove(), false)
    assert.equal(soundManager.playCapture(), false)
    assert.equal(soundManager.playCheck(), false)
    assert.equal(soundManager.playGameOver(true), false)

    // 模拟 H5 Web Audio API，验证振荡器与滤波合成路径可正常触发
    let oscCount = 0
    let noiseCount = 0
    class MockAudioContext {
      constructor() {
        this.currentTime = 0
        this.sampleRate = 44100
        this.state = 'running'
        this.destination = {}
      }
      createOscillator() {
        oscCount += 1
        return {
          type: 'sine',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          start() {},
          stop() {}
        }
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}
        }
      }
      createBuffer(_ch, len) {
        return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(len) }
      }
      createBufferSource() {
        noiseCount += 1
        return { buffer: null, connect() {}, start() {}, stop() {} }
      }
      createBiquadFilter() {
        return { type: 'bandpass', frequency: { setValueAtTime() {} }, Q: { setValueAtTime() {} }, connect() {} }
      }
    }

    const origAudioCtx = globalThis.AudioContext
    globalThis.AudioContext = MockAudioContext
    soundManager._ctx = null
    try {
      assert.equal(soundManager.playMove(), true)
      assert.equal(soundManager.playCapture(), true)
      assert.equal(soundManager.playCheck(), true)
      assert.equal(soundManager.playGameOver(true), true)
      assert.equal(soundManager.playGameOver(false), true)
      assert.ok(oscCount >= 10)
      assert.ok(noiseCount >= 2)

      // 静音开启后应阻止发声
      assert.equal(soundManager.toggleMute(), true)
      assert.equal(soundManager.playMove(), false)
    } finally {
      soundManager._ctx = null
      globalThis.AudioContext = origAudioCtx
    }
  } finally {
    soundManager.setMuted(origMuted)
  }
})

test('settingsStore manages BYOK headers, custom personas, and injects them into AI requests & testApiConnection', async () => {
  const settingsStore = useSettingsStore()
  const personaStore = usePersonaStore()
  const gameStore = useGameStore()
  const origFetch = globalThis.fetch

  try {
    settingsStore.resetAllForTest()
    personaStore.syncPersonas()

    // 1. 默认 server 模式不透传 X-Custom-* 请求头
    assert.deepEqual(settingsStore.getCustomHeaders(), {})

    // 2. 切换为 custom BYOK 模式后生成 X-Custom-* 请求头
    settingsStore.updateApiConfig({
      mode: 'custom',
      provider: 'anthropic',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'test-ant-key-888',
      modelName: 'claude-sonnet-5-5'
    })
    assert.deepEqual(settingsStore.getCustomHeaders(), {
      'X-Custom-Provider': 'anthropic',
      'X-Custom-Base-Url': 'https://relay.example.com/v1',
      'X-Custom-Api-Key': 'test-ant-key-888',
      'X-Custom-Model': 'claude-sonnet-5-5'
    })

    // 3. 工坊创建自定义对手，并验证出现在 personaStore 列表且可被选中
    const custom = settingsStore.saveCustomPersona({
      name: '暴躁广州棋王',
      theme_color: '#EC4899',
      style_prompt: '暴躁傲娇的广州棋王，爱喝早茶、嘴硬心软',
      catchphrase: '得闲饮茶啦喂！'
    })
    assert.ok(custom && custom.persona_id.startsWith('custom_'))
    personaStore.syncPersonas(custom.persona_id)
    assert.equal(personaStore.currentPersona.value.persona_id, custom.persona_id)
    assert.ok(personaStore.state.personas.some((p) => p.persona_id === custom.persona_id))

    // 4. Mock fetch 验证 /ai/move 透传自定义请求头 + custom_persona，以及 /ai/test-connection
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
      if (url.endsWith('/ai/test-connection')) {
        return new Response(
          JSON.stringify({
            ok: true,
            provider: 'openai',
            model_name: 'gpt-4o-mini',
            latency_ms: 42,
            message: '连接成功',
            using_custom_credentials: true,
            request_id: 'req_test'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({
          selected_move: 'e7e5',
          comment: '得闲饮茶啦喂，行步e5陪你玩下！',
          emotion: 'taunting',
          persona_id: custom.persona_id,
          model_provider: 'anthropic',
          model_name: 'claude-sonnet-5-5',
          is_fallback: false,
          fallback_reason: null,
          latency_ms: 55,
          request_id: 'req_move'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const testRes = await testApiConnection({
      mode: 'custom',
      provider: 'openai',
      baseUrl: 'https://openai.proxy/v1',
      apiKey: 'tmp-probe-key',
      modelName: 'gpt-4o-mini'
    })
    assert.equal(testRes.ok, true)
    assert.equal(calls[0].headers['X-Custom-Provider'], 'openai')
    assert.equal(calls[0].headers['X-Custom-Api-Key'], 'tmp-probe-key')

    gameStore.startNewGame({ gameType: 'chess', difficulty: 'balanced', greeting: custom.greeting })
    const playerMove = gameStore.makePlayerMove('e2e4')
    assert.equal(playerMove.applied, true)
    await gameStore.triggerAiTurn(personaStore.currentPersona.value)

    const moveCall = calls.find((c) => c.url.endsWith('/ai/move'))
    assert.ok(moveCall)
    assert.equal(moveCall.headers['X-Custom-Provider'], 'anthropic')
    assert.equal(moveCall.headers['X-Custom-Api-Key'], 'test-ant-key-888')
    assert.equal(moveCall.headers['X-Custom-Model'], 'claude-sonnet-5-5')
    assert.equal(moveCall.body.persona_id, custom.persona_id)
    assert.equal(moveCall.body.custom_persona.name, '暴躁广州棋王')
    assert.equal(moveCall.body.custom_persona.catchphrase, '得闲饮茶啦喂！')

    // 5. 删除自定义角色后同步移除
    assert.equal(settingsStore.deleteCustomPersona(custom.persona_id), true)
    personaStore.syncPersonas()
    assert.equal(personaStore.state.personas.some((p) => p.persona_id === custom.persona_id), false)
  } finally {
    globalThis.fetch = origFetch
    settingsStore.resetAllForTest()
    personaStore.syncPersonas()
  }
})

test('moveHistory records full game, detects >15% blunder steps, scrubs replay timeline without mutating live game, and asks AI coach', async () => {
  const gameStore = useGameStore()
  const settingsStore = useSettingsStore()
  const origFetch = globalThis.fetch

  try {
    settingsStore.resetAllForTest()
    gameStore.startNewGame({ gameType: 'chess', difficulty: 'balanced', greeting: '开局！' })

    // 模拟 4 步以上完整对局，其中玩家故意白送皇后 (Qd1->h5 然后 Qh5? 或白送车) 制造胜率骤降 >15%
    globalThis.fetch = async (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : {}
      if (url.endsWith('/ai/coach/ask')) {
        return new Response(
          JSON.stringify({
            answer: `复盘教练诊断：${body.last_move_notation || '开局'} 后，引擎推荐 ${body.top_candidates[0]?.uci || '最佳变例'}。`,
            persona_id: body.persona_id || 'deepseek_master',
            model_provider: 'deepseek',
            model_name: 'deepseek-chat',
            is_fallback: false,
            fallback_reason: null,
            latency_ms: 48,
            request_id: 'req_coach'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      // AI 从当前合法候选里挑第 1 步
      const pick = body.candidates[0].uci
      return new Response(
        JSON.stringify({
          selected_move: pick,
          comment: `我就走 ${pick}`,
          emotion: 'smug',
          persona_id: body.persona_id,
          model_provider: 'deepseek',
          model_name: 'deepseek-chat',
          is_fallback: false,
          fallback_reason: null,
          latency_ms: 35,
          request_id: 'req_ai'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    assert.equal(gameStore.makePlayerMove('e2e4').applied, true) // step 1
    await gameStore.triggerAiTurn('deepseek_master') // step 2
    assert.equal(gameStore.makePlayerMove('d1h5').applied, true) // step 3
    await gameStore.triggerAiTurn('deepseek_master') // step 4
    // 第 5 步白后送吃进对方兵口或底线，随后 AI 搜索识别出白送大子并触发战犯步标记
    const legalNow = gameStore.legalMoves.value.map((m) => m.uci)
    const blunderCandidate =
      ['h5f7', 'h5g6', 'h5h6', 'h5h7', 'h5e5'].find((u) => legalNow.includes(u)) ||
      legalNow[0]
    assert.equal(gameStore.makePlayerMove(blunderCandidate).applied, true) // step 5
    await gameStore.triggerAiTurn('deepseek_master') // step 6 (refines step 5 tactical blunder)

    // 验证全量 moveHistory 不受 3 步滑窗裁剪限制
    assert.equal(gameStore.state.moveHistory.length, 6)
    assert.equal(gameStore.recentHistory.value.length, 3)
    assert.deepEqual(
      gameStore.state.moveHistory.map((m) => m.step),
      [1, 2, 3, 4, 5, 6]
    )

    // 验证全盘至少有一处我方关键战犯步（win_rate_delta < -15% 且 is_blunder === true）
    const blunderMove = gameStore.blunderSteps.value[0]
    assert.ok(blunderMove, 'expected at least one detected player blunder step')
    assert.ok(blunderMove.win_rate_delta < -15, `expected blunder delta < -15, got ${blunderMove.win_rate_delta}`)
    assert.equal(blunderMove.is_blunder, true)

    const liveFenBeforeReplay = gameStore.state.fen

    // 进入复盘并拖动时间轴到第 1 步和战犯步，验证展示层还原历史局面且不破坏 live FEN
    assert.equal(gameStore.enterReplayMode(), true)
    assert.equal(gameStore.isReplayMode.value, true)
    assert.equal(gameStore.state.replay.stepIndex, 6)

    gameStore.seekReplayStep(1)
    assert.equal(gameStore.displayFen.value, gameStore.state.moveHistory[0].fen)
    assert.equal(gameStore.displayLastMove.value.uci, 'e2e4')
    assert.equal(gameStore.state.fen, liveFenBeforeReplay)

    // 停留在战犯步呼叫 AI 教练追问
    gameStore.seekReplayStep(blunderMove.step)
    const coachPayload = gameStore.buildCoachAskPayload({ question: '这步哪里有问题？' })
    assert.equal(coachPayload.fen, blunderMove.fen)
    assert.ok(Array.isArray(coachPayload.top_candidates) && coachPayload.top_candidates.length > 0)
    assert.ok(
      Array.isArray(coachPayload.alternative_candidates) && coachPayload.alternative_candidates.length > 0
    )

    const coachReply = await gameStore.askReplayCoach({ question: '这步哪里有问题？' })
    assert.equal(coachReply.is_fallback, false)
    assert.ok(coachReply.answer.includes('复盘教练诊断'))

    // 退出复盘恢复实况控制
    gameStore.exitReplayMode()
    assert.equal(gameStore.isReplayMode.value, false)
    assert.equal(gameStore.displayFen.value, liveFenBeforeReplay)
  } finally {
    globalThis.fetch = origFetch
    settingsStore.resetAllForTest()
  }
})

test('tacticsAnalyzer derives trade, sacrifice-for-initiative, and blunder tags, and store passes PV + chat_history to /ai/coach/ask', async () => {
  // 1. 一换一兑子（国际象棋：白马吃黑象，黑兵反吃白马）
  const tradeFen = '4k3/3p4/4b3/8/5N2/8/8/4K3 w - - 0 1'
  const tradeRes = analyzeLineTactics('chess', tradeFen, ['f4e6', 'd7e6'])
  assert.ok(tradeRes.tactics_tags.includes('一换一兑子'), `expected 一换一兑子, got ${tradeRes.tactics_tags}`)
  assert.equal(tradeRes.pv.length, 2)

  // 2. 白丢大子 / 漏防丢子（白后直接送到黑兵口中）
  const realHungFen = '4k3/8/8/4p3/8/8/3Q4/4K3 w - - 0 1'
  const hungRes = analyzeLineTactics('chess', realHungFen, ['d2d4', 'e5d4'], {
    evalLossCp: 800,
    winRateDelta: -35
  })
  assert.equal(hungRes.net_material_cp, -900)
  assert.ok(hungRes.tactics_tags.includes('白丢大子'))
  assert.ok(hungRes.tactics_tags.includes('漏防丢子'))

  // 3. 弃兵抢先手 + 将军逼迫
  const sacFen = '4k3/3p4/8/2P5/8/8/8/4K3 w - - 0 1'
  const sacRes = analyzeLineTactics('chess', sacFen, ['c5c6', 'd7c6'], {
    evalLossCp: 20,
    winRateDelta: 1.5
  })
  assert.equal(sacRes.net_material_cp, -100)
  assert.ok(sacRes.tactics_tags.includes('弃兵抢先手'))

  // 4. Store buildCoachAskPayload & askReplayCoach 携带 pv / tactics_tags / actual_move_analysis / chat_history
  const gameStore = useGameStore()
  const settingsStore = useSettingsStore()
  const origFetch = globalThis.fetch
  const coachRequests = []

  try {
    settingsStore.resetAllForTest()
    gameStore.startNewGame({ gameType: 'chess', difficulty: 'balanced', greeting: '开局' })

    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      if (url.endsWith('/ai/coach/ask')) {
        coachRequests.push(body)
        return new Response(
          JSON.stringify({
            answer: '已结合主变线与历史对话给出多轮追问分析。',
            persona_id: 'deepseek_master',
            model_provider: 'deepseek',
            model_name: 'deepseek-chat',
            is_fallback: false,
            fallback_reason: null,
            question_type: 'what_if_followup',
            tactical_summary: '对比摘要',
            latency_ms: 42,
            request_id: 'req_v21_coach'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      // 验证 /ai/move 保持轻量契约（不透传多余字段）
      assert.equal(body.candidates[0].pv, undefined)
      return new Response(
        JSON.stringify({
          selected_move: body.candidates[0].uci,
          comment: '好棋',
          emotion: 'neutral',
          persona_id: 'deepseek_master',
          model_provider: 'deepseek',
          model_name: 'deepseek-chat',
          is_fallback: false,
          fallback_reason: null,
          latency_ms: 20,
          request_id: 'req_v21_ai'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    gameStore.makePlayerMove('e2e4')
    await gameStore.triggerAiTurn('deepseek_master')
    gameStore.enterReplayMode(2)

    const reply = await gameStore.askReplayCoach({
      question: '那如果他不跟我换子怎么办？',
      chatHistory: [
        { role: 'user', content: '这步走得怎么样？' },
        { role: 'assistant', content: '稳健争夺中心先手。' }
      ]
    })

    assert.equal(reply.question_type, 'what_if_followup')
    assert.equal(coachRequests.length, 1)
    const sent = coachRequests[0]
    assert.ok(sent.actual_move_analysis)
    assert.ok(Array.isArray(sent.actual_move_analysis.tactics_tags) && sent.actual_move_analysis.tactics_tags.length > 0)
    assert.ok(Array.isArray(sent.top_candidates[0].pv) && sent.top_candidates[0].pv.length > 0)
    assert.ok(Array.isArray(sent.top_candidates[0].tactics_tags) && sent.top_candidates[0].tactics_tags.length > 0)
    assert.equal(sent.chat_history.length, 2)
  } finally {
    globalThis.fetch = origFetch
    settingsStore.resetAllForTest()
  }
})
