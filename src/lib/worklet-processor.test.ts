/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const QUANTUM_PERIOD = 2 ** 20
const processorSource = readFileSync(
  new URL('../../public/worklet/processor.js', import.meta.url),
  'utf8',
)

type Processor = {
  port: {
    onmessage: (event: {
      data: { type: string; controlRing: SharedArrayBuffer; paramBuffer: SharedArrayBuffer }
    }) => void
  }
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
}

type ProcessorConstructor = new (options: {
  processorOptions: { wasmModule: null }
}) => Processor

async function createProcessor() {
  const wasmMemory = new ArrayBuffer(128 * 4)
  const wasmOutput = new Float32Array(wasmMemory)
  // The renderer only marks triggers. Rust DSP has its own tests; this suite
  // exercises the actual worklet's event consumption without needing a WASM build.
  const render = vi.fn((offset: number, voice: number, noiseGain: number) => {
    wasmOutput.fill(noiseGain)
    if (offset !== 0xFF) wasmOutput[offset] += voice + 1
  })
  const processors = new Map<string, ProcessorConstructor>()
  let signalReady!: () => void
  const ready = new Promise<void>((resolve) => { signalReady = resolve })
  const context = createContext({
    sampleRate: 48000,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = {
        onmessage: null,
        postMessage: (message: { type: string }) => {
          if (message.type === 'ready') signalReady()
        },
      }
    },
    registerProcessor: (name: string, constructor: ProcessorConstructor) => {
      processors.set(name, constructor)
    },
    WebAssembly: {
      instantiate: async () => ({
        exports: {
          init: () => {},
          set_accent_params: () => {},
          get_output_buffer_ptr: () => 0,
          memory: { buffer: wasmMemory },
          fill_output_buffer: render,
        },
      }),
    },
  })
  runInContext(processorSource, context)
  const Constructor = processors.get('metronome-processor')
  if (!Constructor) throw new Error('Worklet processor was not registered')
  const processor = new Constructor({ processorOptions: { wasmModule: null } })
  const controlRing = new SharedArrayBuffer(8 + 256 * 4)
  const indices = new Int32Array(controlRing, 0, 2)
  const events = new Uint32Array(controlRing, 8, 256)
  processor.port.onmessage({
    data: { type: 'init-buffers', controlRing, paramBuffer: new SharedArrayBuffer(32) },
  })
  await ready

  return {
    indices,
    render,
    enqueue(quantum: number, offset = 64, voice = 0) {
      const write = Atomics.load(indices, 1)
      const nextWrite = (write + 1) & 0xFF
      if (nextWrite === Atomics.load(indices, 0)) throw new Error('Test ring is full')
      // Use the producer's existing packed event format, including timestamp wrap.
      events[write] = (offset & 0x7F) | ((voice & 0x1F) << 7) | ((quantum & 0xFFFFF) << 12)
      Atomics.store(indices, 1, nextWrite)
    },
    processAt(quantum: number) {
      context.currentFrame = quantum * 128
      const output = new Float32Array(128)
      expect(processor.process([], [[output]])).toBe(true)
      return output
    },
  }
}

describe('worklet beat timestamps', () => {
  it.each<[string, number]>([
    ['initial clock', 0],
    ['last quantum before rollover', QUANTUM_PERIOD - 1],
    ['first quantum after rollover', QUANTUM_PERIOD],
    ['later beat after rollover', QUANTUM_PERIOD + 100],
    ['second rollover', QUANTUM_PERIOD * 2],
    ['two days of audio time', Math.floor(2 * 24 * 60 * 60 * 48000 / 128)],
    ['past signed 32-bit quantum range', 2 ** 31 + 17],
    ['past unsigned 32-bit quantum range', 2 ** 32 + 17],
  ])('renders a current beat at %s', async (_label, quantum) => {
    const worklet = await createProcessor()
    worklet.enqueue(quantum, 127, 3)

    const output = worklet.processAt(quantum)

    expect(worklet.render).toHaveBeenLastCalledWith(127, 3, 0)
    expect(output[127]).toBe(4)
    expect(Atomics.load(worklet.indices, 0)).toBe(1)
  })

  it.each([1, 2, 10])('keeps a future beat queued across rollover %i', async (cycle) => {
    const boundary = QUANTUM_PERIOD * cycle
    const worklet = await createProcessor()
    worklet.enqueue(boundary, 5, 1)

    expect(worklet.processAt(boundary - 1).every(sample => sample === 0)).toBe(true)
    expect(Atomics.load(worklet.indices, 0)).toBe(0)

    expect(worklet.processAt(boundary)[5]).toBe(2)
    expect(worklet.render).toHaveBeenLastCalledWith(5, 1, 0)
    expect(Atomics.load(worklet.indices, 0)).toBe(1)
  })

  it.each([1, 2, 10])('discards a stale beat from before rollover %i', async (cycle) => {
    const boundary = QUANTUM_PERIOD * cycle
    const worklet = await createProcessor()
    worklet.enqueue(boundary - 1)

    expect(worklet.processAt(boundary).every(sample => sample === 0)).toBe(true)
    expect(worklet.render).toHaveBeenLastCalledWith(0xFF, 0, 0)
    expect(Atomics.load(worklet.indices, 0)).toBe(1)

    worklet.enqueue(boundary + 1)
    expect(worklet.processAt(boundary + 1)[64]).toBe(1)
  })

  it('keeps ordinary future events queued until their quantum', async () => {
    const worklet = await createProcessor()
    worklet.enqueue(100)

    expect(worklet.processAt(99).every(sample => sample === 0)).toBe(true)
    expect(Atomics.load(worklet.indices, 0)).toBe(0)
    expect(worklet.processAt(100)[64]).toBe(1)
  })

  it('discards ordinary stale events', async () => {
    const worklet = await createProcessor()
    worklet.enqueue(99)

    expect(worklet.processAt(100).every(sample => sample === 0)).toBe(true)
    expect(Atomics.load(worklet.indices, 0)).toBe(1)
  })

  it('renders new beats after a ring reset without resetting the context clock', async () => {
    const quantum = QUANTUM_PERIOD * 50 + 100
    const worklet = await createProcessor()
    worklet.enqueue(quantum)
    expect(worklet.processAt(quantum)[64]).toBe(1)
    worklet.enqueue(quantum + 1)

    // Stop/Play clears queued events but retains the AudioContext clock.
    Atomics.store(worklet.indices, 0, 0)
    Atomics.store(worklet.indices, 1, 0)
    worklet.enqueue(quantum + 100, 32, 1)

    expect(worklet.processAt(quantum + 100)[32]).toBe(2)
    expect(worklet.render).toHaveBeenLastCalledWith(32, 1, 0)
  })
})
