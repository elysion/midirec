'use strict'; // eslint-disable-line semi
require('babel/register')
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const NanoTimer = require('nanotimer')
// const readline = require('readline')
const fs = require('fs')

const Console = console
const ClockTick = [248]
const ClockStart= [250]

const main = () => {
  const bpm = parseInt(process.argv[2])
  const inputFilename = process.argv[3]
  const usPerTick = parseInt(60 / bpm / 24 * 1000 * 1000)
  const midiCommands = fs.readFileSync(inputFilename, 'utf8').split('\n').slice(0, -1).map(JSON.parse)
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
