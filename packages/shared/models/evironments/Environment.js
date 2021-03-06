const Web3 = require('web3')
const Court = require('../Court')
const fetch = require('node-fetch')

const SUBGRAPH_BASE = 'https://api.thegraph.com/subgraphs/name/aragon/aragon-court'

class Environment {
  constructor(network, sender = undefined) {
    this.network = network
    this.sender = sender
  }

  getSubgraph() {
    const env = this.network === 'mainnet' ? '' : `-${this.network}`
    return `${SUBGRAPH_BASE}${env}`
  }

  async query(query, endpoint = undefined) {
    const subgraph = endpoint || this.getSubgraph()
    const response = await fetch(subgraph, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query })
    })
    const json = await response.json()
    return json.data
  }

  async getCourt(address) {
    const AragonCourt = await this.getArtifact('AragonCourt', '@aragon/court')
    const court = await AragonCourt.at(address)
    return new Court(court, this)
  }

  async getLastBlock() {
    const web3 = await this.getWeb3()
    return web3.eth.getBlock('latest')
  }

  async getWeb3() {
    if (!this.web3) this.web3 = new Web3(await this.getProvider())
    return this.web3
  }

  async getProvider() {
    if (!this.provider) this.provider = await this._getProvider()
    return this.provider
  }

  async getArtifacts() {
    if (!this.artifacts) this.artifacts = await this._getArtifacts()
    return this.artifacts
  }

  async getArtifact(contractName, dependency = undefined) {
    const artifacts = await this.getArtifacts()
    return artifacts.require(contractName, dependency)
  }

  async getAccounts() {
    const web3 = await this.getWeb3()
    return web3.eth.getAccounts()
  }

  async getSender() {
    if (!this.sender) this.sender = await this._getSender()
    return this.sender
  }

  async _getProvider() {
    throw Error('subclass responsibility')
  }

  async _getArtifacts() {
    throw Error('subclass responsibility')
  }

  async _getSender() {
    throw Error('subclass responsibility')
  }
}

module.exports = Environment
