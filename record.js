'use strict'; // eslint-disable-line semi
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const fs = require('fs')
const RxNode = require('rx-node')
const path = require('path')

const Console = console
const ClockTick = [248]
const ClockStop = [252]
const ClockStart = [250]

// TODO: open an virtual input port and start recording on clock start?

// TODO: group messages with same control to same columns?
// (and use multiple columns on one row for messages sent on same time signature?)

if (process.argv.length < 3) {
  Console.log(`Usage: ${process.argv[1]} "MIDI Port" output_file`)
  process.exit(1)
}

const getPortNumber = name => {
  const input = new midi.input()
  const listMidiInputPorts = () => {
    let inputs = []
    for (let i = 0; i < input.getPortCount(); i++) {
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
  fileStream.write('phrase, bar, beat, tick, byte1, byte2, byte3\n')
  const stdin = RxNode.fromStream(process.stdin, 'end')
  stdin.finally(() => fileStream.end())

  const isIn = R.flip(R.contains)
  const messageInput = new midi.input()
    // input.openVirtualPort('Test Input')
  messageInput.openPort(getPortNumber(messageDeviceName))
  let messageInputSubject = new Rx.Subject()
  messageInput.on('message', (deltaTime, message) => {
    messageInputSubject.onNext([deltaTime, message])
  })
  const messages = messageInputSubject.map(R.nth(1)).filter(R.complement(isIn([ClockTick, ClockStart])))

  const clockInput = new midi.input()
    // input.openVirtualPort('Test Input')
  clockInput.openVirtualPort(scriptName)
  clockInput.ignoreTypes(false, false, false)
  let clockInputSubject = new Rx.Subject()
  clockInput.on('message', (deltaTime, message) => {
    clockInputSubject.onNext([deltaTime, message])
  })
  const clock = clockInputSubject.map(R.nth(1)).filter(isIn([ClockTick, ClockStart, ClockStop]))

  const States = Object.freeze({stopped: 0, armed: 1, recording: 2})
  const isRecording = clock.filter(isIn([ClockStart, ClockStop])).distinctUntilChanged().merge(messages)
    .scan((state, latest) => {
      Console.log({state, latest})
      switch (state) {
      case (States.stopped):
        return R.equals(latest, ClockStart) ? States.armed : States.stopped
      case (States.armed):
        return !R.contains(latest, [ClockStart, ClockStop]) ? States.recording : States.armed
      case (States.recording):
        return R.equals(latest, ClockStop) ? States.stopped : States.recording
      default:
        throw Error('Weird state')
      }
    }, States.armed)
      .map(R.equals(States.recording))

  isRecording.subscribe(r => Console.log('isRecording', r))

  Console.log('Waiting for first message')
  clock.first().subscribe(() => Console.log('Received first message. Initiate recording.'))

  const initializedMessageOutput = new midi.output()
  initializedMessageOutput.openVirtualPort(`${scriptName} initialized`)

  const position = clock
    .combineLatest(isRecording)
    .filter(([message, recording]) => recording ? true : R.equals(message, ClockStart))
    .map(R.head)
    .scan(([phrase, bar, beat, tick], message) => {
        //Console.log('tick')
      if (R.equals(message, ClockStart)) {
        return [0, 0, 0, 0]
      } else if (R.equals(message, ClockTick)) {
        const tickOverflow = tick === 23 ? 1 : 0
        tick = (tick + 1) % 24
        const beatOverflow = beat === 3 && tickOverflow ? 1 : 0
        beat = (beat + tickOverflow) % 4
        const barOverflow = bar === 3 && beatOverflow ? 1 : 0
        bar = (bar + beatOverflow) % 4
        phrase += barOverflow
        return [phrase, bar, beat, tick]
      }
    }, [0, 0, 0, 0])

  messages.withLatestFrom(position, Array)
    .map(R.reverse)
    .tap(message => Console.log(message))
    .map(R.flatten)
    .map(R.join(','))
    .subscribe(serializedData => fileStream.write(serializedData + '\n'))

  initializedMessageOutput.sendMessage([180, 48, 125])

  RxNode.fromStream(process.stdin, 'end')
    .subscribe((input) => {
      Console.log('input', input)
      initializedMessageOutput.sendMessage([180, 48, 125])
    })

  const closePorts = () => {
    Console.log('Closing ports')
    clockInput.closePort()
    messageInput.closePort()
    initializedMessageOutput.closePort()
  }

  process.on('exit', closePorts)
  process.on('SIGINT', closePorts)
  process.on('uncaughtException', err => {
    Console.error(err)
    closePorts()
  })
}

if (require.main === module) {
  main()
}
