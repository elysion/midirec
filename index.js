'use strict'; // eslint-disable-line semi
require('babel/register')
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const fs = require('fs')
const RxNode = require('rx-node')

const Console = console
const ClockTick = [248]
const ClockStart = [250]

const main = () => {
  const filename = process.argv[2]
  Console.log('Starting recording to', filename)
  const fileStream = fs.createWriteStream(filename)
  fileStream.write('test')
  const stdin = RxNode.fromStream(process.stdin, 'end')
  stdin.finally(() => fileStream.end())

  const input = new midi.input()
  const output = new midi.output()
  input.openVirtualPort('Test Input')
  input.ignoreTypes(false, false, false)
  output.openVirtualPort('Test Output')

  var inputSubject = new Rx.Subject()

  input.on('message', (deltaTime, message) => inputSubject.onNext([deltaTime, message]))
  const messages = inputSubject.map(R.nth(1))

  const [clock, other] = messages.partition(R.flip(R.contains)([ClockTick, ClockStart]))
  const position = clock.scan(([phrase, bar, beat, tick], message) => {
    if (R.equals(message, ClockStart)) {
      return [0,0,0,0]
    }

    const tickOverflow = tick === 23 ? 1 : 0
    tick = (tick + 1) % 24
    const beatOverflow = beat === 3 && tickOverflow ? 1 : 0
    beat = (beat + tickOverflow) % 4
    const barOverflow = bar === 3 && beatOverflow ? 1 : 0
    bar = (bar + beatOverflow) % 4
    phrase += barOverflow
    return [phrase, bar, beat, tick]
  }, [0, 0, 0, 0])

  other.withLatestFrom(position, (other, position) => [other, position])
    .map(JSON.stringify)
    .subscribe(serializedData => fileStream.write(serializedData + '\n'))
}

if (require.main === module) {
  main()
}
