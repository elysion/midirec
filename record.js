'use strict'; // eslint-disable-line semi
require('babel/register')
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const fs = require('fs')
const RxNode = require('rx-node')
const path = require('path')

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
  const filename = process.argv[3]
  const messageDeviceName = process.argv[2]
  const scriptName = path.basename(__filename)

  Console.log('Starting recording to', filename)
  const fileStream = fs.createWriteStream(filename)
  const stdin = RxNode.fromStream(process.stdin, 'end')
  stdin.finally(() => fileStream.end())

  const clockInput = new midi.input()
  // input.openVirtualPort('Test Input')
  clockInput.openVirtualPort(scriptName)
  clockInput.ignoreTypes(false, false, false)
  var clockInputSubject = new Rx.Subject()
  clockInput.on('message', (deltaTime, message) => {clockInputSubject.onNext([deltaTime, message])})
  const clock = clockInputSubject.map(R.nth(1)).filter(R.flip(R.contains)([ClockTick, ClockStart]))

  const messageInput = new midi.input()
  // input.openVirtualPort('Test Input')
  messageInput.openPort(getPortNumber(messageDeviceName))
  var messageInputSubject = new Rx.Subject()
  messageInput.on('message', (deltaTime, message) => {messageInputSubject.onNext([deltaTime, message])})
  const messages = messageInputSubject.map(R.nth(1)).filter(R.complement(R.flip(R.contains)([ClockTick, ClockStart])))

  const initializedMessageOutput = new midi.output()
  initializedMessageOutput.openVirtualPort(`${scriptName} initialized`)

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
    .tap(message => Console.log(message))
    .map(JSON.stringify)
    .subscribe(serializedData => fileStream.write(serializedData + '\n'))

  initializedMessageOutput.sendMessage([ 180, 48, 125 ])
  RxNode.fromStream(process.stdin, 'end')
    .subscribe((input) => {Console.log('input', input); initializedMessageOutput.sendMessage([ 180, 48, 125 ])})

  const closePorts = () => {
    Console.log('Closing ports')
    clockInput.closePort()
    messageInput.closePort()
    initializedMessageOutput.closePort()
  }

  process.on('exit', closePorts)
  process.on('SIGINT', closePorts)
  process.on('uncaughtException', closePorts)
}

if (require.main === module) {
  main()
}
