/**
 * 主题色透明度与氛围光晕计算工具
 */

export function hexWithAlpha(hex, alpha, fallback = '37, 99, 235') {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return `rgba(${fallback}, ${alpha})`
  }
  let full = hex.slice(1)
  if (full.length === 3) {
    full = full.split('').map((c) => c + c).join('')
  }
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(${fallback}, ${alpha})`
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
