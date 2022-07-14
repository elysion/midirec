'use strict'; // eslint-disable-line semi
const Rx = require('rx')
const midi = require('midi')
const R = require('ramda')
const fs = require('fs')
const RxNode = require('rx-node')
const path = require('path')

const Console = console
const ClockTick = [248]
const ClockStart = [250]

const valToSignalKey = val => `${val[0]}.${val[1]}`

const main = () => {
  Console.log(process.argv)
  const filename = process.argv[3]
  const scriptName = path.basename(__filename)

  Console.log('Starting recording to', filename)
  const fileStream = fs.createWriteStream(filename)
  const stdin = RxNode.fromStream(process.stdin, 'end')
  stdin.finally(() => fileStream.end())

  const clockInput = new midi.input()
  clockInput.openVirtualPort(`${scriptName} clock`)
  clockInput.ignoreTypes(false, false, false)
  const clockInputSubject = new Rx.Subject()
  clockInput.on('message', (deltaTime, message) => {
    clockInputSubject.onNext([deltaTime, message])
  })
  const clock = clockInputSubject.map(R.nth(1)).filter(R.flip(R.contains)([ClockTick, ClockStart]))

  const messageInput = new midi.input()
  messageInput.openVirtualPort(`${scriptName} output`)
  const messageInputSubject = new Rx.Subject()
  messageInput.on('message', (deltaTime, message) => {
    messageInputSubject.onNext([deltaTime, message])
  })
  const messages = messageInputSubject.map(R.nth(1)).filter(R.complement(R.flip(R.contains)([ClockTick, ClockStart])))

  const initializedMessageOutput = new midi.output()
  initializedMessageOutput.openVirtualPort(`${scriptName} initialized`)

  const position = clock.scan(([phrase, bar, beat, tick, raw], message) => {
    if (R.equals(message, ClockStart)) {
      return [0, 0, 0, 0, 0]
    }

    // TODO: should not mutate here...
    raw = raw + 1
    const tickOverflow = tick === 23 ? 1 : 0
    tick = (tick + 1) % 24
    const beatOverflow = beat === 3 && tickOverflow ? 1 : 0
    beat = (beat + tickOverflow) % 4
    const barOverflow = bar === 3 && beatOverflow ? 1 : 0
    bar = (bar + beatOverflow) % 4
    phrase += barOverflow
    return [phrase, bar, beat, tick, raw]
  }, [0, 0, 0, 0, 0])

  const currentStateStream = messages.withLatestFrom(position, Array)
    .map(R.reverse)
    .tap(message => Console.log(message))
    .scan((currentState, [time, message]) => {
      currentState.time = time
      const signalKey = valToSignalKey(message)
      let column = currentState.messages.findIndex(({ key }) => key === signalKey)
      if (column === -1) {
        column = currentState.messages.length
      }
      currentState.messages[column] = { key: signalKey, value: message[2] }
      return currentState
    }, { messages: [] })

  currentStateStream
    .map(({ time, messages }) => {
      const messagesString = messages.map(({ value }) => value).join(',')
      return `${time[4]},${time.slice(0, 4).join('.')},${messagesString}`
    })
    .tap(message => Console.log(message))
    .subscribe(serializedData => fileStream.write(serializedData + '\n'))

  initializedMessageOutput.sendMessage([180, 48, 125])

  const exitStream = Rx.Observable.fromEvent(process, 'exit')
  exitStream.subscribe(() => Console.log('exit'))

  currentStateStream.sample(exitStream)
    .map(({ messages }) => `tick,position,${messages.map(({ key }) => key).join(',')}`)
    .map(serializedData => fileStream.write(serializedData + '\n')) // TODO: replace map with a better function
    .subscribe(() => closePorts())

  RxNode.fromStream(process.stdin, 'end')
    .subscribe((input) => {
      Console.log('input', input);
      initializedMessageOutput.sendMessage([180, 48, 125])
    })

  const closePorts = () => {
    Console.log('Closing ports')
    clockInput.closePort()
    messageInput.closePort()
    initializedMessageOutput.closePort()
  }

  process.on('SIGINT', closePorts)
  process.on('uncaughtException', closePorts)
}

if (require.main === module) {
  main()
}
