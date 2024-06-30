import express from 'express'
import { PORT } from './auth/server-auth.mjs'

const app = express()

const peers = {}

app.use(express.json())

app.post('/client', (req, res) => {
  const { address, port, name } = req.body
  console.log('from', address, port, name)
  peers[name] = { address, port, name }

  res.status(200).end()
})

app.get('/clients', (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(peers))
})

app.listen(PORT, () => {
  console.log(`Signaling server listening on *:${PORT}`)
})
