/**
 * 零外部依赖的程序化棋盘音效引擎
 * - H5 端：基于 Web Audio API（振荡器 + 滤波噪音 + 包络合成）
 * - uni-app 小程序 / App / Node 测试端：安全降级，绝不抛错
 */

const MUTE_STORAGE_KEY = 'trashtalk_chess_muted'

function readMutedFromStorage() {
  try {
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      const val = uni.getStorageSync(MUTE_STORAGE_KEY)
      if (val === true || val === 'true' || val === '1') return true
      if (val === false || val === 'false' || val === '0') return false
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      const val = globalThis.localStorage.getItem(MUTE_STORAGE_KEY)
      if (val === 'true' || val === '1') return true
      if (val === 'false' || val === '0') return false
    }
  } catch (_) {
    // 忽略受限环境存储异常
  }
  return false
}

function writeMutedToStorage(muted) {
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(MUTE_STORAGE_KEY, Boolean(muted))
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false')
    }
  } catch (_) {
    // 忽略受限环境存储异常
  }
}

class ProceduralSoundManager {
  constructor() {
    this._muted = readMutedFromStorage()
    this._ctx = null
    this._noiseBuffer = null
  }

  isMuted() {
    return this._muted
  }

  setMuted(muted) {
    this._muted = Boolean(muted)
    writeMutedToStorage(this._muted)
    return this._muted
  }

  toggleMute() {
    return this.setMuted(!this._muted)
  }

  isSupported() {
    const AudioCtx =
      typeof globalThis !== 'undefined' &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    return typeof AudioCtx === 'function'
  }

  _ensureContext() {
    if (this._muted) return null
    try {
      const AudioCtx =
        typeof globalThis !== 'undefined' &&
        (globalThis.AudioContext || globalThis.webkitAudioContext)
      if (typeof AudioCtx !== 'function') return null

      if (!this._ctx) {
        this._ctx = new AudioCtx()
      }
      if (this._ctx.state === 'suspended' && typeof this._ctx.resume === 'function') {
        this._ctx.resume().catch(() => {})
      }
      return this._ctx
    } catch (_) {
      return null
    }
  }

  _getNoiseBuffer(ctx) {
    if (this._noiseBuffer && this._noiseBuffer.sampleRate === ctx.sampleRate) {
      return this._noiseBuffer
    }
    const length = Math.floor(ctx.sampleRate * 0.08)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.35))
    }
    this._noiseBuffer = buffer
    return buffer
  }

  _playTone(ctx, { type = 'sine', startFreq, endFreq, startTime, duration, peakGain = 0.25 }) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(startFreq, startTime)
    if (endFreq && endFreq !== startFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration)
    }

    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(startTime)
    osc.stop(startTime + duration + 0.015)
  }

  _playFilteredClick(ctx, { centerFreq = 900, q = 1.4, startTime, duration = 0.04, peakGain = 0.14 }) {
    const source = ctx.createBufferSource()
    source.buffer = this._getNoiseBuffer(ctx)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(centerFreq, startTime)
    filter.Q.setValueAtTime(q, startTime)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(peakGain, startTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start(startTime)
    source.stop(startTime + duration + 0.01)
  }

  /**
   * 清脆温润的木质棋子落盘声
   */
  playMove() {
    try {
      const ctx = this._ensureContext()
      if (!ctx) return false
      const now = ctx.currentTime
      this._playTone(ctx, {
        type: 'triangle',
        startFreq: 260,
        endFreq: 96,
        startTime: now,
        duration: 0.075,
        peakGain: 0.26
      })
      this._playTone(ctx, {
        type: 'sine',
        startFreq: 540,
        endFreq: 210,
        startTime: now,
        duration: 0.032,
        peakGain: 0.12
      })
      this._playFilteredClick(ctx, {
        centerFreq: 1050,
        q: 1.8,
        startTime: now,
        duration: 0.035,
        peakGain: 0.14
      })
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * 厚重带冲击力的吃子拍击声
   */
  playCapture() {
    try {
      const ctx = this._ensureContext()
      if (!ctx) return false
      const now = ctx.currentTime
      this._playTone(ctx, {
        type: 'triangle',
        startFreq: 210,
        endFreq: 56,
        startTime: now,
        duration: 0.115,
        peakGain: 0.38
      })
      this._playTone(ctx, {
        type: 'sawtooth',
        startFreq: 420,
        endFreq: 130,
        startTime: now,
        duration: 0.05,
        peakGain: 0.15
      })
      this._playFilteredClick(ctx, {
        centerFreq: 1250,
        q: 1.1,
        startTime: now,
        duration: 0.06,
        peakGain: 0.28
      })
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * 紧迫感的金属清鸣声（将军提示音）
   */
  playCheck() {
    try {
      const ctx = this._ensureContext()
      if (!ctx) return false
      const now = ctx.currentTime
      // 双音金属泛音鸣响
      this._playTone(ctx, {
        type: 'sine',
        startFreq: 880,
        endFreq: 860,
        startTime: now,
        duration: 0.24,
        peakGain: 0.2
      })
      this._playTone(ctx, {
        type: 'triangle',
        startFreq: 1318.5,
        endFreq: 1310,
        startTime: now,
        duration: 0.2,
        peakGain: 0.12
      })
      this._playTone(ctx, {
        type: 'sine',
        startFreq: 1046.5,
        endFreq: 1040,
        startTime: now + 0.085,
        duration: 0.22,
        peakGain: 0.18
      })
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * 对局结束音效：胜利明快和弦 / 落败低沉提示音
   */
  playGameOver(isWin = true) {
    try {
      const ctx = this._ensureContext()
      if (!ctx) return false
      const now = ctx.currentTime
      if (isWin) {
        const notes = [523.25, 659.25, 783.99, 1046.5]
        notes.forEach((freq, idx) => {
          this._playTone(ctx, {
            type: 'triangle',
            startFreq: freq,
            endFreq: freq,
            startTime: now + idx * 0.075,
            duration: 0.34,
            peakGain: 0.18
          })
        })
      } else {
        const notes = [329.63, 293.66, 246.94, 220.0]
        notes.forEach((freq, idx) => {
          this._playTone(ctx, {
            type: 'sine',
            startFreq: freq,
            endFreq: freq * 0.985,
            startTime: now + idx * 0.1,
            duration: 0.32,
            peakGain: 0.2
          })
        })
      }
      return true
    } catch (_) {
      return false
    }
  }
}

export const soundManager = new ProceduralSoundManager()
export default soundManager
