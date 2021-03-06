const logger = require('../helpers/logger')('Court')
const { bn, bigExp } = require('../helpers/numbers')
const { ROUND_STATES } = require('@aragon/court/test/helpers/wrappers/court')
const { decodeEventsOfType } = require('@aragon/court/test/helpers/lib/decodeEvent')
const { getVoteId, hashVote } = require('@aragon/court/test/helpers/utils/crvoting')
const { DISPUTE_MANAGER_EVENTS } = require('@aragon/court/test/helpers/utils/events')
const { DISPUTE_MANAGER_ERRORS } = require('@aragon/court/test/helpers/utils/errors')
const { getEventArgument, getEvents } = require('@aragon/test-helpers/events')
const { sha3, fromWei, fromAscii, soliditySha3, BN, padLeft, toHex } = require('web3-utils')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

module.exports = class {
  constructor(instance, environment) {
    this.instance = instance
    this.environment = environment
  }

  async anj() {
    if (!this._anj) {
      const registry = await this.registry()
      const address = await registry.token()
      const MiniMeToken = await this.environment.getArtifact('MiniMeToken', '@aragon/minime')
      this._anj = await MiniMeToken.at(address)
    }
    return this._anj
  }

  async feeToken() {
    if (!this._feeToken) {
      const currentTermId = await this.currentTerm()
      const { feeToken } = await this.instance.getConfig(currentTermId)
      const MiniMeToken = await this.environment.getArtifact('MiniMeToken', '@aragon/minime')
      this._feeToken = await MiniMeToken.at(feeToken)
    }
    return this._feeToken
  }

  async registry() {
    if (!this._registry) {
      const address = await this.instance.getJurorsRegistry()
      const JurorsRegistry = await this.environment.getArtifact('JurorsRegistry', '@aragon/court')
      this._registry = await JurorsRegistry.at(address)
    }
    return this._registry
  }

  async disputeManager() {
    if (!this._disputeManager) {
      const address = await this.instance.getDisputeManager()
      const DisputeManager = await this.environment.getArtifact('DisputeManager', '@aragon/court')
      this._disputeManager = await DisputeManager.at(address)
    }
    return this._disputeManager
  }

  async voting() {
    if (!this._voting) {
      const address = await this.instance.getVoting()
      const Voting = await this.environment.getArtifact('CRVoting', '@aragon/court')
      this._voting = await Voting.at(address)
    }
    return this._voting
  }

  async subscriptions() {
    if (!this._subscriptions) {
      const address = await this.instance.getSubscriptions()
      const Subscriptions = await this.environment.getArtifact('CourtSubscriptions', '@aragon/court')
      this._subscriptions = await Subscriptions.at(address)
    }
    return this._subscriptions
  }

  async currentTerm() {
    return this.instance.getCurrentTermId()
  }

  async neededTransitions() {
    return this.instance.getNeededTermTransitions()
  }

  async canSettle(disputeId) {
    const disputeManager = await this.disputeManager()

    const { finalRuling, lastRoundId } = await disputeManager.getDispute(disputeId)
    if (finalRuling !== bn(0)) return true

    const { state } = await disputeManager.getRound(disputeId, lastRoundId)
    return state === ROUND_STATES.ENDED
  }

  async getJurors(disputeId, roundNumber) {
    const result = await this.environment.query(`{ 
      dispute (id: "${disputeId}") {
        id
        rounds (where: { number: "${roundNumber}" }) { jurors { juror { id } }}
      }}`)
    return result.dispute.rounds[0].jurors.map(juror => juror.juror.id)
  }

  async existsVote(voteId) {
    const voting = await this.voting()
    const maxAllowedOutcomes = await voting.getMaxAllowedOutcome(voteId)
    return !maxAllowedOutcomes.eq(bn(0))
  }

  async isValidOutcome(voteId, outcome) {
    const voting = await this.voting()
    const exists = await this.existsVote(voteId)
    return exists && (await voting.isValidOutcome(voteId, outcome))
  }

  async getCommitment(voteId, voter) {
    const voting = await this.voting()
    const web3 = await this.environment.getWeb3()

    // The vote records are stored at the second storage index of the voting contract
    const voteRecordsSlot = padLeft(1, 64)
    // Parse vote ID en hexadecimal and pad 64
    const voteIdHex = padLeft(toHex(voteId), 64)
    // The vote records variable is a mapping indexed by vote IDs
    const voteSlot = soliditySha3(voteIdHex + voteRecordsSlot.slice(2))
    // Each vote record is a struct where the cast votes mapping is its second element, thus we add 1 to the vote slot
    const castVoteSlot = new BN(voteSlot.slice(2), 16).add(bn(1)).toString(16)
    // Each cast vote mapping is indexed by the address of the voter
    const voterCastVoteSlot = soliditySha3(padLeft(voter, 64) + castVoteSlot)
    // Each cast vote object has the commitment as its first element, thus we don't need to add another value here
    const commitmentVoteSlot = voterCastVoteSlot

    return web3.eth.getStorageAt(voting.address, commitmentVoteSlot)
  }

  async heartbeat(transitions = undefined) {
    const needed = await this.neededTransitions()
    logger.info(`Required ${needed} transitions`)
    if (needed.eq(bn(0))) return needed
    const heartbeats = transitions || needed
    logger.info(`Calling heartbeat with ${heartbeats} max transitions...`)
    await this.instance.heartbeat(heartbeats)
    return Math.min(heartbeats, needed)
  }

  async stake(juror, amount, data = '0x') {
    const anj = await this.anj()
    const decimals = await anj.decimals()
    const registry = await this.registry()
    await this._approve(anj, bigExp(amount, decimals), registry.address)
    logger.info(`Staking ANJ ${amount} for ${juror}...`)
    return registry.stakeFor(juror, bigExp(amount, decimals), data)
  }

  async unstake(amount, data = '0x') {
    const anj = await this.anj()
    const decimals = await anj.decimals()
    const registry = await this.registry()
    logger.info(`Unstaking ANJ ${amount} for ${await this.environment.getSender()}...`)
    return registry.unstake(bigExp(amount, decimals), data)
  }

  async activate(amount) {
    const anj = await this.anj()
    const decimals = await anj.decimals()
    const registry = await this.registry()
    logger.info(`Activating ANJ ${amount} for ${await this.environment.getSender()}...`)
    return registry.activate(bigExp(amount, decimals))
  }

  async activateFor(address, amount) {
    const anj = await this.anj()
    const decimals = await anj.decimals()
    const registry = await this.registry()
    await this._approve(anj, bigExp(amount, decimals), registry.address)
    const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)
    logger.info(`Activating ANJ ${amount} for ${address}...`)
    return registry.stakeFor(address, bigExp(amount, decimals), ACTIVATE_DATA)
  }

  async deactivate(amount) {
    const anj = await this.anj()
    const decimals = await anj.decimals()
    const registry = await this.registry()
    logger.info(`Requesting ANJ ${amount} from ${await this.environment.getSender()} for deactivation...`)
    return registry.deactivate(bigExp(amount, decimals))
  }

  async deployArbitrable() {
    logger.info('Creating new Arbitrable instance...')
    const Arbitrable = await this.environment.getArtifact('ArbitrableMock', '@aragon/court')
    return Arbitrable.new(this.instance.address)
  }

  async subscribe(address, periods = 1) {
    const Arbitrable = await this.environment.getArtifact('ArbitrableMock', '@aragon/court')
    const arbitrable = await Arbitrable.at(address)

    const { recipient, feeToken, feeAmount } = await this.instance.getSubscriptionFees(arbitrable.address)
    const ERC20 = await this.environment.getArtifact('ERC20', '@aragon/court')
    const token = await ERC20.at(feeToken)

    await this._approve(token, feeAmount, recipient)
    const subscriptions = await this.subscriptions()
    logger.info(`Paying fees for ${periods} periods to ${subscriptions.address}...`)
    return subscriptions.payFees(arbitrable.address, periods)
  }

  async createDispute(subject, rulings = 2, metadata = '', evidence = []) {
    logger.info(`Creating new dispute for subject ${subject} ...`)
    const Arbitrable = await this.environment.getArtifact('ArbitrableMock', '@aragon/court')
    const arbitrable = await Arbitrable.at(subject)
    const receipt = await arbitrable.createDispute(rulings, fromAscii(metadata))
    const DisputeManager = await this.environment.getArtifact('DisputeManager', '@aragon/court')
    const logs = decodeEventsOfType(receipt, DisputeManager.abi, DISPUTE_MANAGER_EVENTS.NEW_DISPUTE)
    const disputeId = getEventArgument({ logs }, DISPUTE_MANAGER_EVENTS.NEW_DISPUTE, 'disputeId')

    for (const data of evidence) {
      logger.info(`Submitting evidence ${data} for dispute #${disputeId} ...`)
      await arbitrable.submitEvidence(disputeId, fromAscii(data), false)
    }

    return disputeId
  }

  async draft(disputeId) {
    const disputeManager = await this.disputeManager()
    const { subject, lastRoundId } = await disputeManager.getDispute(disputeId)
    const { draftTerm } = await disputeManager.getRound(disputeId, lastRoundId)
    const currentTermId = await this.currentTerm()

    if (draftTerm.gt(currentTermId)) {
      logger.info(`Closing evidence period for dispute #${disputeId} ...`)
      const Arbitrable = await this.environment.getArtifact('ArbitrableMock', '@aragon/court')
      const arbitrable = await Arbitrable.at(subject)
      await arbitrable.submitEvidence(disputeId, fromAscii('closing evidence submission period'), true)
    }

    logger.info(`Drafting dispute #${disputeId} ...`)
    const receipt = await disputeManager.draft(disputeId)
    const logs = decodeEventsOfType(receipt, disputeManager.abi, DISPUTE_MANAGER_EVENTS.JUROR_DRAFTED)
    return getEvents({ logs }, DISPUTE_MANAGER_EVENTS.JUROR_DRAFTED).map(event => event.args.juror)
  }

  async commit(disputeId, outcome, password) {
    const disputeManager = await this.disputeManager()
    const { lastRoundId } = await disputeManager.getDispute(disputeId)
    const voteId = getVoteId(disputeId, lastRoundId)

    logger.info(`Committing a vote for dispute #${disputeId} and round #${lastRoundId}...`)
    const voting = await this.voting()
    return voting.commit(voteId, hashVote(outcome, soliditySha3(password)))
  }

  async reveal(disputeId, juror, outcome, password) {
    const disputeManager = await this.disputeManager()
    const { lastRoundId } = await disputeManager.getDispute(disputeId)
    const voteId = getVoteId(disputeId, lastRoundId)
    return this.revealFor(voteId, juror, outcome, soliditySha3(password))
  }

  async revealFor(voteId, juror, outcome, salt) {
    logger.info(`Revealing vote #${voteId} for juror ${juror}...`)
    const voting = await this.voting()
    return voting.reveal(voteId, juror, outcome, salt)
  }

  async appeal(disputeId, outcome) {
    const disputeManager = await this.disputeManager()
    const { lastRoundId } = await disputeManager.getDispute(disputeId)

    const feeToken = await this.feeToken()
    const { appealDeposit } = await disputeManager.getNextRoundDetails(disputeId, lastRoundId)
    await this._approve(feeToken, appealDeposit, disputeManager.address)

    logger.info(`Appealing dispute #${disputeId} and round #${lastRoundId} in favour of outcome ${outcome}...`)
    return disputeManager.createAppeal(disputeId, lastRoundId, outcome)
  }

  async confirmAppeal(disputeId, outcome) {
    const disputeManager = await this.disputeManager()
    const { lastRoundId } = await disputeManager.getDispute(disputeId)

    const feeToken = await this.feeToken()
    const { confirmAppealDeposit } = await disputeManager.getNextRoundDetails(disputeId, lastRoundId)
    await this._approve(feeToken, confirmAppealDeposit, disputeManager.address)

    logger.info(`Confirming appeal for dispute #${disputeId} and round #${lastRoundId} in favour of outcome ${outcome}...`)
    return disputeManager.confirmAppeal(disputeId, lastRoundId, outcome)
  }

  async settleRound(disputeId) {
    const disputeManager = await this.disputeManager()
    const { lastRoundId } = await disputeManager.getDispute(disputeId)

    for (let roundId = 0; roundId <= lastRoundId; roundId++) {
      logger.info(`Settling penalties for dispute #${disputeId} and round #${roundId}...`)
      await disputeManager.settlePenalties(disputeId, roundId, 0)

      if (lastRoundId > roundId) {
        logger.info(`Settling appeal deposits for dispute #${disputeId} and round #${roundId}...`)
        await disputeManager.settleAppealDeposit(disputeId, roundId)
      }
    }
  }

  async settleJuror(disputeId, juror) {
    const disputeManager = await this.disputeManager()
    const { lastRoundId } = await disputeManager.getDispute(disputeId)

    for (let roundId = 0; roundId <= lastRoundId; roundId++) {
      const { weight } = await disputeManager.getJuror(disputeId, roundId, juror)
      if (weight.gt(bn(0))) {
        logger.info(`Settling rewards of juror ${juror} for dispute #${disputeId} and round #${roundId}...`)
        await disputeManager.settleReward(disputeId, roundId, juror)
      }
    }
  }

  async execute(disputeId) {
    logger.info(`Executing ruling of dispute #${disputeId}...`)
    return this.instance.executeRuling(disputeId)
  }

  async settle(disputeId) {
    const voting = await this.voting()
    const disputeManager = await this.disputeManager()
    const { finalRuling: ruling, lastRoundId } = await disputeManager.getDispute(disputeId)

    // Execute final ruling if missing
    if (ruling.eq(bn(0))) await this.execute(disputeId)
    const { finalRuling } = await disputeManager.getDispute(disputeId)

    // Settle rounds
    for (let roundNumber = 0; roundNumber <= lastRoundId; roundNumber++) {
      const { jurorsNumber, settledPenalties } = await disputeManager.getRound(disputeId, roundNumber)

      // settle penalties
      if (!settledPenalties) {
        logger.info(`Settling penalties for dispute #${disputeId} round #${roundNumber}`)
        await disputeManager.settlePenalties(disputeId, roundNumber, jurorsNumber)
        logger.success(`Settled penalties for dispute #${disputeId} round #${roundNumber}`)
      }

      // settle juror rewards
      const voteId = getVoteId(disputeId, roundNumber)
      const jurors = await this.getJurors(disputeId, roundNumber)
      for (const juror of jurors) {
        const votedOutcome = await voting.getVoterOutcome(voteId, juror)
        if (votedOutcome.eq(finalRuling)) {
          logger.info(`Settling rewards of juror ${juror} for dispute #${disputeId} and round #${roundNumber}...`)
          await disputeManager.settleReward(disputeId, roundNumber, juror)
          logger.success(`Settled rewards of juror ${juror} for dispute #${disputeId} and round #${roundNumber}...`)
        }
      }

      // settle appeals
      const { taker } = await disputeManager.getAppeal(disputeId, roundNumber)
      if (taker != ZERO_ADDRESS) {
        try {
          logger.info(`Settling appeal deposits for dispute #${disputeId} round #${roundNumber}`)
          await disputeManager.settleAppealDeposit(disputeId, roundNumber)
          logger.success(`Settled penalties for dispute #${disputeId} round #${roundNumber}`)
        } catch (error) {
          if (!error.message.includes(DISPUTE_MANAGER_ERRORS.APPEAL_ALREADY_SETTLED)) throw error
        }
      }
    }
  }

  async _approve(token, amount, recipient) {
    const allowance = await token.allowance(await this.environment.getSender(), recipient)
    if (allowance.gt(bn(0))) {
      logger.info(`Resetting allowance to zero for ${recipient}...`)
      await token.approve(recipient, 0)
    }
    logger.info(`Approving ${fromWei(amount)} tokens to ${recipient}...`)
    await token.approve(recipient, amount)
  }
}
