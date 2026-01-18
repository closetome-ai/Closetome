import { Connection } from '@solana/web3.js'
import { config, getRpcUrl, type Network } from '../config.js'

const connections: Map<Network, Connection> = new Map()

export function getConnection(network: Network = config.defaultNetwork): Connection {
  let connection = connections.get(network)
  if (!connection) {
    connection = new Connection(getRpcUrl(network), 'confirmed')
    connections.set(network, connection)
  }
  return connection
}
