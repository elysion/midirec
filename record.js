'use strict' // eslint-disable-line semi
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const fs = require('fs')
const RxNode = require('rx-node')
const path = require('path')
const readline = require('readline')

const Console = console
const ClockTick = [248]
const ClockStop = [252]
const ClockStart = [250]

const initializedMessage = [180, 48, 125]

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

  const fileStream = fs.createWriteStream(filename)
  fileStream.write('phrase, bar, beat, tick, byte1, byte2, byte3\n')
  const stdin = RxNode.fromStream(process.stdin, 'end')
  stdin.finally(() => fileStream.end())

  const isIn = R.flip(R.contains)
  const messageInput = new midi.input()
  messageInput.ignoreTypes(false, false, false)
  messageInput.openPort(getPortNumber(messageDeviceName))
  let midiInputSubject = new Rx.Subject()
  messageInput.on('message', (deltaTime, message) => {
    midiInputSubject.onNext([deltaTime, message])
  })
  const midiInput = midiInputSubject.map(R.nth(1))
  const [clock, messages] = midiInput.partition(isIn([ClockTick, ClockStart, ClockStop]))

  messages.subscribe(message => {
    readline.cursorTo(process.stdout, 0, 7)
    process.stdout.clearLine()
    process.stdout.write(`Message ${message}`)
  })

  Console.clear()
  Console.log('Recording to', filename)

  const States = Object.freeze({ stopped: 0, armed: 1, recording: 2 })
  const recordingState = clock
    .filter(isIn([ClockStart, ClockStop]))
    .distinctUntilChanged()
    .merge(messages)
    .scan((state, latest) => {
      //      Console.log({state, latest})
      switch (state) {
        case States.stopped:
          return R.equals(latest, ClockStart) ? States.armed : States.stopped
        case States.armed:
          return !R.contains(latest, [ClockStart, ClockStop]) ? States.recording : States.armed
        case States.recording:
          return R.equals(latest, ClockStop) ? States.stopped : States.recording
        default:
          throw Error('Weird state')
      }
    }, States.stopped)

  const isRecording = recordingState.map(R.equals(States.recording))

  recordingState.distinctUntilChanged().subscribe(state => {
    readline.cursorTo(process.stdout, 0, 1)
    process.stdout.clearLine()
    process.stdout.write(state === States.stopped ? 'Stopped' : state === States.armed ? 'Waiting' : 'Recording')
  })

  const initializedMessageOutput = new midi.output()
  initializedMessageOutput.openVirtualPort(`${scriptName} initialized`)
  const startedRecording = clock
    .merge(isRecording)
    .scan((previous, current) => current === true && !previous)
    .distinctUntilChanged()

  const position = clock
    .combineLatest(startedRecording)
    .pausable(isRecording)
    .scan(
      ([phrase, bar, beat, tick], [message, startedRecording]) => {
        if (startedRecording || isIn([ClockStart, ClockStop], message)) {
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
        } else {
          throw new Error(`Weird message received ${message.toString()}`)
        }
      },
      [0, 0, 0, 0]
    )
    .startWith([0, 0, 0, 0])

  position.subscribe(pos => {
    readline.cursorTo(process.stdout, 0, 8)
    process.stdout.clearLine()
    process.stdout.write(`Position ${pos}`)
  })

  const recordedMessages = messages
    .withLatestFrom(position, Array)
    .map(R.reverse)
    .tap(message => {
      return
      readline.cursorTo(process.stdout, 0, 2)
      process.stdout.clearLine()
      process.stdout.write(`Recorded ${message}`)
    })
    .map(R.flatten)

  recordedMessages.map(R.join(',')).subscribe(serializedData => fileStream.write(serializedData + '\n'))

  initializedMessageOutput.sendMessage(initializedMessage)

  RxNode.fromStream(process.stdin, 'end').subscribe(input => {
    // TODO: what is this for? This is executed when enter is pressed.
    initializedMessageOutput.sendMessage([180, 48, 125])
  })

  const closePorts = () => {
    Console.log('Closing ports')
    messageInput.closePort()
    initializedMessageOutput.closePort()
    fileStream.close()
    process.exit(0)
  }

  process.on('SIGINT', closePorts)
  process.on('uncaughtException', err => {
    Console.error(err)
    closePorts()
  })
}

if (require.main === module) {
  main()
}
