// Lightweight Vue reactivity shim for Node unit tests (not used by uni-app runtime)
export function reactive(obj) {
  return obj
}

export function ref(val) {
  return { value: val }
}

export function computed(getter) {
  return {
    get value() {
      return getter()
    }
  }
}
