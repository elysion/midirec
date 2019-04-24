'use strict'; // eslint-disable-line semi
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const NanoTimer = require('nanotimer')
// const readline = require('readline')
const fs = require('fs')
const parseCsv = require('csv-parse/lib/sync')

const Console = console
const ClockTick = [248]
const ClockStart= [250]

if (process.argv.length < 3) {
  Console.log(`Usage: ${process.argv[1]} bpm input_file`)
  process.exit(1)
}

const main = () => {
  const bpm = parseInt(process.argv[2])
  const inputFilename = process.argv[3]
  const usPerTick = parseInt(60 / bpm / 24 * 1000 * 1000)
  const midiCommands = parseCsv(fs.readFileSync(inputFilename, 'utf8'), {relax_column_count: true})
      .slice(1)
      .map(R.map(n => parseInt(n, 10))).map(R.splitEvery(4))

  let currentCommandIndex = 0
  const output = new midi.output()
  output.openVirtualPort('Test Output')

  const timer = new NanoTimer()
  const ticks = new Rx.Subject()
  timer.setInterval(() => ticks.onNext(), '', `${usPerTick}u`)
  // const midiFromFileReadline = readline.createInterface({
  //   input: fs.createReadStream(inputFilename)
  // })

  // const midiFromFile = RxNode.fromReadLineStream(midiFromFileReadline)

  output.sendMessage(ClockStart)
  ticks.subscribe(() => output.sendMessage(ClockTick))

  const position = ticks.scan(([phrase, bar, beat, tick]) => {
    const tickOverflow = tick === 23 ? 1 : 0
    tick = (tick + 1) % 24
    const beatOverflow = beat === 3 && tickOverflow ? 1 : 0
    beat = (beat + tickOverflow) % 4
    const barOverflow = bar === 3 && beatOverflow ? 1 : 0
    bar = (bar + beatOverflow) % 4
    phrase += barOverflow
    return [phrase, bar, beat, tick]
  }, [0, 0, 0, 0])

  const subscription =
    position.subscribe(position => {
      Console.log(position, midiCommands[currentCommandIndex][0])
      while (R.equals(position, midiCommands[currentCommandIndex][0])) {
        Console.log('Sending', midiCommands[currentCommandIndex][1])
        output.sendMessage(midiCommands[currentCommandIndex][1])
        currentCommandIndex++
        if (currentCommandIndex === midiCommands.length) {
          subscription.dispose()
        }
      }
    })
}

if (require.main === module) {
  main()
}
