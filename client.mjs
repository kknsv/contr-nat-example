import * as dgram from 'node:dgram'
import net from 'net'
import { HOSTNAME } from './auth/server-auth.mjs'

const STUN_SERVER = '74.125.250.129' //'stun.l.google.com' todo dns request
const STUN_PORT = 19302

export default class Client {
  static #STATES = ['init', 'receiveIP', 'receivedIP', 'connectToTCP', 'connectToTCP2', 'connectToTCP3', 'listenTCP', 'sending', 'websocket']
  #tcpServer
  #intervalIdSync
  #intervalIdStun
  #intervalIdMsg
  #peers
  #name
  #friend
  /** @type{Socket} */
  #udpServer
  #address = null
  #port = null
  #index = 1
  #id = 0
  #currentState = ''
  #socket

  constructor ({ name, friend }) {
    this.#name = name
    this.#peers = {}
    this.#index = 1
    this.#friend = friend
    this.#id = Math.round(Math.random() * 1000000)
    this.#currentState = 'init'

    this.#createUdpServer()
  }

  get #state () {
    return this.#currentState
  }

  set #state (state) {
    if (!Client.#STATES.includes(state)) {
      throw new Error('Invalid state')
    }

    if (this.#state === state) {
      return
    }

    console.log(`new state ${state}`)

    this.#currentState = state

    if (this.#currentState === 'connectToTCP') {
      this.#stopUDPServer(() => {
        this.#state = 'connectToTCP2'
      })
      return
    }

    if (this.#currentState === 'connectToTCP2') {
      const obj = this.#peers[this.#friend]

      if (obj.id > this.#id) {
        this.#currentState = 'connectToTCP3'
      } else {
        this.#currentState = 'listenTCP'
        this.#createTCPServer()
      }
    }

    if (this.#currentState === 'connectToTCP3') {
      this.#connectToTCP().catch(console.error)
      return
    }

    if (this.#currentState === 'sending') {
      this.#socket.on('data', data => console.log(this.#id, data.toString()))
      setInterval(() => this.#socket.write(`from client${this.#name} - ${this.#index++} - ${Date.now()}`), 1000)
      return
    }
  }

  static #createStunMessage () {
    const buffer = Buffer.alloc(20)
    buffer.writeUInt16BE(0x0001, 0)
    buffer.writeUInt16BE(0x0000, 2)
    buffer.writeUInt32BE(0x2112A442, 4)

    for (let i = 8; i < 20; i++) {
      buffer[i] = Math.floor(Math.random() * 256)
    }

    return buffer
  }

  #createTCPServer () {
    console.log(`createTCPServer`)
    this.#tcpServer = net.createServer(socket => {
      this.#socket = socket
      this.#state = 'sending'
    })

    this.#tcpServer.listen({ port: this.#port },)
  }

  #sendMessageToAllPeers () {
    for (const { address, port, name } of Object.values(this.#peers)) {
      const message = `Message from ${this.#name} to ${name} id:${this.#index++}`
      console.log(`sending to peers ${message}`)
      this.#udpServer.send(message, port, address, err => err && console.log(err))
    }
  }

  async #connectToTCP () {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const peer = this.#peers[this.#friend]

    console.log(`connectToTCP ${peer.address}:${peer.port}`)

    net.connect({
      host: peer.address,
      port: peer.port,
      localPort: this.#port
    }, (err, socket) => {
      if (err) {
        console.error(err)
        return
      }

      this.#socket = socket
      this.#state = 'sending'
    })
  }

  #createUdpServer () {
    this.#udpServer = dgram.createSocket('udp4')
    this.#udpServer.bind()
    this.#udpServer.on('message', this.#onMessage.bind(this))
    this.#intervalIdSync = setInterval(this.#updateClients.bind(this), 100)
    this.#intervalIdStun = setInterval(this.#updateStun.bind(this), 100)
    this.#intervalIdMsg = setInterval(this.#sendMessageToAllPeers.bind(this), 100)
    this.#state = 'receiveIP'
  }

  #stopUDPServer (callback) {
    clearInterval(this.#intervalIdSync)
    clearInterval(this.#intervalIdStun)
    clearInterval(this.#intervalIdMsg)

    this.#udpServer.close(callback)
  }

  #updateStun () {
    const message = Client.#createStunMessage()
    this.#udpServer.send(message, 0, message.length, STUN_PORT, STUN_SERVER, (err) => err && console.log(err))
  }

  #onStunResponse (msg) {
    const messageLength = msg.readUInt16BE(2)
    const magicCookie = msg.readUInt32BE(4)

    if (magicCookie !== 0x2112A442) {
      throw new Error('Invalid STUN magic cookie')
    }

    let offset = 20
    while (offset < 20 + messageLength) {
      const attributeType = msg.readUInt16BE(offset)
      const attributeLength = msg.readUInt16BE(offset + 2)
      if (attributeType === 0x0020) {
        const family = msg.readUInt8(offset + 5)
        let port = msg.readUInt16BE(offset + 6) ^ (magicCookie >> 16)
        let address
        if (family === 0x01) { // IPv4
          address = Buffer.alloc(4)
          for (let i = 0; i < 4; i++) {
            address[i] = msg[offset + 8 + i] ^ (magicCookie >> ((3 - i) * 8))
          }
          address = address.join('.')
        }
        this.#updateMyAddress({ address, port })
      }
      offset += 4 + attributeLength
    }
  }

  #onMessage (data, { address, port }) {
    if (address === STUN_SERVER && port === STUN_PORT) {
      this.#onStunResponse(data)
      this.#state = 'receivedIP'
      return
    }

    const obj = Object.values(this.#peers).find(peer => peer.address === address && peer.port === port)

    console.log(`!!!!Received message on client ${this.#name} from ${obj?.name}:`, data.toString())

    if (obj.name === this.#friend) {
      this.#state = 'connectToTCP'
    }
  }

  #updateMyAddress ({ address, port }) {
    if (this.#address === address && this.#port === port) {
      return
    }

    this.#address = address
    this.#port = port
    console.log(`my new address is ${address}:${port}`)

    fetch(`http://${HOSTNAME}/client`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: this.#name,
        address,
        port,
        id: this.#id
      })
    }).catch(console.error)
  }

  async #updateClients () {
    const req = await fetch(`http://${HOSTNAME}/clients`, { method: 'GET' })
    const data = await req.json()
    Object.entries(data).forEach(([key, value]) => {
      if (!value) {
        return
      }

      if (this.#name !== value.name) {
        if (!this.#peers[value.name]) {
          console.log(`new ip for ${value.name}  ${value.address}:${value.port} `)
        }

        this.#peers[value.name] = value
      }
    })
  }
}

