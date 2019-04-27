'use strict' // eslint-disable-line semi
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const NanoTimer = require('nanotimer')
const fs = require('fs')
const parseCsv = require('csv-parse/lib/sync')
const RxNode = require('rx-node')
const readline = require('readline')

const Console = console
const ClockTick = [248]
const ClockStart = [250]

if (process.argv.length < 3) {
  Console.log(`Usage: ${process.argv[1]} bpm`)
  process.exit(1)
}

const main = () => {
  const bpm = parseInt(process.argv[2])
  const usPerTick = parseInt((60 / bpm / 24) * 1000 * 1000)
  const output = new midi.output()
  output.openVirtualPort('Test Output')

  const timer = new NanoTimer()
  const ticks = new Rx.Subject()
  timer.setInterval(() => ticks.onNext(), '', `${usPerTick}u`)
  // const midiFromFileReadline = readline.createInterface({
  //   input: fs.createReadStream(inputFilename)
  // })

  // const midiFromFile = RxNode.fromReadLineStream(midiFromFileReadline)
  setTimeout(() => output.sendMessage(ClockStart), 1000)
  ticks.subscribe(() => output.sendMessage(ClockTick))

  const printScriptPrompt = () => {
    Console.clear()
    readline.cursorTo(process.stdout, 0, 0)
    process.stdout.write('Enter script file location: ')
  }

  const printStateMessage = message => {
    readline.cursorTo(process.stdout, 0, 3)
    readline.clearLine()
    process.stdout.write(message)
  }

  const readMessages = inputFilename => {
    Console.clear()
    Console.log(`Reading messages from ${inputFilename}`)
    const messages = parseCsv(fs.readFileSync(inputFilename, 'utf8'), { relax_column_count: true })
      .slice(1)
      .map(R.map(n => parseInt(n, 10)))
      .map(R.splitEvery(4))
    Console.log(`Read ${messages.length} messages from ${inputFilename}`)
    return messages
  }

  const input = RxNode.fromStream(process.stdin, 'end').map(
    R.pipe(
      String,
      R.trim
    )
  )

  const [enter, messageFile] = input.partition(R.isEmpty)
  const enterPresses = enter.scan(acc => acc + 1, 0)
  const scriptRead = enterPresses.map(c => c % 2 === 0)
  const scriptStarted = enterPresses.map(c => c % 2 === 1)

  scriptRead
    .filter(R.identity)
    .startWith(true)
    .subscribe(printScriptPrompt)
  scriptStarted.filter(R.identity).subscribe(() => printStateMessage('Running... Press enter to stop script\n'))

  const messageFileChanged = messageFile.scan((previous, current) => current !== previous, '')
  const messages = messageFile.map(readMessages) // TODO: handle errors
  messages.subscribe(() => printStateMessage('Press enter to run script\n'))
  const resetClock = ticks // TODO: clock runs a few ticks before stopping after reset
    .merge(messageFileChanged)
    .map(Boolean)
    .distinctUntilChanged()

  const position = ticks
    .pausable(scriptStarted)
    .combineLatest(resetClock)
    .scan(
      ([phrase, bar, beat, tick], [_, resetClock]) => {
        if (resetClock) {
          return [0, 0, 0, 0]
        }
        const tickOverflow = tick === 23 ? 1 : 0
        tick = (tick + 1) % 24
        const beatOverflow = beat === 3 && tickOverflow ? 1 : 0
        beat = (beat + tickOverflow) % 4
        const barOverflow = bar === 3 && beatOverflow ? 1 : 0
        bar = (bar + beatOverflow) % 4
        phrase += barOverflow
        return [phrase, bar, beat, tick]
      },
      [0, 0, 0, 0]
    )

  position.subscribe(position => {
    readline.cursorTo(process.stdout, 0, 6)
    process.stdout.clearLine()
    process.stdout.write(position)
  })

  const isBeforeOrSame = (position1, position2) => {
    for (let i = 0; i < 4; ++i) {
      if (position1[i] > position2[i]) return false
    }
    return true
  }

  position.skip(1) // TODO: this is a hack to prevent sending first message on load (THIS DOES NOT WORK ON SECOND SCRIPT!)
    .combineLatest(messages, resetClock)
    .scan((index, [position, messages, resetClock]) => {
      if (resetClock) return 0
      if (index >= messages.length) {
        readline.cursorTo(process.stdout, 0, 5)
        readline.clearLine()
        Console.log('Script done. Press enter to run another script.')
        return index
      }

      const currentMessage = messages[index]
      if (isBeforeOrSame(currentMessage[0], position)) {
        readline.cursorTo(process.stdout, 0, 4)
        readline.clearLine()
        Console.log('Sending', currentMessage[1])
        output.sendMessage(currentMessage[1])
        return ++index
      }
      return index
    }, 0)
    .subscribe(() => {})
}

if (require.main === module) {
  main()
}
