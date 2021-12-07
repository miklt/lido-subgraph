import { BigInt } from '@graphprotocol/graph-ts'
import {
  
  Completed,
  
  PostTotalShares,  
} from '../generated/LidoOracle/LidoOracle'
import {
  OracleCompleted,  
  TotalReward,  
  Totals,
  NodeOperatorsShares,
  LidoTokenData,
} from '../generated/schema'

import { CALCULATION_UNIT, DEPOSIT_AMOUNT, ZERO } from './constants'

import { loadLidoContract, loadNosContract } from './contracts'

import {
  nextIncrementalId,
  lastIncrementalId,
  guessOracleRunsTotal,
} from './utils'

export function handleCompleted(event: Completed): void {
  let previousCompleted = OracleCompleted.load(
    lastIncrementalId(
      'OracleCompleted',
      guessOracleRunsTotal(event.block.timestamp)
    )
  )
  let newCompleted = new OracleCompleted(
    nextIncrementalId(
      'OracleCompleted',
      guessOracleRunsTotal(event.block.timestamp)
    )
  )
  let lidoEvent = LidoTokenData.load(event.transaction.hash.toHex()) 
  if (lidoEvent == null){
    lidoEvent = new LidoTokenData(
      event.transaction.hash.toHex() 
    )
  }
  let contract = loadLidoContract()

  newCompleted.epochId = event.params.epochId
  newCompleted.beaconBalance = event.params.beaconBalance
  newCompleted.beaconValidators = event.params.beaconValidators

  newCompleted.block = event.block.number
  newCompleted.blockTime = event.block.timestamp
  newCompleted.transactionHash = event.transaction.hash

  newCompleted.save()

  // Create an empty TotalReward entity that will be filled on Transfer events
  // We know that in this transaction there will be Transfer events which we can identify by existence of TotalReward entity with transaction hash as its id
  let totalRewardsEntity = new TotalReward(event.transaction.hash.toHex())

  totalRewardsEntity.block = event.block.number
  totalRewardsEntity.blockTime = event.block.timestamp
  totalRewardsEntity.transactionIndex = event.transaction.index
  totalRewardsEntity.logIndex = event.logIndex
  totalRewardsEntity.transactionLogIndex = event.transactionLogIndex

  let oldBeaconValidators = previousCompleted
    ? previousCompleted.beaconValidators
    : ZERO

  let oldBeaconBalance = previousCompleted
    ? previousCompleted.beaconBalance
    : ZERO

  let newBeaconValidators = event.params.beaconValidators
  let newBeaconBalance = event.params.beaconBalance

  // TODO: Can appearedValidators be negative? If eg active keys are deleted for some reason
  let appearedValidators = newBeaconValidators.minus(oldBeaconValidators)
  let appearedValidatorsDeposits = appearedValidators.times(DEPOSIT_AMOUNT)
  let rewardBase = appearedValidatorsDeposits.plus(oldBeaconBalance)
  let newTotalRewards = newBeaconBalance.minus(rewardBase)

  let positiveRewards = newTotalRewards.gt(ZERO)

  totalRewardsEntity.totalRewardsWithFees = newTotalRewards
  // Setting totalRewards to totalRewardsWithFees so we can subtract fees from it
  totalRewardsEntity.totalRewards = newTotalRewards
  // Setting initial 0 value so we can add fees to it
  totalRewardsEntity.totalFee = ZERO

  // Will save later, still need to add shares data

  // Totals and rewards data logic
  // Totals are already non-null on first oracle report
  let totals = Totals.load('') as Totals

  // Keeping data before increase
  let totalPooledEtherBefore = totals.totalPooledEther
  let totalSharesBefore = totals.totalShares

  let feeBasis = BigInt.fromI32(contract.getFee()) // 1000

  // Increasing or decreasing totals
  let totalPooledEtherAfter = positiveRewards
    ? totals.totalPooledEther.plus(newTotalRewards)
    : totals.totalPooledEther.minus(newTotalRewards.abs())

  // Overall shares for all rewards cut
  let shares2mint = positiveRewards
    ? newTotalRewards
        .times(feeBasis)
        .times(totals.totalShares)
        .div(
          totalPooledEtherAfter
            .times(CALCULATION_UNIT)
            .minus(feeBasis.times(newTotalRewards))
        )
    : ZERO

  let totalSharesAfter = totals.totalShares.plus(shares2mint)

  totals.totalPooledEther = totalPooledEtherAfter
  totals.totalShares = totalSharesAfter
  totals.save()

  // Further shares calculations
  let feeDistribution = contract.getFeeDistribution()
  let insuranceFeeBasisPoints = BigInt.fromI32(feeDistribution.value1) // 5000
  let operatorsFeeBasisPoints = BigInt.fromI32(feeDistribution.value2) // 5000

  let sharesToInsuranceFund = shares2mint
    .times(insuranceFeeBasisPoints)
    .div(CALCULATION_UNIT)

  let sharesToOperators = shares2mint
    .times(operatorsFeeBasisPoints)
    .div(CALCULATION_UNIT)

  totalRewardsEntity.shares2mint = shares2mint

  totalRewardsEntity.sharesToInsuranceFund = sharesToInsuranceFund
  totalRewardsEntity.sharesToOperators = sharesToOperators

  totalRewardsEntity.totalPooledEtherBefore = totalPooledEtherBefore
  totalRewardsEntity.totalPooledEtherAfter = totalPooledEtherAfter
  totalRewardsEntity.totalSharesBefore = totalSharesBefore
  totalRewardsEntity.totalSharesAfter = totalSharesAfter

  // We will save the entity later

  let registry = loadNosContract()
  let distr = registry.getRewardsDistribution(sharesToOperators)

  let opAddresses = distr.value0
  let opShares = distr.value1

  let sharesToOperatorsActual = ZERO

  for (let i = 0; i < opAddresses.length; i++) {    
    let shares = opShares[i]
    // Incrementing total of actual shares distributed
    sharesToOperatorsActual = sharesToOperatorsActual.plus(shares)
  }

  // Handling dust (rounding leftovers)
  // sharesToInsuranceFund are exact
  // sharesToOperators are with leftovers which we need to account for
  let sharesToTreasury = shares2mint
    .minus(sharesToInsuranceFund)
    .minus(sharesToOperatorsActual)

  totalRewardsEntity.sharesToTreasury = sharesToTreasury

  totalRewardsEntity.save()
  lidoEvent.totalPooledEtherBefore = totalRewardsEntity.totalPooledEtherBefore
  lidoEvent.totalPooledEtherAfter = totalRewardsEntity.totalPooledEtherAfter
  lidoEvent.totalSharesBefore = totalRewardsEntity.totalPooledEtherBefore
  lidoEvent.sharesToTreasury = sharesToTreasury
  lidoEvent.sharesToInsuranceFund = sharesToInsuranceFund
  lidoEvent.sharesToOperators = sharesToOperatorsActual
  lidoEvent.shares2mint = shares2mint
  lidoEvent.save()
}



export function handlePostTotalShares(event: PostTotalShares): void {
  let contract = loadLidoContract()
  let lidoEvent = LidoTokenData.load(event.transaction.hash.toHex()) as LidoTokenData
  if (lidoEvent == null){
    lidoEvent = new LidoTokenData(
      event.transaction.hash.toHex() 
    )
  }
  let entity = TotalReward.load(event.transaction.hash.toHex()) as TotalReward

  let preTotalPooledEther = event.params.preTotalPooledEther
  let postTotalPooledEther = event.params.postTotalPooledEther

  entity.preTotalPooledEther = preTotalPooledEther
  entity.postTotalPooledEther = postTotalPooledEther
  entity.timeElapsed = event.params.timeElapsed
  entity.totalShares = event.params.totalShares

  let aprBeforeFees = postTotalPooledEther
    .toBigDecimal()
    .div(preTotalPooledEther.toBigDecimal())
    .minus(BigInt.fromI32(1).toBigDecimal())
    .times(BigInt.fromI32(100).toBigDecimal())
    .times(BigInt.fromI32(365).toBigDecimal())

  let feeBasis = BigInt.fromI32(contract.getFee()).toBigDecimal() // 1000

  let apr = aprBeforeFees.minus(
    aprBeforeFees
      .times(CALCULATION_UNIT.toBigDecimal())
      .div(feeBasis)
      .div(BigInt.fromI32(100).toBigDecimal())
  )

  entity.aprBeforeFees = aprBeforeFees
  entity.apr = apr

  entity.block = event.block.number
  entity.blockTime = event.block.timestamp

  entity.save()
  lidoEvent.apr = entity.apr
  lidoEvent.aprBeforeFees = entity.aprBeforeFees
  lidoEvent.save()
}







