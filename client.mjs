import { HOSTNAME } from './auth/server-auth.mjs'
import * as dgram from 'node:dgram'

const STUN_SERVER = '74.125.250.129' //'stun.l.google.com' todo dns request
const STUN_PORT = 19302

export default class Client {
  #intervalIdSync
  #intervalIdStun
  #intervalIdMsg
  #peers
  #name
  #udpServer
  #address = null
  #port = null
  #index = 1

  constructor ({ name }) {
    this.#name = name
    this.#udpServer = dgram.createSocket('udp4')
    this.#udpServer.on('message', this.#onMessage.bind(this))
    this.#peers = {}
    this.#index = 1

    this.#intervalIdSync = setInterval(this.#updateClients.bind(this), 200)
    this.#intervalIdStun = setInterval(this.#updateStun.bind(this), 100)
    this.#intervalIdMsg = setInterval(this.#sendMessageToAllPeers.bind(this), 100)
  }

  static createStunMessage () {
    const buffer = Buffer.alloc(20)
    buffer.writeUInt16BE(0x0001, 0)
    buffer.writeUInt16BE(0x0000, 2)
    buffer.writeUInt32BE(0x2112A442, 4)

    for (let i = 8; i < 20; i++) {
      buffer[i] = Math.floor(Math.random() * 256)
    }

    return buffer
  }

  #updateStun () {
    const message = Client.createStunMessage()
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
      return
    }

    const obj = this.#peers[`${address}:${port}`]

    console.log(`!!!!Received message on client ${this.#name} from ${obj?.name}:`, data.toString())
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
        port
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
        this.#peers[`${value.address}:${value.port}`] = value
      }
    })
  }

  #sendMessageToAllPeers () {
    for (const { address, port, name } of Object.values(this.#peers)) {
      const message = `Message from ${this.#name} to ${name} id:${this.#index++}`
      this.#udpServer.send(message, port, address, err => err && console.log(err))
    }
  }
}

