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

const getPortNumber = name => {
  const input = new midi.input()
  const listMidiInputPorts = () => {
    var inputs = []
    for (var i = 0; i < input.getPortCount(); i++) {
      inputs.push(input.getPortName(i))
    }

    input.closePort()
    return inputs
  }

  var midiInputPorts = listMidiInputPorts()
  Console.log(midiInputPorts, name, midiInputPorts.indexOf(name))
  if (midiInputPorts.indexOf(name) == -1) {
    throw `Port ${name} not found! Available ports: ${midiInputPorts.join(', ')}`
  }
  return midiInputPorts.indexOf(name)
}

const main = () => {
  const filename = process.argv[4]
  const clockDeviceName = process.argv[2]
  const messageDeviceName = process.argv[3]
  Console.log('Starting recording to', filename)
  const fileStream = fs.createWriteStream(filename)
  const stdin = RxNode.fromStream(process.stdin, 'end')
  stdin.finally(() => fileStream.end())

  const clockInput = new midi.input()
  clockInput.ignoreTypes(false, false, false)

  const messageInput = new midi.input()
  messageInput.ignoreTypes(false, false, false)

  const closePorts = () => {
    Console.log('Closing ports')
    clockInput.closePort()
    messageInput.closePort()
  }

  process.on('exit', closePorts)
  process.on('SIGINT', closePorts)
  process.on('uncaughtException', closePorts)

  const clockInputSubject = new Rx.Subject()
  clockInput.on('message', (deltaTime, message) => clockInputSubject.onNext([deltaTime, message]))
  const clock = clockInputSubject.filter(R.flip(R.contains)([ClockTick, ClockStart]))

  const messageInputSubject = new Rx.Subject()
  messageInput.on('message', (deltaTime, message) => messageInputSubject.onNext([deltaTime, message]))
  const messages = messageInputSubject.filter(R.complement(R.flip(R.contains)([ClockTick, ClockStart])))

  clockInput.openPort(getPortNumber(clockDeviceName))
  messageInput.openPort(getPortNumber(messageDeviceName))

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

  messages.withLatestFrom(position, Array)
    .map(R.reverse)
    .map(JSON.stringify)
    .subscribe(serializedData => fileStream.write(serializedData + '\n'))
}

if (require.main === module) {
  main()
}
