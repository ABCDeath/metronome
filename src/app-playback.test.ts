/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const component = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8')
const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('App script was not found')
const ast = ts.createSourceFile('App.ts', script, ts.ScriptTarget.Latest, true)
const handler = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'handlePlayStop',
)
if (!handler) throw new Error('Playback action was not found')

// Execute the actual UI action boundary without a DOM or a separate copy of its logic.
function createPlayback() {
  const engine = {
    state: 'stopped',
    start: vi.fn(async () => { engine.state = 'running' }),
    stop: vi.fn(async () => { engine.state = 'stopped' }),
    updatePattern: vi.fn(),
    setNoiseGain: vi.fn(),
  }
  const context = createContext({ engine, pattern: {}, noiseLevel: 0, audioError: '', playbackAction: 0 })
  runInContext(handler!.getText(), context)
  return { engine, context, playStop: () => runInContext('handlePlayStop()', context) as Promise<void> }
}

describe('playback error feedback', () => {
  it('handles a failed Play and clears its visible error on a successful retry', async () => {
    const { engine, context, playStop } = createPlayback()
    engine.start.mockRejectedValueOnce(new Error('HTTP 404'))
    await expect(playStop()).resolves.toBeUndefined()
    expect(context.audioError).toBe('Unable to start audio. Please try again.')
    expect(component).toMatch(/<p role="alert">\{audioError\}<\/p>/)
    expect(engine.updatePattern).not.toHaveBeenCalled()
    await expect(playStop()).resolves.toBeUndefined()
    expect(context.audioError).toBe('')
    expect(engine.state).toBe('running')
    expect(engine.updatePattern).toHaveBeenCalledOnce()
  })

  it('handles a failed Stop without rejecting the event handler promise', async () => {
    const { engine, context, playStop } = createPlayback()
    engine.state = 'running'
    engine.stop.mockRejectedValueOnce(new Error('suspend failed'))
    await expect(playStop()).resolves.toBeUndefined()
    expect(context.audioError).toBe('Unable to stop audio. Please try again.')
  })

  it('does not show an obsolete start error after a newer Stop action', async () => {
    const { engine, context, playStop } = createPlayback()
    let fail!: (error: Error) => void
    engine.start.mockImplementationOnce(() => {
      engine.state = 'starting'
      return new Promise<void>((_resolve, reject) => { fail = reject })
    })
    const pending = playStop()
    await playStop()
    fail(new Error('late load error'))
    await expect(pending).resolves.toBeUndefined()
    expect(context.audioError).toBe('')
    expect(engine.state).toBe('stopped')
  })
})

describe('Space playback shortcut', () => {
  const keyboardHandler = ast.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'handleKeydown',
  )
  if (!keyboardHandler) throw new Error('Keyboard handler was not found')
  const keyboardScript = ts.transpileModule(keyboardHandler.getText(), {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText

  function pressKey(code: string, target: object, repeat = false) {
    const event = { code, target, repeat, preventDefault: vi.fn() }
    const handlePlayStop = vi.fn()
    const context = createContext({ event, handlePlayStop })
    runInContext(keyboardScript, context)
    runInContext('handleKeydown(event)', context)
    return { event, handlePlayStop }
  }

  it.each(['BODY', 'BUTTON', 'INPUT', 'SELECT'])(
    'toggles playback and prevents native activation with focus on %s',
    (tagName) => {
      const { event, handlePlayStop } = pressKey('Space', { tagName })
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(handlePlayStop).toHaveBeenCalledOnce()
    },
  )

  it('prevents native activation without repeatedly toggling while Space is held', () => {
    const { event, handlePlayStop } = pressKey('Space', { tagName: 'BUTTON' }, true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(handlePlayStop).not.toHaveBeenCalled()
  })

  it('leaves other keys to the focused control', () => {
    const { event, handlePlayStop } = pressKey('Enter', { tagName: 'BUTTON' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(handlePlayStop).not.toHaveBeenCalled()
  })
})
