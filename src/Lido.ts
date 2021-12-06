import { Address } from '@graphprotocol/graph-ts'
import { store } from '@graphprotocol/graph-ts'
import {  
  Transfer,
  
  Submitted,
  
  Withdrawal,
} from '../generated/Lido/Lido'
import {
  
  LidoTransfer,  
  LidoSubmission,  
  LidoWithdrawal,  
  TotalReward,
  NodeOperatorFees,
  Totals,
  NodeOperatorsShares,
  Shares,
  Holder,
  LidoEvent,
} from '../generated/schema'

import { ZERO, getAddress, DUST_BOUNDARY } from './constants'




export function handleTransfer(event: Transfer): void {
  // new lido event.
  let lidoEvent = LidoEvent.load(event.transaction.hash.toHex()) 
  if (lidoEvent == null){
    lidoEvent = new LidoEvent(
      event.transaction.hash.toHex() 
    )
  }
  lidoEvent.blockNumber = event.block.number
  lidoEvent.blockTimestamp = event.block.timestamp
  lidoEvent.from = event.params.from
  lidoEvent.to = event.params.to
  lidoEvent.tokenAmount = event.params.value

  // end creation of lido event


  let entity = new LidoTransfer(
    event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  )

  entity.from = event.params.from
  entity.to = event.params.to
  entity.value = event.params.value

  entity.block = event.block.number
  entity.blockTime = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.transactionIndex = event.transaction.index
  entity.logIndex = event.logIndex
  entity.transactionLogIndex = event.transactionLogIndex

  let fromZeros =
    event.params.from ==
    Address.fromString('0x0000000000000000000000000000000000000000')

  let totalRewardsEntity = TotalReward.load(event.transaction.hash.toHex())

  // We know that for rewards distribution shares are minted with same from 0x0 address as staking
  // We can save this indicator which helps us distinguish such mints from staking events
  entity.mintWithoutSubmission = totalRewardsEntity ? true : false

  // Entity is already created at this point
  let totals = Totals.load('') as Totals

  entity.totalPooledEther = totals.totalPooledEther
  entity.totalShares = totals.totalShares

  // setting totals
  
  // end setting


  let shares = event.params.value
    .times(totals.totalShares)
    .div(totals.totalPooledEther)

  if (!fromZeros) {
    entity.shares = shares
  }

  // We'll save the entity later

  let isFeeDistributionToTreasury =
    fromZeros && event.params.to == getAddress('Treasury')

  // graph-ts less or equal to
  let isDust = event.params.value.lt(DUST_BOUNDARY)

  if (totalRewardsEntity && isFeeDistributionToTreasury && !isDust) {
    // Handling the Insurance Fee transfer event to treasury

    entity.shares = totalRewardsEntity.sharesToInsuranceFund

    totalRewardsEntity.insuranceFee = event.params.value

    totalRewardsEntity.totalRewards = totalRewardsEntity.totalRewards.minus(
      event.params.value
    )
    totalRewardsEntity.totalFee = totalRewardsEntity.totalFee.plus(
      event.params.value
    )

    totalRewardsEntity.save()
  } else if (totalRewardsEntity && isFeeDistributionToTreasury && isDust) {
    // Handling dust transfer event

    entity.shares = totalRewardsEntity.sharesToTreasury

    totalRewardsEntity.dust = event.params.value

    totalRewardsEntity.totalRewards = totalRewardsEntity.totalRewards.minus(
      event.params.value
    )
    totalRewardsEntity.totalFee = totalRewardsEntity.totalFee.plus(
      event.params.value
    )

    totalRewardsEntity.save()
  } else if (totalRewardsEntity && fromZeros) {
    // Handling node operator fee transfer to node operator

    // Entity should be existent at this point
    let nodeOperatorsShares = NodeOperatorsShares.load(
      event.transaction.hash.toHex() + '-' + event.params.to.toHexString()
    ) as NodeOperatorsShares

    let sharesToOperator = nodeOperatorsShares.shares

    entity.shares = sharesToOperator

    let nodeOperatorFees = new NodeOperatorFees(
      event.transaction.hash.toHex() + '-' + event.logIndex.toString()
    )

    // Reference to TotalReward entity
    nodeOperatorFees.totalReward = event.transaction.hash.toHex()

    nodeOperatorFees.address = event.params.to
    nodeOperatorFees.fee = event.params.value

    totalRewardsEntity.totalRewards = totalRewardsEntity.totalRewards.minus(
      event.params.value
    )
    totalRewardsEntity.totalFee = totalRewardsEntity.totalFee.plus(
      event.params.value
    )

    totalRewardsEntity.save()
    nodeOperatorFees.save()
  }

  if (entity.shares) {
    // Decreasing from address shares
    // No point in changing 0x0 shares
    if (!fromZeros) {
      let sharesFromEntity = Shares.load(event.params.from.toHexString())
      // Address must already have shares, HOWEVER:
      // Someone can and managed to produce events of 0 to 0 transfers
      if (!sharesFromEntity) {
        sharesFromEntity = new Shares(event.params.from.toHexString())
        sharesFromEntity.shares = ZERO
      }

      entity.sharesBeforeDecrease = sharesFromEntity.shares
      sharesFromEntity.shares = sharesFromEntity.shares.minus(entity.shares!)
      entity.sharesAfterDecrease = sharesFromEntity.shares

      sharesFromEntity.save()

      // Calculating new balance
      entity.balanceAfterDecrease = entity
        .sharesAfterDecrease!.times(totals.totalPooledEther)
        .div(totals.totalShares)
    }

    // Increasing to address shares
    let sharesToEntity = Shares.load(event.params.to.toHexString())

    if (!sharesToEntity) {
      sharesToEntity = new Shares(event.params.to.toHexString())
      sharesToEntity.shares = ZERO
    }

    entity.sharesBeforeIncrease = sharesToEntity.shares
    sharesToEntity.shares = sharesToEntity.shares.plus(entity.shares!)
    entity.sharesAfterIncrease = sharesToEntity.shares

    sharesToEntity.save()

    // Calculating new balance
    entity.balanceAfterIncrease = entity
      .sharesAfterIncrease!.times(totals.totalPooledEther)
      .div(totals.totalShares)
  }
  
  entity.save()

  lidoEvent.totalPooledEtherAfter = entity.totalPooledEther
  lidoEvent.totalSharesAfter = entity.totalShares
  if (totalRewardsEntity) {
    if (totalRewardsEntity.totalRewards){
      lidoEvent.totalRewards = totalRewardsEntity.totalRewards
    }
    lidoEvent.apr = totalRewardsEntity.apr
    lidoEvent.aprBeforeFees = totalRewardsEntity.aprBeforeFees
    lidoEvent.totalRewards = totalRewardsEntity.totalRewards
    lidoEvent.totalRewardsWithFees = totalRewardsEntity.totalRewardsWithFees
    lidoEvent.shares2mint = totalRewardsEntity.shares2mint       
    lidoEvent.totalPooledEtherBefore = totalRewardsEntity.totalPooledEtherBefore
    lidoEvent.totalShareBefore = totalRewardsEntity.totalSharesBefore 
  }
  if (!fromZeros){
    lidoEvent.totalPooledEtherBefore = lidoEvent.totalPooledEtherAfter
    lidoEvent.totalShareBefore = lidoEvent.totalSharesAfter
  }

  lidoEvent.save()

  // Saving recipient address as a unique stETH holder
  if (event.params.value.gt(ZERO)) {
    let holder = Holder.load(event.params.to.toHexString())

    if (!holder) holder = new Holder(event.params.to.toHexString())

    holder.address = event.params.to

    holder.save()
  }
}



 

 

 

export function handleSubmit(event: Submitted): void {

  // Create the lido event in this method...
  let entity = new LidoSubmission(
    event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  )
  let lidoEvent = LidoEvent.load(event.transaction.hash.toHex()) 
  if (lidoEvent == null){
    lidoEvent = new LidoEvent(
      event.transaction.hash.toHex() 
    )
  }


  // Loading totals
  let totals = Totals.load('')

  let isFirstSubmission = !totals

  if (!totals) {
    totals = new Totals('')
    totals.totalPooledEther = ZERO
    totals.totalShares = ZERO
  }

  entity.sender = event.params.sender
  entity.amount = event.params.amount
  entity.referral = event.params.referral

  // At deployment ratio is 1:1
  let shares = !isFirstSubmission
    ? event.params.amount.times(totals.totalShares).div(totals.totalPooledEther)
    : event.params.amount
  entity.shares = shares

  // Increasing address shares
  let sharesEntity = Shares.load(event.params.sender.toHexString())

  if (!sharesEntity) {
    sharesEntity = new Shares(event.params.sender.toHexString())
    sharesEntity.shares = ZERO
  }

  entity.sharesBefore = sharesEntity.shares
  sharesEntity.shares = sharesEntity.shares.plus(shares)
  entity.sharesAfter = sharesEntity.shares

  entity.block = event.block.number
  entity.blockTime = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.transactionIndex = event.transaction.index
  entity.logIndex = event.logIndex
  entity.transactionLogIndex = event.transactionLogIndex

  entity.totalPooledEtherBefore = totals.totalPooledEther
  entity.totalSharesBefore = totals.totalShares

  // Increasing Totals
  totals.totalPooledEther = totals.totalPooledEther.plus(event.params.amount)
  totals.totalShares = totals.totalShares.plus(shares)

  entity.totalPooledEtherAfter = totals.totalPooledEther
  entity.totalSharesAfter = totals.totalShares

  // Calculating new balance
  entity.balanceAfter = entity.sharesAfter
    .times(totals.totalPooledEther)
    .div(totals.totalShares)

  entity.save()
  sharesEntity.save()
  totals.save()

  lidoEvent.blockNumber = entity.block
  lidoEvent.blockTimestamp = entity.blockTime
  lidoEvent.tokenAmount = entity.amount
  lidoEvent.sender = entity.sender  
  lidoEvent.totalPooledEtherBefore = entity.totalPooledEtherBefore
  lidoEvent.totalPooledEtherAfter = entity.totalPooledEtherAfter
  lidoEvent.totalShareBefore = entity.totalSharesBefore
  lidoEvent.totalSharesAfter = entity.totalSharesAfter
  lidoEvent.save()
}
 

export function handleWithdrawal(event: Withdrawal): void {
  let entity = new LidoWithdrawal(
    event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  )
  let lidoEvent = LidoEvent.load(event.transaction.hash.toHex()) 
  if (lidoEvent == null){
    lidoEvent = new LidoEvent(
      event.transaction.hash.toHex() 
    )
  }

  entity.sender = event.params.sender
  entity.tokenAmount = event.params.tokenAmount
  entity.sentFromBuffer = event.params.sentFromBuffer
  entity.pubkeyHash = event.params.pubkeyHash
  entity.etherAmount = event.params.etherAmount

  entity.save()
  lidoEvent.blockNumber = event.block.number
  lidoEvent.blockTimestamp = event.block.timestamp
  lidoEvent.sender = entity.sender
  lidoEvent.tokenAmount = entity.tokenAmount

}
