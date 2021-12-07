import {
  NodeOperatorAdded,  
  SigningKeyAdded,
  
} from '../generated/NodeOperatorsRegistry/NodeOperatorsRegistry'
import { NodeOperatorSigningKey, NodeOperator } from '../generated/schema'

export function handleNodeOperatorAdded(event: NodeOperatorAdded): void {
  let entity = new NodeOperator(event.params.id.toString())

  entity.name = event.params.name
  entity.rewardAddress = event.params.rewardAddress
  entity.stakingLimit = event.params.stakingLimit
  entity.active = false

  entity.save()
}

export function handleSigningKeyAdded(event: SigningKeyAdded): void {
  let entity = new NodeOperatorSigningKey(event.params.pubkey.toHexString())

  entity.operatorId = event.params.operatorId
  entity.pubkey = event.params.pubkey
  entity.removed = false

  entity.save()
}
///

