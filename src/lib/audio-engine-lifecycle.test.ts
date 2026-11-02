import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './audio-engine.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  state = 'running'
  currentTime = 0
  sampleRate = 48000
  destination = {}
  audioWorklet = { addModule: vi.fn(async () => {}) }
  addEventListener = vi.fn()
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  constructor() { MockAudioContext.instances.push(this) }
}

class MockWorkletNode {
  static instances: MockWorkletNode[] = []
  port = { postMessage: vi.fn(), onmessage: null }
  connect = vi.fn()
  constructor() { MockWorkletNode.instances.push(this) }
}

function wasmResponse() {
  return new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
}

describe('AudioEngine lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockAudioContext.instances = []
    MockWorkletNode.instances = []
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode)
    vi.stubGlobal('fetch', vi.fn(async () => wasmResponse()))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('coalesces concurrent starts while WASM is loading and stops the only scheduler', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const engine = new AudioEngine()
    const first = engine.start()
    const second = engine.start()
    expect(engine.state).toBe('starting')
    expect(fetch).toHaveBeenCalledTimes(1)
    response.resolve(wasmResponse())
    await Promise.all([first, second])
    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockWorkletNode.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await engine.stop()
    expect(engine.state).toBe('stopped')
    expect(vi.getTimerCount()).toBe(0)
    await engine.start()
    expect(MockWorkletNode.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await engine.stop()
  })

  it('does not finish starting after Stop cancels pending loading', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const onState = vi.fn()
    const engine = new AudioEngine(onState)
    const pending = engine.start()
    await engine.stop()
    response.resolve(wasmResponse())
    await pending
    expect(engine.state).toBe('stopped')
    expect(onState).not.toHaveBeenCalledWith('running')
    expect(MockWorkletNode.instances).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('serializes a fast Stop/Play across pending initialization and suspension', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValueOnce(response.promise)
    const engine = new AudioEngine()
    const first = engine.start()
    const suspension = deferred<void>()
    const context = MockAudioContext.instances[0]
    context.suspend.mockImplementationOnce(async () => {
      await suspension.promise
      context.state = 'suspended'
    })
    const stopped = engine.stop()
    const restarted = engine.start()
    response.resolve(wasmResponse())
    await first
    expect(MockWorkletNode.instances).toHaveLength(0)
    suspension.resolve()
    await Promise.all([stopped, restarted])
    expect(engine.state).toBe('running')
    expect(context.state).toBe('running')
    expect(MockWorkletNode.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await engine.stop()
  })

  it('retries after an initialization failure without leaving a scheduler', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('missing', { status: 404 }))
    const engine = new AudioEngine()
    await expect(engine.start()).rejects.toThrow('HTTP 404')
    expect(engine.state).toBe('stopped')
    expect(vi.getTimerCount()).toBe(0)
    await engine.start()
    expect(engine.state).toBe('running')
    expect(MockWorkletNode.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await engine.stop()
  })

  it('remains suspended if a canceled resume settles after Stop', async () => {
    const engine = new AudioEngine()
    await engine.start()
    await engine.stop()
    const context = MockAudioContext.instances[0]
    const resumed = deferred<void>()
    context.resume.mockImplementationOnce(async () => {
      await resumed.promise
      context.state = 'running'
    })
    const pending = engine.start()
    await engine.stop()
    resumed.resolve()
    await pending
    expect(engine.state).toBe('stopped')
    expect(context.state).toBe('suspended')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries when worklet module loading fails', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValueOnce(response.promise)
    const engine = new AudioEngine()
    const pending = engine.start()
    MockAudioContext.instances[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('module failed'))
    response.resolve(wasmResponse())
    await expect(pending).rejects.toThrow('module failed')
    expect(engine.state).toBe('stopped')
    expect(vi.getTimerCount()).toBe(0)
    await engine.start()
    expect(MockWorkletNode.instances).toHaveLength(1)
    await engine.stop()
  })

  it('retains sound selection before Play, during loading, and across Stop/Play', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValueOnce(response.promise)
    const engine = new AudioEngine()
    engine.setClickSound(1)
    const pending = engine.start()
    engine.setClickSound(2)
    response.resolve(wasmResponse())
    await pending
    const port = MockWorkletNode.instances[0].port
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'set-click-sound', sound: 2 })
    engine.setClickSound(1)
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'set-click-sound', sound: 1 })
    await engine.stop()
    await engine.start()
    expect(MockWorkletNode.instances).toHaveLength(1)
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'set-click-sound', sound: 1 })
    await engine.stop()
  })

  it('sends a sound chosen before the first Play to the new worklet', async () => {
    const engine = new AudioEngine()
    engine.setClickSound(2)
    await engine.start()
    expect(MockWorkletNode.instances[0].port.postMessage)
      .toHaveBeenCalledWith({ type: 'set-click-sound', sound: 2 })
    await engine.stop()
  })

  it('does not emit visual beats after Stop', async () => {
    const onStep = vi.fn()
    const engine = new AudioEngine(undefined, undefined, onStep)
    await engine.start()
    vi.advanceTimersByTime(25)
    await engine.stop()
    expect(onStep.mock.calls).toEqual([[-1]])
    vi.advanceTimersByTime(100)
    expect(onStep.mock.calls).toEqual([[-1]])
  })

  it('does not emit a previous playback visual beat after restart', async () => {
    const onStep = vi.fn()
    const engine = new AudioEngine(undefined, undefined, onStep)
    await engine.start()
    vi.advanceTimersByTime(25)
    await engine.stop()
    await engine.start()
    vi.advanceTimersByTime(50)
    // The first playback callback fires now; the new playback callback is still pending.
    expect(onStep.mock.calls).toEqual([[-1]])
    vi.advanceTimersByTime(25)
    expect(onStep.mock.calls).toEqual([[-1], [0]])
    await engine.stop()
  })
})
